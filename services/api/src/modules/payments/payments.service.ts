import type { Logger } from 'pino';
import type { Db, Tx } from '../../db/client.js';
import { Prisma, type Payment, type PaymentStatus } from '../../generated/prisma/client.js';
import { AppError, Errors } from '../../lib/errors.js';
import { withIdempotency } from '../../lib/idempotency.js';
import { writeAudit } from '../audit/audit.js';
import type { RequestContext } from '../audit/audit.js';
import type { Principal } from '../auth/auth.service.js';
import { postJournal } from '../finance/ledger.js';
import { closeUnfulfilledOrder } from '../orders/order-closure.js';
import { getBusinessRules } from '../settings/business-rules.js';
import { PaymentProviderError, type PaymentProvider, type VerificationResult } from './provider.js';
import { notifyNewOrder, notifyPaymentConfirmed } from '../notifications/messages.js';

const RECONCILE_FIRST_AFTER_MS = 3 * 60_000;
const RECONCILE_MIN_GAP_MS = 15 * 60_000;
const RECONCILE_MAX_AGE_MS = 48 * 3600_000;
/** How long to wait between provider checks of one attempt, by its age. */
const reconcileGap = (ageMs: number) => (ageMs < 3600_000 ? RECONCILE_MIN_GAP_MS : ageMs < 6 * 3600_000 ? 3600_000 : 6 * 3600_000);

/** An unpaid authorisation URL is reused for this long before a fresh attempt is created. */
const REUSE_ATTEMPT_MS = 30 * 60 * 1000;

export type VerificationSource = 'webhook' | 'customer_verify' | 'callback' | 'reconciliation' | 'staff_verify';

export interface ApplyOutcome {
  reference: string;
  status: 'SUCCESSFUL' | 'FAILED' | 'PENDING' | 'ABANDONED';
  orderId: string;
  orderPaymentStatus: PaymentStatus;
  message: string;
}

/**
 * Online payments. The order is only treated as paid after the API itself has asked the provider
 * (verify) and the amount and currency match. Webhooks and app redirects are only triggers for that
 * check; their contents are never trusted on their own. Every outcome is applied idempotently.
 */
export class PaymentsService {
  constructor(
    private readonly db: Db,
    readonly provider: PaymentProvider,
    private readonly opts: { publicApiUrl: string; logger?: Logger; now?: () => Date; onRefundEvent?: (providerRefundId: string) => Promise<void> },
  ) {}

  private now() {
    return this.opts.now?.() ?? new Date();
  }

  /** Starts (or resumes) online payment for a customer's own order and returns the checkout URL. */
  async initialize(principal: Principal, orderId: string, idempotencyKey: string) {
    const result = await withIdempotency(
      this.db,
      { userId: principal.userId, scope: `payments.init:${orderId}`, key: idempotencyKey, request: { orderId } },
      async () => ({ status: 200, body: await this.initializeOnce(principal, orderId) }),
    );
    return result.body;
  }

  private async initializeOnce(principal: Principal, orderId: string) {
    const order = await this.db.order.findFirst({ where: { id: orderId, customerId: principal.userId }, include: { customer: { select: { email: true } } } });
    if (!order) throw Errors.notFound('Order');
    if (order.paymentMethod !== 'ONLINE') throw new AppError(409, 'NOT_ONLINE_PAYMENT', 'This order is paid in cash on delivery.');
    if (order.status !== 'PLACED') throw new AppError(409, 'ORDER_NOT_PAYABLE', 'This order can no longer be paid.');
    if (order.paymentStatus === 'SUCCESSFUL') throw new AppError(409, 'ALREADY_PAID', 'This order is already paid.');

    const recent = await this.db.payment.findFirst({
      where: { orderId, status: 'INITIALIZED', provider: this.provider.name, createdAt: { gte: new Date(this.now().getTime() - REUSE_ATTEMPT_MS) } },
      orderBy: { createdAt: 'desc' },
    });
    if (recent?.authorizationUrl) return this.initDto(recent);

    const attempts = await this.db.payment.count({ where: { orderId } });
    const payment = await this.db.payment.create({
      data: { orderId, provider: this.provider.name, reference: `${order.code}-${attempts + 1}`, amountKobo: order.totalKobo, status: 'INITIALIZED' },
    });
    try {
      const { authorizationUrl } = await this.provider.initialize({
        reference: payment.reference,
        amountKobo: payment.amountKobo,
        email: order.customer.email,
        callbackUrl: `${this.opts.publicApiUrl}/v1/payments/callback`,
        metadata: { orderId, orderCode: order.code },
      });
      return this.initDto(await this.db.payment.update({ where: { id: payment.id }, data: { authorizationUrl } }));
    } catch (err) {
      await this.db.payment.update({ where: { id: payment.id }, data: { status: 'FAILED', failureReason: 'Provider initialisation failed' } });
      this.opts.logger?.error({ err, reference: payment.reference }, 'payment initialisation failed');
      if (err instanceof PaymentProviderError) throw new AppError(502, 'PAYMENT_PROVIDER_UNAVAILABLE', 'We couldn’t start the payment. Please try again, or choose cash on delivery.');
      throw err;
    }
  }

  private initDto(p: Payment) {
    return { reference: p.reference, authorizationUrl: p.authorizationUrl!, provider: p.provider, isTestPayment: p.provider === 'MOCK' || this.provider.isTest, amountKobo: p.amountKobo };
  }

  /** Customer returned from the checkout page: ask the provider and apply the result. */
  async verifyForCustomer(principal: Principal, reference: string): Promise<ApplyOutcome> {
    const payment = await this.db.payment.findFirst({ where: { reference, order: { customerId: principal.userId } } });
    if (!payment) throw Errors.notFound('Payment');
    return this.verifyAndApply(reference, 'customer_verify');
  }

  /** Support/finance asks the provider about one attempt now (e.g. "I paid but it says unpaid"). Audited. */
  async verifyForStaff(principal: Principal, reference: string, ctx: RequestContext): Promise<ApplyOutcome> {
    const payment = await this.db.payment.findUnique({ where: { reference }, select: { id: true, status: true } });
    if (!payment) throw Errors.notFound('Payment');
    const outcome = await this.verifyAndApply(reference, 'staff_verify');
    await writeAudit(this.db, { actorUserId: principal.userId, actorRole: principal.role, action: 'payment.staff_verify', entityType: 'Payment', entityId: payment.id, before: { status: payment.status }, after: { result: outcome.status, orderPaymentStatus: outcome.orderPaymentStatus } }, ctx);
    return outcome;
  }

  async verifyAndApply(reference: string, source: VerificationSource): Promise<ApplyOutcome> {
    let verification: VerificationResult;
    try {
      verification = await this.provider.verify(reference);
    } catch (err) {
      this.opts.logger?.warn({ err, reference }, 'payment verification failed');
      throw new AppError(502, 'PAYMENT_PROVIDER_UNAVAILABLE', 'We couldn’t confirm your payment yet. We’ll keep checking; pull to refresh in a moment.');
    }
    return this.applyVerification(reference, verification, source);
  }

  /**
   * Handles a provider webhook. Unsigned or wrongly signed requests are rejected and not stored.
   * Each event is stored once; repeats are acknowledged without reprocessing.
   */
  async handleWebhook(rawBody: Buffer | undefined, headers: Record<string, string | string[] | undefined>, body: unknown) {
    if (!rawBody || !this.provider.verifyWebhookSignature(rawBody, headers)) {
      this.opts.logger?.warn({ provider: this.provider.name }, 'rejected webhook with invalid signature');
      throw new AppError(401, 'INVALID_SIGNATURE', 'Invalid signature');
    }
    const event = this.provider.parseWebhook(body);
    const payment = event.reference ? await this.db.payment.findUnique({ where: { reference: event.reference } }) : null;
    let stored;
    try {
      stored = await this.db.paymentEvent.create({
        data: {
          provider: this.provider.name,
          source: 'webhook',
          eventType: event.event,
          dedupeKey: event.dedupeKey,
          signatureValid: true,
          paymentId: payment?.id ?? null,
          payload: JSON.parse(rawBody.toString('utf8')) as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return { ok: true as const, duplicate: true };
      throw err;
    }

    if (event.event === 'charge.success' && payment) {
      try {
        await this.verifyAndApply(payment.reference, 'webhook');
        await this.db.paymentEvent.update({ where: { id: stored.id }, data: { processedAt: this.now() } });
      } catch (err) {
        // Stored but unprocessed: reconciliation (Phase 8) retries events without processedAt.
        await this.db.paymentEvent.update({ where: { id: stored.id }, data: { processingError: err instanceof Error ? err.message.slice(0, 500) : 'unknown' } });
        throw err;
      }
    } else if (event.event.startsWith('refund.') && this.opts.onRefundEvent) {
      // Never trust the body: it only tells us which refund to re-fetch from the provider.
      const id = (body as { data?: { id?: string | number } })?.data?.id;
      if (id !== undefined) await this.opts.onRefundEvent(String(id));
      await this.db.paymentEvent.update({ where: { id: stored.id }, data: { processedAt: this.now() } });
    } else {
      await this.db.paymentEvent.update({ where: { id: stored.id }, data: { processedAt: this.now(), processingError: payment ? null : 'No matching payment' } });
    }
    return { ok: true as const, duplicate: false };
  }

  /**
   * Applies a provider verification to our records. Idempotent and race-safe: the payment row is
   * locked, and a payment already marked successful is never processed twice.
   */
  async applyVerification(reference: string, v: VerificationResult, source: VerificationSource): Promise<ApplyOutcome> {
    return this.db.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM payments WHERE reference = ${reference} FOR UPDATE`;
      if (locked.length === 0) throw Errors.notFound('Payment');
      const payment = await tx.payment.findUniqueOrThrow({ where: { reference } });
      // Lock the order as well, so a cancellation and this confirmation can't interleave (an order
      // closed a moment ago is refunded below, never left cancelled-but-paid).
      await tx.$queryRaw`SELECT id FROM orders WHERE id = ${payment.orderId}::uuid FOR UPDATE`;
      const order = await tx.order.findUniqueOrThrow({ where: { id: payment.orderId } });
      const outcome = (status: ApplyOutcome['status'], orderPaymentStatus: PaymentStatus, message: string): ApplyOutcome => ({ reference, status, orderId: order.id, orderPaymentStatus, message });

      await tx.paymentEvent.createMany({
        data: [{ provider: payment.provider, source, eventType: `verify.${v.status}`, dedupeKey: `verify:${reference}:${v.status}:${v.providerTransactionId ?? '-'}`, signatureValid: true, paymentId: payment.id, payload: v.summary as Prisma.InputJsonValue, processedAt: this.now() }],
        skipDuplicates: true,
      });

      if (payment.status === 'SUCCESSFUL') return outcome('SUCCESSFUL', order.paymentStatus, 'Payment already confirmed.');
      if (v.status === 'pending') return outcome('PENDING', order.paymentStatus, 'Payment not completed yet.');

      if (v.status === 'failed' || v.status === 'abandoned') {
        const status = v.status === 'failed' ? 'FAILED' : 'ABANDONED';
        await tx.payment.update({ where: { id: payment.id }, data: { status, verifiedAt: this.now(), verificationPayload: v.summary as Prisma.InputJsonValue } });
        const anotherSucceeded = await tx.payment.count({ where: { orderId: order.id, status: 'SUCCESSFUL' } });
        if (!anotherSucceeded && order.status === 'PLACED' && order.paymentStatus === 'PENDING') {
          await tx.order.update({ where: { id: order.id }, data: { paymentStatus: 'FAILED' } });
        }
        return outcome(status, anotherSucceeded ? order.paymentStatus : order.status === 'PLACED' ? 'FAILED' : order.paymentStatus, 'Payment was not completed. You can try again.');
      }

      // ---- Provider says success: check it really matches what we asked for ----
      const amountOk = v.amountKobo === payment.amountKobo && (v.currency ?? 'NGN') === payment.currency;
      const alreadyPaid = await tx.payment.count({ where: { orderId: order.id, status: 'SUCCESSFUL' } });
      const base = { verifiedAt: this.now(), providerTransactionId: v.providerTransactionId, channel: v.channel, verificationPayload: v.summary as Prisma.InputJsonValue };

      if (!amountOk || alreadyPaid) {
        // Money was taken but cannot be applied to this order: hold for refund and alert finance.
        const reason = !amountOk ? 'AMOUNT_MISMATCH' : 'DUPLICATE_CHARGE';
        await tx.payment.update({ where: { id: payment.id }, data: { ...base, status: 'FAILED', failureReason: reason, paidAt: v.paidAt } });
        if (v.amountKobo && v.amountKobo > 0) {
          await tx.refund.create({
            data: { orderId: order.id, paymentId: payment.id, amountKobo: v.amountKobo, reason: reason === 'AMOUNT_MISMATCH' ? 'Paid amount did not match the order total' : 'Duplicate payment for an already-paid order', idempotencyKey: `payment:${payment.id}:${reason}` },
          });
        }
        if (v.amountKobo && v.amountKobo > 0) {
          // The provider holds this money but it belongs to no order: book it as owed back.
          await postJournal(tx, {
            type: 'ONLINE_PAYMENT_CAPTURED',
            idempotencyKey: `payment:${payment.id}:unapplied`,
            description: `Unapplied payment ${reference} (${reason.toLowerCase().replace('_', ' ')}) for order ${order.code}`,
            orderId: order.id,
            paymentId: payment.id,
            at: this.now(),
            lines: [
              { account: 'PROVIDER_CLEARING', direction: 'DEBIT', amountKobo: v.amountKobo },
              { account: 'REFUNDS_PAYABLE', direction: 'CREDIT', amountKobo: v.amountKobo },
            ],
          });
        }
        await writeAudit(tx, { actorUserId: null, actorRole: 'SYSTEM', action: `payment.${reason.toLowerCase()}`, entityType: 'Payment', entityId: payment.id, after: { expectedKobo: payment.amountKobo, receivedKobo: v.amountKobo, currency: v.currency } });
        return outcome('FAILED', order.paymentStatus, reason === 'AMOUNT_MISMATCH' ? 'The payment amount didn’t match. It will be refunded.' : 'This order was already paid. The extra payment will be refunded.');
      }

      await tx.payment.update({ where: { id: payment.id }, data: { ...base, status: 'SUCCESSFUL', paidAt: v.paidAt ?? this.now() } });
      await postJournal(tx, {
        type: 'ONLINE_PAYMENT_CAPTURED',
        idempotencyKey: `payment:${payment.id}:captured`,
        at: this.now(),
        description: `Online payment ${reference} for order ${order.code}`,
        orderId: order.id,
        paymentId: payment.id,
        lines: [
          { account: 'PROVIDER_CLEARING', direction: 'DEBIT', amountKobo: payment.amountKobo },
          { account: 'CUSTOMER_ORDER_FUNDS', direction: 'CREDIT', amountKobo: payment.amountKobo },
        ],
      });
      await tx.payment.updateMany({ where: { orderId: order.id, status: 'INITIALIZED', id: { not: payment.id } }, data: { status: 'ABANDONED', failureReason: 'Another attempt succeeded' } });

      if (order.status === 'CANCELLED' || order.status === 'REJECTED') {
        // Paid after the order ended (e.g. customer cancelled while paying): refund it.
        await tx.order.update({ where: { id: order.id }, data: { paymentStatus: 'REFUND_PENDING' } });
        await this.requestRefund(tx, order.id, payment, 'Payment received after the order was closed');
        return outcome('SUCCESSFUL', 'REFUND_PENDING', 'Payment received, but the order was already closed. It will be refunded.');
      }

      const rules = await getBusinessRules(tx);
      await tx.order.update({
        where: { id: order.id },
        data: {
          paymentStatus: 'SUCCESSFUL',
          visibleToVendorAt: order.visibleToVendorAt ?? this.now(),
          acceptDeadlineAt: order.acceptDeadlineAt ?? new Date(this.now().getTime() + rules.orders.vendorAcceptTimeoutSeconds * 1000),
        },
      });
      if (!order.visibleToVendorAt) await notifyNewOrder(tx, order.id, this.now());
      await notifyPaymentConfirmed(tx, order.id, this.now());
      return outcome('SUCCESSFUL', 'SUCCESSFUL', 'Payment confirmed. Your order has been sent to the restaurant.');
    });
  }

  private async requestRefund(tx: Tx, orderId: string, payment: Payment, reason: string) {
    await tx.refund.create({ data: { orderId, paymentId: payment.id, amountKobo: payment.amountKobo, reason, idempotencyKey: `payment:${payment.id}:late` } });
  }

  /**
   * Reconciliation sweep (worker job). Webhooks can be lost and customers close the app, so
   * unconfirmed attempts are asked about directly: first after 3 minutes (webhooks and the app's own
   * check usually win), then every 15 minutes for an hour, hourly to 6 hours, then every 6 hours,
   * up to 48 hours. Abandoned attempts are included: the customer may have paid after the order
   * closed (refunded) or paid twice (duplicate charge, refunded). Then unpaid online orders past
   * `orders.unpaidOnlineOrderTimeoutSeconds` are cancelled, which releases promotion redemptions.
   */
  async reconcile(limit = 25): Promise<{ checked: number; closed: number }> {
    const now = this.now();
    const due = await this.db.payment.findMany({
      where: {
        provider: this.provider.name,
        status: { in: ['INITIALIZED', 'ABANDONED'] },
        createdAt: { gte: new Date(now.getTime() - RECONCILE_MAX_AGE_MS), lte: new Date(now.getTime() - RECONCILE_FIRST_AFTER_MS) },
        OR: [{ lastReconciledAt: null }, { lastReconciledAt: { lte: new Date(now.getTime() - RECONCILE_MIN_GAP_MS) } }],
      },
      orderBy: [{ lastReconciledAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'asc' }],
      select: { id: true, reference: true, createdAt: true, lastReconciledAt: true },
      take: limit * 4,
    });
    const ready = due.filter((p) => !p.lastReconciledAt || now.getTime() - p.lastReconciledAt.getTime() >= reconcileGap(now.getTime() - p.createdAt.getTime())).slice(0, limit);
    let checked = 0;
    for (const p of ready) {
      // Claim the attempt for this round, so two instances never ask about it twice.
      const claimed = await this.db.payment.updateMany({ where: { id: p.id, lastReconciledAt: p.lastReconciledAt }, data: { lastReconciledAt: now } });
      if (claimed.count === 0) continue;
      try {
        await this.verifyAndApply(p.reference, 'reconciliation');
        checked++;
      } catch (err) {
        this.opts.logger?.warn({ err, reference: p.reference }, 'payment reconciliation check failed');
        if (err instanceof AppError && err.code === 'PAYMENT_PROVIDER_UNAVAILABLE') break; // provider down: try next round
      }
    }
    const closed = await this.closeUnpaidOrders(now);
    return { checked, closed };
  }

  /** Cancels online orders nobody paid for in time, after asking the provider one last time. */
  private async closeUnpaidOrders(now: Date): Promise<number> {
    const rules = await getBusinessRules(this.db);
    const timeoutMs = rules.orders.unpaidOnlineOrderTimeoutSeconds * 1000;
    const stale = await this.db.order.findMany({
      where: { status: 'PLACED', paymentMethod: 'ONLINE', paymentStatus: { in: ['PENDING', 'FAILED'] }, visibleToVendorAt: null, placedAt: { lt: new Date(now.getTime() - timeoutMs) } },
      select: { id: true, placedAt: true },
      orderBy: { placedAt: 'asc' },
      take: 25,
    });
    let closed = 0;
    for (const o of stale) {
      // Never cancel an order that was in fact paid: check its open attempts first.
      const open = await this.db.payment.findMany({ where: { orderId: o.id, status: 'INITIALIZED' }, select: { reference: true } });
      let paid = false;
      let inFlight = false;
      let unreachable = false;
      for (const p of open) {
        try {
          const r = await this.verifyAndApply(p.reference, 'reconciliation');
          if (r.status === 'SUCCESSFUL') paid = true;
          if (r.status === 'PENDING') inFlight = true;
        } catch {
          unreachable = true;
        }
      }
      if (paid || unreachable) continue;
      // A payment the provider still reports as in progress (e.g. a bank transfer) gets twice as long.
      if (inFlight && now.getTime() - o.placedAt.getTime() < 2 * timeoutMs) continue;
      try {
        await this.db.$transaction(async (tx) => {
          const fresh = await tx.order.findUniqueOrThrow({ where: { id: o.id }, select: { id: true, status: true, paymentStatus: true } });
          if (fresh.status !== 'PLACED' || fresh.paymentStatus === 'SUCCESSFUL') return;
          await closeUnfulfilledOrder(tx, { order: fresh, to: 'CANCELLED', actor: { userId: null, role: 'SYSTEM' }, reason: 'Payment was not completed in time' });
          closed++;
        });
      } catch (err) {
        if (!(err instanceof AppError && err.code === 'ORDER_STATE_CHANGED')) this.opts.logger?.error({ err, orderId: o.id }, 'failed to close unpaid order');
      }
    }
    if (closed) this.opts.logger?.info({ closed }, 'closed unpaid online orders');
    return closed;
  }

  /** Reference lookup for the hosted callback page (no customer session there). */
  async callbackResult(reference: string) {
    const exists = await this.db.payment.findUnique({ where: { reference }, select: { id: true } });
    if (!exists) return null;
    try {
      return await this.verifyAndApply(reference, 'callback');
    } catch {
      return null;
    }
  }
}
