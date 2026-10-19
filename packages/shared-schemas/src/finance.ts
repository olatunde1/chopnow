import { z } from 'zod';
import { DateTimeSchema, IdSchema, KoboSchema, PageQuerySchema, paginated } from './common.js';

/**
 * Finance contracts (Phase 8): refunds, rider cash hand-ins, settlements, payouts and reports.
 * All money in integer kobo. Payouts are manual bank transfers recorded by finance; nothing here
 * moves money by itself.
 */

const reason = (min = 5) => z.string().trim().min(min, 'Give a short reason').max(500);
const dateRange = z
  .object({ from: z.iso.date(), to: z.iso.date() })
  .refine((v) => v.from <= v.to, { path: ['to'], message: '"to" must be on or after "from"' })
  .refine((v) => (Date.parse(v.to) - Date.parse(v.from)) / 86_400_000 <= 92, { path: ['to'], message: 'Choose a range of 3 months or less' });
export const FinanceRangeQuerySchema = dateRange;

// ───────── Refunds ─────────

export const REFUND_STATUSES = ['REQUESTED', 'APPROVED', 'PROCESSING', 'SUCCESSFUL', 'FAILED', 'REJECTED'] as const;
export const REFUND_CHARGE_TO = ['CUSTOMER_FUNDS', 'RESTAURANT', 'PLATFORM', 'UNAPPLIED_PAYMENT'] as const;
/** Who bears a refund on an order that was already delivered and split. */
export const POST_DELIVERY_CHARGE_TO = ['RESTAURANT', 'PLATFORM'] as const;

export const RefundSchema = z.object({
  id: IdSchema,
  orderId: IdSchema,
  orderCode: z.string(),
  orderStatus: z.string(),
  restaurantName: z.string(),
  amountKobo: z.number().int(),
  reason: z.string(),
  status: z.enum(REFUND_STATUSES),
  chargeTo: z.enum(REFUND_CHARGE_TO).nullable(),
  method: z.enum(['PROVIDER', 'MANUAL']).nullable(),
  paymentReference: z.string().nullable(),
  isTestPayment: z.boolean(),
  providerRefundId: z.string().nullable(),
  failureReason: z.string().nullable(),
  requestedById: IdSchema.nullable(),
  approvedById: IdSchema.nullable(),
  createdAt: DateTimeSchema,
  processedAt: DateTimeSchema.nullable(),
});
export type RefundDto = z.infer<typeof RefundSchema>;
export const RefundListSchema = paginated(RefundSchema);
export const RefundQuerySchema = PageQuerySchema.extend({ status: z.enum(REFUND_STATUSES).optional() });

export const CreateRefundSchema = z
  .object({ amountKobo: KoboSchema.refine((v) => v > 0, 'Amount must be more than ₦0'), reason: reason(), chargeTo: z.enum(POST_DELIVERY_CHARGE_TO).optional() })
  .strict();
export const ApproveRefundSchema = z.object({ chargeTo: z.enum(POST_DELIVERY_CHARGE_TO).optional() }).strict();
export const RejectRefundSchema = z.object({ reason: reason() }).strict();
/** Finance paid the customer by bank transfer (cash orders, or when the provider can't refund). */
export const ManualRefundSchema = z.object({ bankReference: z.string().trim().min(3).max(100) }).strict();

// ───────── Rider cash ─────────

export const REMITTANCE_STATUSES = ['PENDING_CONFIRMATION', 'CONFIRMED', 'REJECTED'] as const;
export const REMITTANCE_METHODS = ['BANK_TRANSFER', 'CASH_HANDOVER'] as const;

export const RemittanceSchema = z.object({
  id: IdSchema,
  riderId: IdSchema,
  riderName: z.string(),
  amountKobo: z.number().int(),
  method: z.enum(REMITTANCE_METHODS),
  reference: z.string().nullable(),
  status: z.enum(REMITTANCE_STATUSES),
  note: z.string().nullable(),
  confirmedAt: DateTimeSchema.nullable(),
  createdAt: DateTimeSchema,
  /** Cash collections this remittance cleared (oldest first). */
  allocations: z.array(z.object({ orderCode: z.string(), amountKobo: z.number().int() })),
});
export const RemittanceListSchema = paginated(RemittanceSchema);
export const RemittanceQuerySchema = PageQuerySchema.extend({ status: z.enum(REMITTANCE_STATUSES).optional(), riderId: IdSchema.optional() });

/** Rider app: "I transferred my cash", confirmed by finance against the bank statement. */
export const DeclareRemittanceSchema = z.object({ amountKobo: KoboSchema.refine((v) => v > 0, 'Enter the amount'), reference: z.string().trim().min(3, 'Enter the transfer reference').max(100) }).strict();
/** Finance records a hand-in it has verified (e.g. cash counted at the office). Confirmed immediately. */
export const RecordRemittanceSchema = z
  .object({ riderId: IdSchema, amountKobo: KoboSchema.refine((v) => v > 0, 'Enter the amount'), method: z.enum(REMITTANCE_METHODS), reference: z.string().trim().max(100).optional(), note: z.string().trim().max(300).optional() })
  .strict();
export const RejectRemittanceSchema = z.object({ reason: reason() }).strict();

export const CashPositionSchema = z.object({
  riderId: IdSchema,
  riderName: z.string(),
  outstandingKobo: z.number().int(),
  limitKobo: z.number().int(),
  openCollections: z.number().int(),
  oldestCollectedAt: DateTimeSchema.nullable(),
  pendingDeclaredKobo: z.number().int(),
});
export const CashPositionListSchema = z.object({ items: z.array(CashPositionSchema), totalOutstandingKobo: z.number().int() });

// ───────── Settlements and payouts ─────────

export const SETTLEMENT_STATUSES = ['DRAFT', 'APPROVED', 'PAYOUT_INITIATED', 'PAID', 'FAILED', 'CANCELLED'] as const;
export const PAYOUT_STATUSES = ['PENDING', 'INITIATED', 'SUCCESSFUL', 'FAILED'] as const;

export const PayoutSchema = z.object({
  id: IdSchema,
  reference: z.string(),
  amountKobo: z.number().int(),
  method: z.string(),
  status: z.enum(PAYOUT_STATUSES),
  bankReference: z.string().nullable(),
  failureReason: z.string().nullable(),
  initiatedAt: DateTimeSchema.nullable(),
  completedAt: DateTimeSchema.nullable(),
});

const settlementBase = {
  id: IdSchema,
  periodStart: DateTimeSchema,
  periodEnd: DateTimeSchema,
  /** Lagos dates covered, inclusive. */
  from: z.string(),
  to: z.string(),
  status: z.enum(SETTLEMENT_STATUSES),
  netPayableKobo: z.number().int(),
  /** Balance carried from earlier periods (e.g. a refund charged after the last settlement). */
  adjustmentsKobo: z.number().int(),
  approvedAt: DateTimeSchema.nullable(),
  note: z.string().nullable(),
  createdAt: DateTimeSchema,
  payouts: z.array(PayoutSchema),
};

export const VendorSettlementSchema = z.object({
  ...settlementBase,
  kind: z.literal('VENDOR'),
  restaurantId: IdSchema,
  restaurantName: z.string(),
  orderCount: z.number().int(),
  grossSalesKobo: z.number().int(),
  commissionKobo: z.number().int(),
  restaurantFundedDiscountKobo: z.number().int(),
  refundDeductionsKobo: z.number().int(),
});
export const RiderSettlementSchema = z.object({
  ...settlementBase,
  kind: z.literal('RIDER'),
  riderId: IdSchema,
  riderName: z.string(),
  deliveryCount: z.number().int(),
  earningsKobo: z.number().int(),
  /** Cash the rider still has to hand in (now), shown for information; v1 does not net it off the payout. */
  cashOutstandingKobo: z.number().int(),
});
export const SettlementSchema = z.discriminatedUnion('kind', [VendorSettlementSchema, RiderSettlementSchema]);
export const SettlementListSchema = paginated(SettlementSchema);
export const SettlementQuerySchema = PageQuerySchema.extend({ kind: z.enum(['VENDOR', 'RIDER']).optional(), status: z.enum(SETTLEMENT_STATUSES).optional() });
export const SettlementKindParam = z.enum(['vendor', 'rider']);

export const GenerateSettlementsSchema = dateRange.and(z.object({ kind: z.enum(['VENDOR', 'RIDER', 'ALL']).default('ALL') }));
export const GenerateSettlementsResultSchema = z.object({
  created: z.number().int(),
  skipped: z.array(z.object({ kind: z.enum(['VENDOR', 'RIDER']), name: z.string(), reason: z.string() })),
});
export const CancelSettlementSchema = z.object({ reason: reason() }).strict();
export const CompletePayoutSchema = z.object({ bankReference: z.string().trim().min(3, 'Enter the bank transfer reference').max(100) }).strict();
export const FailPayoutSchema = z.object({ reason: reason() }).strict();

// ───────── Reports ─────────

export const FinanceSummarySchema = z.object({
  from: z.string(),
  to: z.string(),
  deliveredOrders: z.number().int(),
  /** Customer totals of orders delivered in the period. */
  grossOrderValueKobo: z.number().int(),
  foodSalesKobo: z.number().int(),
  revenue: z.object({ commissionKobo: z.number().int(), deliveryMarginKobo: z.number().int(), serviceFeesKobo: z.number().int(), totalKobo: z.number().int() }),
  promotionCostKobo: z.number().int(),
  refundsPaidKobo: z.number().int(),
  /** Balances right now (all time). */
  balances: z.object({
    owedToRestaurantsKobo: z.number().int(),
    owedToRidersKobo: z.number().int(),
    cashHeldByRidersKobo: z.number().int(),
    refundsOwedKobo: z.number().int(),
    providerClearingKobo: z.number().int(),
    customerFundsHeldKobo: z.number().int(),
  }),
  pending: z.object({ refundRequests: z.number().int(), remittancesToConfirm: z.number().int(), settlementsToApprove: z.number().int(), payoutsInFlight: z.number().int() }),
  /** Every account's debits and credits; `balanced` must always be true. */
  trialBalance: z.object({ accounts: z.array(z.object({ account: z.string(), debitKobo: z.number().int(), creditKobo: z.number().int() })), balanced: z.boolean() }),
});

/** Vendor portal and rider app views of their own settlements. */
export const OwnSettlementListSchema = z.object({ items: z.array(SettlementSchema) });
