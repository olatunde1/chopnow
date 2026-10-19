/**
 * Payment provider adapter. The rest of the system only talks to this interface, so Paystack can be
 * swapped (e.g. for Flutterwave) without touching order logic.
 */
export type ProviderName = 'PAYSTACK' | 'MOCK';

export interface InitializeInput {
  reference: string;
  amountKobo: number;
  email: string;
  callbackUrl: string;
  metadata: Record<string, string>;
}

export interface InitializeResult {
  authorizationUrl: string;
}

/** Normalised result of asking the provider about a transaction (the source of truth). */
export interface VerificationResult {
  status: 'success' | 'failed' | 'abandoned' | 'pending';
  amountKobo: number | null;
  currency: string | null;
  providerTransactionId: string | null;
  channel: string | null;
  paidAt: Date | null;
  /** Non-sensitive fields kept for the audit trail (no card data). */
  summary: Record<string, unknown>;
}

export interface WebhookEvent {
  event: string;
  reference: string | null;
  /** Stable identifier so a repeated delivery of the same event is recognised. */
  dedupeKey: string;
}

export interface RefundInput {
  /** Our reference of the original (successful) transaction. */
  transactionReference: string;
  amountKobo: number;
  /** Our refund id, sent as a note so the provider record can be traced back. */
  refundId: string;
}

/** Normalised refund state. "pending" means accepted by the provider but not yet completed. */
export interface RefundResult {
  status: 'success' | 'pending' | 'failed';
  providerRefundId: string | null;
  message: string | null;
}

export interface PaymentProvider {
  readonly name: ProviderName;
  readonly isTest: boolean;
  initialize(input: InitializeInput): Promise<InitializeResult>;
  verify(reference: string): Promise<VerificationResult>;
  /** Checks the webhook signature against the exact raw request body. */
  verifyWebhookSignature(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): boolean;
  parseWebhook(body: unknown): WebhookEvent;
  /** Asks the provider to return money for a captured transaction. */
  refund(input: RefundInput): Promise<RefundResult>;
  /** Current state of a refund (the source of truth; webhooks only prompt this lookup). */
  fetchRefund(providerRefundId: string): Promise<RefundResult>;
}

export class PaymentProviderError extends Error {
  constructor(message: string, readonly retryable = true, readonly httpStatus?: number) {
    super(message);
    this.name = 'PaymentProviderError';
  }
}
