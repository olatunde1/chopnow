import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import type { Db, Tx } from '../../db/client.js';
import type { Prisma, RefundStatus } from '../../generated/prisma/client.js';
import { AppError, Errors } from '../../lib/errors.js';
import { writeAudit, type RequestContext } from '../audit/audit.js';
import type { Principal } from '../auth/auth.service.js';
import { PaymentProviderError, type PaymentProvider } from '../payments/provider.js';
import { postJournal, type LedgerLine } from './ledger.js';
import { notifyRefund } from '../notifications/messages.js';

type ChargeTo = 'CUSTOMER_FUNDS' | 'RESTAURANT' | 'PLATFORM' | 'UNAPPLIED_PAYMENT';

const refundInclude = {
  order: { select: { code: true, status: true, restaurantId: true, restaurant: { select: { name: true } } } },
  payment: { select: { reference: true, provider: true, status: true, failureReason: true } },
} satisfies Prisma.RefundInclude;
type RefundRow = Prisma.RefundGetPayload<{ include: typeof refundInclude }>;

const UNAPPLIED = new Set(['AMOUNT_MISMATCH', 'DUPLICATE_CHARGE']);
const isUnapplied = (p: { status: string; failureReason: string | null } | null) => !!p && p.status === 'FAILED' && UNAPPLIED.has(p.failureReason ?? '');

function toDto(r: RefundRow) {
  return {
    id: r.id,
    orderId: r.orderId,
    orderCode: r.order.code,
    orderStatus: r.order.status,
    restaurantName: r.order.restaurant.name,
    amountKobo: r.amountKobo,
    reason: r.reason,
    status: r.status,
    chargeTo: r.chargeTo as ChargeTo | null,
    method: r.method as 'PROVIDER' | 'MANUAL' | null,
    paymentReference: r.payment?.reference ?? null,
    isTestPayment: r.payment?.provider === 'MOCK',
    providerRefundId: r.providerRefundId,
    failureReason: r.failureReason,
    requestedById: r.requestedById,
    approvedById: r.approvedById,
    createdAt: r.createdAt,
    processedAt: r.processedAt,
  };
}

/**
 * Refund lifecycle: REQUESTED → APPROVED → (provider) PROCESSING → SUCCESSFUL | FAILED, or
 * REQUESTED → REJECTED. Manual refunds (cash orders, or when the provider can't) are completed by
 * finance with the bank transfer reference.
 *
 * Ledger: approval moves the amount into REFUNDS_PAYABLE from wherever it sits:
 *   CUSTOMER_FUNDS   order never completed → Dr CUSTOMER_ORDER_FUNDS
 *   RESTAURANT       after delivery, restaurant at fault → Dr VENDOR_PAYABLE (deducted at settlement)
 *   PLATFORM         after delivery, platform bears it → Dr ADJUSTMENTS
 *   UNAPPLIED_PAYMENT duplicate/mismatched charge, already booked to REFUNDS_PAYABLE on receipt
 * Completion: Dr REFUNDS_PAYABLE / Cr PROVIDER_CLEARING (provider) or PLATFORM_BANK (manual).
 *
 * Controls: a person cannot approve a refund they requested; refunds can't exceed what was paid;
 * the provider is called only after the row is claimed (no double refunds from double clicks).
 */
export class RefundsService {
  constructor(
    private readonly db: Db,
    private readonly provider: PaymentProvider,
    private readonly now: () => Date = () => new Date(),
    private readonly logger?: Logger,
  ) {}

  async list(q: { page: number; pageSize: number; status?: RefundStatus }) {
    const where: Prisma.RefundWhereInput = q.status ? { status: q.status } : {};
    const [total, rows] = await Promise.all([
      this.db.refund.count({ where }),
      this.db.refund.findMany({ where, include: refundInclude, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    ]);
    return { items: rows.map(toDto), page: q.page, pageSize: q.pageSize, total };
  }

  async get(id: string) {
    const r = await this.db.refund.findUnique({ where: { id }, include: refundInclude });
    if (!r) throw Errors.notFound('Refund');
    return toDto(r);
  }

  /** What was actually paid for the order and is still refundable (excludes unapplied charges). */
  private async refundable(tx: Tx | Db, orderId: string) {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: { payments: { where: { status: 'SUCCESSFUL' } }, cashCollection: true, refunds: { include: { payment: { select: { status: true, failureReason: true } } } } },
    });
    if (!order) throw Errors.notFound('Order');
    const paid = order.paymentMethod === 'ONLINE' ? (order.payments[0]?.amountKobo ?? 0) : (order.cashCollection?.amountCollectedKobo ?? 0);
    const committed = order.refunds.filter((r) => r.status !== 'REJECTED' && !isUnapplied(r.payment)).reduce((s, r) => s + r.amountKobo, 0);
    return { order, paid, remaining: paid - committed, payment: order.payments[0] ?? null };
  }

  private async isSettled(tx: Tx | Db, orderId: string) {
    return (await tx.financialTransaction.count({ where: { orderId, type: 'ORDER_SETTLED' } })) > 0;
  }

  /** Staff request (e.g. a complaint after delivery). Cancelled/declined orders get theirs automatically. */
  async request(actor: Principal, orderId: string, input: { amountKobo: number; reason: string; chargeTo?: 'RESTAURANT' | 'PLATFORM' }, ctx: RequestContext) {
    const id = await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId}::uuid FOR UPDATE`;
      const { order, paid, remaining, payment } = await this.refundable(tx, orderId);
      if (paid === 0) throw new AppError(409, 'NOTHING_TO_REFUND', 'Nothing has been paid for this order yet.');
      if (input.amountKobo > remaining) throw new AppError(422, 'REFUND_EXCEEDS_PAID', `At most ${remaining} kobo can still be refunded for this order.`, { remainingKobo: remaining });
      const r = await tx.refund.create({
        data: {
          orderId,
          paymentId: order.paymentMethod === 'ONLINE' ? (payment?.id ?? null) : null,
          amountKobo: input.amountKobo,
          reason: input.reason,
          chargeTo: input.chargeTo ?? null,
          requestedById: actor.userId,
          idempotencyKey: `manual:${randomUUID()}`,
          createdAt: this.now(),
        },
      });
      await writeAudit(tx, { actorUserId: actor.userId, actorRole: actor.role, action: 'refund.request', entityType: 'Refund', entityId: r.id, after: { orderCode: order.code, amountKobo: input.amountKobo, reason: input.reason, chargeTo: input.chargeTo ?? null } }, ctx);
      return r.id;
    });
    return this.get(id);
  }

  async approve(actor: Principal, id: string, input: { chargeTo?: 'RESTAURANT' | 'PLATFORM' }, ctx: RequestContext) {
    await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM refunds WHERE id = ${id}::uuid FOR UPDATE`;
      const r = await tx.refund.findUnique({ where: { id }, include: refundInclude });
      if (!r) throw Errors.notFound('Refund');
      if (r.status !== 'REQUESTED') throw new AppError(409, 'REFUND_NOT_PENDING', 'This refund has already been decided.');
      if (r.requestedById && r.requestedById === actor.userId) throw new AppError(403, 'SEPARATION_OF_DUTIES', 'A different team member must approve a refund you requested.');

      let chargeTo: ChargeTo;
      if (isUnapplied(r.payment)) chargeTo = 'UNAPPLIED_PAYMENT';
      else if (await this.isSettled(tx, r.orderId)) {
        const chosen = input.chargeTo ?? (r.chargeTo as 'RESTAURANT' | 'PLATFORM' | null);
        if (chosen !== 'RESTAURANT' && chosen !== 'PLATFORM') throw Errors.validation([{ in: 'body', path: 'chargeTo', message: 'This order was delivered: choose whether the restaurant or ChopNow bears the refund' }]);
        chargeTo = chosen;
      } else chargeTo = 'CUSTOMER_FUNDS';

      const source: LedgerLine | null =
        chargeTo === 'CUSTOMER_FUNDS' ? { account: 'CUSTOMER_ORDER_FUNDS', direction: 'DEBIT', amountKobo: r.amountKobo }
        : chargeTo === 'RESTAURANT' ? { account: 'VENDOR_PAYABLE', direction: 'DEBIT', amountKobo: r.amountKobo, restaurantId: r.order.restaurantId }
        : chargeTo === 'PLATFORM' ? { account: 'ADJUSTMENTS', direction: 'DEBIT', amountKobo: r.amountKobo }
        : null;
      if (source) {
        await postJournal(tx, {
          type: 'REFUND',
          idempotencyKey: `refund:${r.id}:approved`,
          description: `Refund approved for order ${r.order.code} (${chargeTo.toLowerCase().replace('_', ' ')})`,
          orderId: r.orderId,
          refundId: r.id,
          createdById: actor.userId,
          at: this.now(),
          lines: [source, { account: 'REFUNDS_PAYABLE', direction: 'CREDIT', amountKobo: r.amountKobo }],
        });
      }
      await tx.refund.update({ where: { id }, data: { status: 'APPROVED', chargeTo, method: r.paymentId ? 'PROVIDER' : 'MANUAL', approvedById: actor.userId } });
      await writeAudit(tx, { actorUserId: actor.userId, actorRole: actor.role, action: 'refund.approve', entityType: 'Refund', entityId: id, after: { chargeTo, amountKobo: r.amountKobo, orderCode: r.order.code } }, ctx);
    });
    const r = await this.db.refund.findUniqueOrThrow({ where: { id } });
    if (r.method === 'PROVIDER') await this.sendToProvider(id);
    return this.get(id);
  }

  async reject(actor: Principal, id: string, reason: string, ctx: RequestContext) {
    const res = await this.db.refund.updateMany({ where: { id, status: 'REQUESTED' }, data: { status: 'REJECTED', failureReason: reason, approvedById: actor.userId, processedAt: this.now() } });
    if (res.count !== 1) {
      await this.get(id);
      throw new AppError(409, 'REFUND_NOT_PENDING', 'This refund has already been decided.');
    }
    await writeAudit(this.db, { actorUserId: actor.userId, actorRole: actor.role, action: 'refund.reject', entityType: 'Refund', entityId: id, after: { reason } }, ctx);
    return this.get(id);
  }

  /** Retry a refund the provider failed (or whose call errored). Uses the provider's record if one exists. */
  async retry(actor: Principal, id: string, ctx: RequestContext) {
    const r = await this.db.refund.findUnique({ where: { id } });
    if (!r) throw Errors.notFound('Refund');
    if (r.status !== 'FAILED' || r.method !== 'PROVIDER') throw new AppError(409, 'REFUND_NOT_RETRYABLE', 'Only failed provider refunds can be retried.');
    await writeAudit(this.db, { actorUserId: actor.userId, actorRole: actor.role, action: 'refund.retry', entityType: 'Refund', entityId: id }, ctx);
    if (r.providerRefundId) {
      await this.db.refund.update({ where: { id }, data: { status: 'PROCESSING' } });
      await this.refresh(id);
    } else await this.sendToProvider(id);
    return this.get(id);
  }

  /** Finance paid the customer by bank transfer. */
  async completeManually(actor: Principal, id: string, bankReference: string, ctx: RequestContext) {
    const r = await this.db.refund.findUnique({ where: { id } });
    if (!r) throw Errors.notFound('Refund');
    if (r.status !== 'APPROVED' && r.status !== 'FAILED') throw new AppError(409, 'REFUND_NOT_PAYABLE', 'Only approved or failed refunds can be marked as paid manually.');
    await this.complete(id, { method: 'MANUAL', reference: bankReference, actor }, ctx);
    return this.get(id);
  }

  /** Claims the refund (so it is sent once), then asks the provider. */
  private async sendToProvider(id: string) {
    const claimed = await this.db.refund.updateMany({ where: { id, status: { in: ['APPROVED', 'FAILED'] }, method: 'PROVIDER', providerRefundId: null }, data: { status: 'PROCESSING', failureReason: null } });
    if (claimed.count !== 1) return;
    const r = await this.db.refund.findUniqueOrThrow({ where: { id }, include: { payment: true } });
    try {
      const res = await this.provider.refund({ transactionReference: r.payment!.reference, amountKobo: r.amountKobo, refundId: r.id });
      await this.db.refund.update({ where: { id }, data: { providerRefundId: res.providerRefundId } });
      await this.applyProviderResult(id, res.status, res.message);
    } catch (err) {
      // A network error may hide a refund the provider did create: say so, so finance checks first.
      const ambiguous = err instanceof PaymentProviderError && err.httpStatus === undefined;
      const message = err instanceof Error ? err.message : 'Refund request failed';
      await this.db.refund.update({ where: { id }, data: { status: 'FAILED', failureReason: ambiguous ? `${message}. Check the provider dashboard before retrying.` : message } });
      this.logger?.warn({ refundId: id, err }, 'provider refund failed');
    }
  }

  private async applyProviderResult(id: string, status: 'success' | 'pending' | 'failed', message: string | null) {
    if (status === 'success') await this.complete(id, { method: 'PROVIDER' });
    else if (status === 'failed') await this.db.refund.updateMany({ where: { id, status: 'PROCESSING' }, data: { status: 'FAILED', failureReason: `Provider declined the refund${message ? ` (${message})` : ''}` } });
  }

  /** Re-reads a processing refund from the provider (webhooks and the sweep call this). */
  async refresh(id: string) {
    const r = await this.db.refund.findUnique({ where: { id } });
    if (!r || r.status !== 'PROCESSING' || !r.providerRefundId) return;
    try {
      const res = await this.provider.fetchRefund(r.providerRefundId);
      await this.applyProviderResult(id, res.status, res.message);
    } catch (err) {
      this.logger?.warn({ refundId: id, err }, 'could not refresh refund');
    }
  }

  async refreshByProviderId(providerRefundId: string) {
    const r = await this.db.refund.findFirst({ where: { providerRefundId }, select: { id: true } });
    if (r) await this.refresh(r.id);
  }

  async sweepProcessing(limit = 20) {
    const rows = await this.db.refund.findMany({ where: { status: 'PROCESSING', providerRefundId: { not: null } }, select: { id: true }, take: limit, orderBy: { updatedAt: 'asc' } });
    for (const r of rows) await this.refresh(r.id);
    return rows.length;
  }

  private async complete(id: string, how: { method: 'PROVIDER' | 'MANUAL'; reference?: string; actor?: Principal }, ctx: RequestContext = {}) {
    await this.db.$transaction(async (tx) => {
      const now = this.now();
      const done = await tx.refund.updateMany({
        where: { id, status: { in: ['APPROVED', 'PROCESSING', 'FAILED'] } },
        data: { status: 'SUCCESSFUL', processedAt: now, failureReason: null, ...(how.method === 'MANUAL' ? { method: 'MANUAL', providerRefundId: how.reference } : {}) },
      });
      if (done.count !== 1) return; // completed already (e.g. webhook and sweep at once)
      const r = await tx.refund.findUniqueOrThrow({ where: { id }, include: refundInclude });
      await postJournal(tx, {
        type: 'REFUND',
        idempotencyKey: `refund:${r.id}:paid`,
        description: `Refund paid for order ${r.order.code}${how.method === 'MANUAL' ? ` (bank transfer ${how.reference})` : ''}`,
        orderId: r.orderId,
        refundId: r.id,
        createdById: how.actor?.userId,
        at: now,
        lines: [
          { account: 'REFUNDS_PAYABLE', direction: 'DEBIT', amountKobo: r.amountKobo },
          { account: how.method === 'MANUAL' ? 'PLATFORM_BANK' : 'PROVIDER_CLEARING', direction: 'CREDIT', amountKobo: r.amountKobo },
        ],
      });
      if (r.chargeTo !== 'UNAPPLIED_PAYMENT') {
        const { paid, order } = await this.refundable(tx, r.orderId);
        const refunded = order.refunds.filter((x) => x.status === 'SUCCESSFUL' && !isUnapplied(x.payment)).reduce((s, x) => s + x.amountKobo, 0);
        await tx.order.update({ where: { id: r.orderId }, data: { paymentStatus: refunded >= paid ? 'REFUNDED' : 'PARTIALLY_REFUNDED' } });
      }
      const { customerId } = await tx.order.findUniqueOrThrow({ where: { id: r.orderId }, select: { customerId: true } });
      await notifyRefund(tx, { customerId, refundId: r.id, orderId: r.orderId, amountKobo: r.amountKobo, manual: how.method === 'MANUAL' }, now);
      await writeAudit(tx, { actorUserId: how.actor?.userId ?? null, actorRole: how.actor?.role ?? 'SYSTEM', action: 'refund.completed', entityType: 'Refund', entityId: id, after: { method: how.method, reference: how.reference ?? r.providerRefundId, amountKobo: r.amountKobo } }, ctx);
    });
  }
}
