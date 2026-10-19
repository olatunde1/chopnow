import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { PaymentProviderError, type InitializeInput, type InitializeResult, type PaymentProvider, type RefundInput, type RefundResult, type VerificationResult, type WebhookEvent } from './provider.js';

/**
 * DEVELOPMENT/TEST ONLY. Simulates a payment provider so the full flow can be exercised without
 * credentials. It never contacts a bank or moves money, every payment it handles is labelled as a
 * test payment in API responses, and configuration refuses it in staging/production.
 *
 * State lives in memory (lost on restart). Its hosted "checkout" page is served by this API at
 * /v1/payments/mock/checkout/:reference, where a developer chooses success or failure.
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'MOCK' as const;
  readonly isTest = true;
  /** Per-process secret used to sign simulated webhooks. */
  readonly webhookSecret = randomBytes(32).toString('hex');
  private readonly transactions = new Map<string, { amountKobo: number; status: 'pending' | 'success' | 'failed'; id: string }>();
  private readonly refunds = new Map<string, RefundResult & { amountKobo: number }>();
  /** Outcome for the next refund call (tests): processed immediately by default. */
  nextRefundOutcome: RefundResult['status'] = 'success';

  constructor(private readonly publicApiUrl: string) {}

  async initialize(input: InitializeInput): Promise<InitializeResult> {
    if (!this.transactions.has(input.reference)) {
      this.transactions.set(input.reference, { amountKobo: input.amountKobo, status: 'pending', id: `mock_${randomBytes(6).toString('hex')}` });
    }
    return { authorizationUrl: `${this.publicApiUrl}/v1/payments/mock/checkout/${encodeURIComponent(input.reference)}` };
  }

  async verify(reference: string): Promise<VerificationResult> {
    const t = this.transactions.get(reference);
    if (!t || t.status === 'pending') {
      return { status: 'pending', amountKobo: null, currency: null, providerTransactionId: null, channel: null, paidAt: null, summary: { mock: true } };
    }
    return {
      status: t.status,
      amountKobo: t.amountKobo,
      currency: 'NGN',
      providerTransactionId: t.id,
      channel: 'mock',
      paidAt: t.status === 'success' ? new Date() : null,
      summary: { mock: true, status: t.status, amount: t.amountKobo },
    };
  }

  /** Used by the mock checkout page and tests to decide the outcome (and optionally tamper with the amount). */
  complete(reference: string, outcome: 'success' | 'failed', amountOverrideKobo?: number) {
    const t = this.transactions.get(reference);
    if (!t) return false;
    t.status = outcome;
    if (amountOverrideKobo !== undefined) t.amountKobo = amountOverrideKobo;
    return t;
  }

  /** Builds a signed webhook body the same way the real provider would send one. */
  signedWebhook(reference: string, event = 'charge.success') {
    const t = this.transactions.get(reference);
    const raw = Buffer.from(JSON.stringify({ event, data: { id: t?.id ?? 'unknown', reference } }));
    return { raw, signature: createHmac('sha512', this.webhookSecret).update(raw).digest('hex') };
  }

  verifyWebhookSignature(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): boolean {
    const header = headers['x-mock-signature'];
    if (typeof header !== 'string' || !/^[0-9a-f]{128}$/.test(header)) return false;
    return timingSafeEqual(createHmac('sha512', this.webhookSecret).update(rawBody).digest(), Buffer.from(header, 'hex'));
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    const t = this.transactions.get(input.transactionReference);
    if (!t || t.status !== 'success') throw new PaymentProviderError('Mock: transaction not found or not successful', false, 400);
    const already = [...this.refunds.values()].filter((r) => r.providerRefundId?.startsWith(`${t.id}:`) && r.status !== 'failed').reduce((s, r) => s + r.amountKobo, 0);
    if (already + input.amountKobo > t.amountKobo) throw new PaymentProviderError('Mock: refund exceeds the transaction amount', false, 400);
    const id = `${t.id}:refund_${randomBytes(4).toString('hex')}`;
    const result = { status: this.nextRefundOutcome, providerRefundId: id, message: 'mock', amountKobo: input.amountKobo };
    this.nextRefundOutcome = 'success';
    this.refunds.set(id, result);
    return { status: result.status, providerRefundId: id, message: 'mock' };
  }

  async fetchRefund(providerRefundId: string): Promise<RefundResult> {
    const r = this.refunds.get(providerRefundId);
    if (!r) throw new PaymentProviderError('Mock: refund not found', false, 404);
    return { status: r.status, providerRefundId, message: 'mock' };
  }

  /** Tests: the provider finishes (or fails) a pending refund. */
  settleRefund(providerRefundId: string, status: 'success' | 'failed') {
    const r = this.refunds.get(providerRefundId);
    if (r) r.status = status;
  }

  parseWebhook(body: unknown): WebhookEvent {
    const b = body as { event?: string; data?: { id?: string; reference?: string } };
    return { event: String(b?.event ?? 'unknown'), reference: b?.data?.reference ?? null, dedupeKey: `${b?.event}:${b?.data?.id ?? b?.data?.reference}` };
  }
}
