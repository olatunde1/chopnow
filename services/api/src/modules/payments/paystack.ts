import { createHmac, timingSafeEqual } from 'node:crypto';
import { PaymentProviderError, type InitializeInput, type InitializeResult, type PaymentProvider, type RefundInput, type RefundResult, type VerificationResult, type WebhookEvent } from './provider.js';

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

interface PaystackEnvelope<T> {
  status: boolean;
  message: string;
  data: T;
}

const TIMEOUT_MS = 15_000;

/**
 * Paystack (https://paystack.com/docs/api/). Amounts are in kobo, matching our storage.
 * - initialize: POST /transaction/initialize → authorization_url
 * - verify:     GET  /transaction/verify/:reference (the source of truth before marking anything paid)
 * - webhooks:   x-paystack-signature = HMAC-SHA512(raw body, secret key)
 * - refunds:    POST /refund { transaction, amount } and GET /refund/:id. Paystack completes refunds
 *               asynchronously ("pending" → "processed"); refund.* webhooks only prompt a re-fetch.
 */
/** Paystack refund statuses: pending, processing, processed, failed (and needs-attention variants). */
export function mapRefund(d: { id: number | string; status: string }): RefundResult {
  const s = String(d.status).toLowerCase();
  return { status: s === 'processed' ? 'success' : s === 'failed' ? 'failed' : 'pending', providerRefundId: String(d.id), message: s };
}

export class PaystackProvider implements PaymentProvider {
  readonly name = 'PAYSTACK' as const;
  readonly isTest: boolean;

  constructor(
    private readonly secretKey: string,
    private readonly baseUrl = 'https://api.paystack.co',
    private readonly fetchImpl: FetchLike = (url, init) => globalThis.fetch(url, init),
  ) {
    this.isTest = secretKey.startsWith('sk_test_');
  }

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<PaystackEnvelope<T>> {
    let res;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: { Authorization: `Bearer ${this.secretKey}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new PaymentProviderError('Could not reach Paystack');
    }
    const json = (await res.json().catch(() => null)) as PaystackEnvelope<T> | null;
    if (!res.ok || !json?.status) {
      // Paystack messages can be shown to operators, never secrets (none are echoed back).
      throw new PaymentProviderError(`Paystack ${path.split('/')[2] ?? path} failed (${res.status}): ${json?.message ?? 'no message'}`, res.status >= 500, res.status);
    }
    return json;
  }

  async initialize(input: InitializeInput): Promise<InitializeResult> {
    const res = await this.call<{ authorization_url: string; reference: string }>('POST', '/transaction/initialize', {
      email: input.email,
      amount: input.amountKobo,
      currency: 'NGN',
      reference: input.reference,
      callback_url: input.callbackUrl,
      metadata: input.metadata,
    });
    return { authorizationUrl: res.data.authorization_url };
  }

  async verify(reference: string): Promise<VerificationResult> {
    let res: PaystackEnvelope<{ id: number; status: string; amount: number; currency: string; channel: string | null; paid_at: string | null; gateway_response: string | null; reference: string }>;
    try {
      res = await this.call('GET', `/transaction/verify/${encodeURIComponent(reference)}`);
    } catch (err) {
      // Paystack answers 400 "Transaction reference not found" before the customer has paid. Any
      // other failure (e.g. 401 from a wrong key) is a real error and is surfaced.
      if (err instanceof PaymentProviderError && err.httpStatus === 400 && /not found/i.test(err.message)) {
        return { status: 'pending', amountKobo: null, currency: null, providerTransactionId: null, channel: null, paidAt: null, summary: {} };
      }
      throw err;
    }
    const d = res.data;
    const status = d.status === 'success' ? 'success' : d.status === 'failed' || d.status === 'reversed' ? 'failed' : d.status === 'abandoned' ? 'abandoned' : 'pending';
    return {
      status,
      amountKobo: d.amount,
      currency: d.currency,
      providerTransactionId: String(d.id),
      channel: d.channel,
      paidAt: d.paid_at ? new Date(d.paid_at) : null,
      summary: { id: d.id, status: d.status, amount: d.amount, currency: d.currency, channel: d.channel, paid_at: d.paid_at, gateway_response: d.gateway_response },
    };
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    const res = await this.call<{ id: number; status: string }>('POST', '/refund', {
      transaction: input.transactionReference,
      amount: input.amountKobo,
      merchant_note: `ChopNow refund ${input.refundId}`,
    });
    return mapRefund(res.data);
  }

  async fetchRefund(providerRefundId: string): Promise<RefundResult> {
    const res = await this.call<{ id: number; status: string }>('GET', `/refund/${encodeURIComponent(providerRefundId)}`);
    return mapRefund(res.data);
  }

  verifyWebhookSignature(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): boolean {
    const header = headers['x-paystack-signature'];
    if (typeof header !== 'string' || !/^[0-9a-f]{128}$/i.test(header)) return false;
    const expected = createHmac('sha512', this.secretKey).update(rawBody).digest();
    return timingSafeEqual(expected, Buffer.from(header, 'hex'));
  }

  parseWebhook(body: unknown): WebhookEvent {
    const b = body as { event?: string; data?: { id?: number | string; reference?: string } };
    const event = String(b?.event ?? 'unknown');
    const reference = b?.data?.reference ? String(b.data.reference) : null;
    return { event, reference, dedupeKey: `${event}:${b?.data?.id ?? reference ?? 'none'}` };
  }
}
