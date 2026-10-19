import { z } from 'zod';
import {
  ApproveRefundSchema,
  CancelSettlementSchema,
  CashPositionListSchema,
  CompletePayoutSchema,
  CreateRefundSchema,
  DeclareRemittanceSchema,
  FailPayoutSchema,
  FinanceRangeQuerySchema,
  FinanceSummarySchema,
  GenerateSettlementsResultSchema,
  GenerateSettlementsSchema,
  IdSchema,
  ManualRefundSchema,
  OwnSettlementListSchema,
  RecordRemittanceSchema,
  RefundListSchema,
  RefundQuerySchema,
  RefundSchema,
  RejectRefundSchema,
  RejectRemittanceSchema,
  RemittanceListSchema,
  RemittanceQuerySchema,
  RemittanceSchema,
  SettlementKindParam,
  SettlementListSchema,
  SettlementQuerySchema,
  SettlementSchema,
} from '@chopnow/shared-schemas';
import { defineRoute } from '../../http/route.js';
import type { CashService } from './cash.service.js';
import type { RefundsService } from './refunds.service.js';
import type { FinanceReportsService } from './reports.service.js';
import type { SettlementsService } from './settlements.service.js';

const RF = z.object({ refundId: IdSchema });
const RM = z.object({ remittanceId: IdSchema });
const ST = z.object({ kind: SettlementKindParam, settlementId: IdSchema });
const PO = z.object({ payoutId: IdSchema });
const kindOf = (k: 'vendor' | 'rider') => (k === 'vendor' ? 'VENDOR' : 'RIDER') as 'VENDOR' | 'RIDER';

export function financeRoutes(deps: { refunds: RefundsService; cash: CashService; settlements: SettlementsService; reports: FinanceReportsService }) {
  const { refunds, cash, settlements, reports } = deps;
  const tag = 'Admin: finance';
  return [
    defineRoute({
      method: 'get', path: '/v1/admin/finance/summary', summary: 'Revenue for a period, balances owed now, work queue and trial balance', tag, access: 'settlement.manage',
      query: FinanceRangeQuerySchema, response: FinanceSummarySchema,
      handler: ({ query }) => reports.summary(query.from, query.to),
    }),

    // Refunds
    defineRoute({
      method: 'get', path: '/v1/admin/finance/refunds', summary: 'Refunds, newest first (filter by status)', tag, access: 'payment.read',
      query: RefundQuerySchema, response: RefundListSchema,
      handler: ({ query }) => refunds.list(query),
    }),
    defineRoute({
      method: 'get', path: '/v1/admin/finance/refunds/:refundId', summary: 'One refund', tag, access: 'payment.read',
      params: RF, response: RefundSchema,
      handler: ({ params }) => refunds.get(params.refundId),
    }),
    defineRoute({
      method: 'post', path: '/v1/admin/orders/:orderId/refunds', summary: 'Request a (partial) refund, e.g. after a complaint; another person approves it', tag, access: 'refund.request',
      params: z.object({ orderId: IdSchema }), body: CreateRefundSchema, response: RefundSchema, status: 201,
      handler: ({ me, params, body, requestContext }) => refunds.request(me(), params.orderId, body, requestContext),
    }),
    defineRoute({
      method: 'post', path: '/v1/admin/finance/refunds/:refundId/approve', summary: 'Approve a refund (not your own request) and send it to the provider', tag, access: 'refund.approve',
      params: RF, body: ApproveRefundSchema, response: RefundSchema,
      handler: ({ me, params, body, requestContext }) => refunds.approve(me(), params.refundId, body, requestContext),
    }),
    defineRoute({
      method: 'post', path: '/v1/admin/finance/refunds/:refundId/reject', summary: 'Reject a refund request with a reason', tag, access: 'refund.approve',
      params: RF, body: RejectRefundSchema, response: RefundSchema,
      handler: ({ me, params, body, requestContext }) => refunds.reject(me(), params.refundId, body.reason, requestContext),
    }),
    defineRoute({
      method: 'post', path: '/v1/admin/finance/refunds/:refundId/retry', summary: 'Retry a failed provider refund', tag, access: 'refund.approve',
      params: RF, response: RefundSchema,
      handler: ({ me, params, requestContext }) => refunds.retry(me(), params.refundId, requestContext),
    }),
    defineRoute({
      method: 'post', path: '/v1/admin/finance/refunds/:refundId/mark-paid', summary: 'Record a refund paid by bank transfer (cash orders, or when the provider can’t)', tag, access: 'refund.approve',
      params: RF, body: ManualRefundSchema, response: RefundSchema,
      handler: ({ me, params, body, requestContext }) => refunds.completeManually(me(), params.refundId, body.bankReference, requestContext),
    }),
    defineRoute({
      method: 'post', path: '/v1/admin/finance/refunds/:refundId/refresh', summary: 'Re-check a processing refund with the provider', tag, access: 'refund.approve',
      params: RF, response: RefundSchema,
      handler: async ({ params }) => {
        await refunds.refresh(params.refundId);
        return refunds.get(params.refundId);
      },
    }),

    // Rider cash
    defineRoute({
      method: 'get', path: '/v1/admin/finance/cash', summary: 'Cash each rider still has to hand in', tag, access: 'cash.reconcile',
      response: CashPositionListSchema,
      handler: () => cash.positions(),
    }),
    defineRoute({
      method: 'get', path: '/v1/admin/finance/remittances', summary: 'Cash hand-ins (filter by status or rider)', tag, access: 'cash.reconcile',
      query: RemittanceQuerySchema, response: RemittanceListSchema,
      handler: ({ query }) => cash.list(query),
    }),
    defineRoute({
      method: 'post', path: '/v1/admin/finance/remittances', summary: 'Record and confirm a hand-in finance has verified (e.g. cash counted at the office)', tag, access: 'cash.reconcile',
      body: RecordRemittanceSchema, response: RemittanceSchema, status: 201,
      handler: ({ me, body, requestContext }) => cash.record(me(), body, requestContext),
    }),
    defineRoute({
      method: 'post', path: '/v1/admin/finance/remittances/:remittanceId/confirm', summary: 'Confirm a rider’s declared transfer (clears their oldest cash first)', tag, access: 'cash.reconcile',
      params: RM, response: RemittanceSchema,
      handler: ({ me, params, requestContext }) => cash.confirm(me(), params.remittanceId, requestContext),
    }),
    defineRoute({
      method: 'post', path: '/v1/admin/finance/remittances/:remittanceId/reject', summary: 'Reject a declared transfer that can’t be matched', tag, access: 'cash.reconcile',
      params: RM, body: RejectRemittanceSchema, response: RemittanceSchema,
      handler: ({ me, params, body, requestContext }) => cash.reject(me(), params.remittanceId, body.reason, requestContext),
    }),

    // Settlements and payouts
    defineRoute({
      method: 'post', path: '/v1/admin/finance/settlements/generate', summary: 'Create draft settlements for a past period (Lagos dates)', tag, access: 'settlement.manage',
      body: GenerateSettlementsSchema, response: GenerateSettlementsResultSchema,
      handler: ({ me, body, requestContext }) => settlements.generate(me(), body, requestContext),
    }),
    defineRoute({
      method: 'get', path: '/v1/admin/finance/settlements', summary: 'Restaurant and rider settlements, newest period first', tag, access: 'settlement.manage',
      query: SettlementQuerySchema, response: SettlementListSchema,
      handler: ({ query }) => settlements.list(query),
    }),
    defineRoute({
      method: 'get', path: '/v1/admin/finance/settlements/:kind/:settlementId', summary: 'One settlement with its payouts', tag, access: 'settlement.manage',
      params: ST, response: SettlementSchema,
      handler: ({ params }) => settlements.get(kindOf(params.kind), params.settlementId),
    }),
    defineRoute({
      method: 'post', path: '/v1/admin/finance/settlements/:kind/:settlementId/approve', summary: 'Approve a draft settlement', tag, access: 'settlement.manage',
      params: ST, response: SettlementSchema,
      handler: ({ me, params, requestContext }) => settlements.approve(me(), kindOf(params.kind), params.settlementId, requestContext),
    }),
    defineRoute({
      method: 'post', path: '/v1/admin/finance/settlements/:kind/:settlementId/cancel', summary: 'Cancel an unpaid settlement (e.g. to regenerate it)', tag, access: 'settlement.manage',
      params: ST, body: CancelSettlementSchema, response: SettlementSchema,
      handler: ({ me, params, body, requestContext }) => settlements.cancel(me(), kindOf(params.kind), params.settlementId, body.reason, requestContext),
    }),
    defineRoute({
      method: 'post', path: '/v1/admin/finance/settlements/:kind/:settlementId/payout', summary: 'Start a payout: returns the reference to quote on the bank transfer', tag, access: 'payout.manage',
      params: ST, response: SettlementSchema,
      handler: ({ me, params, requestContext }) => settlements.initiatePayout(me(), kindOf(params.kind), params.settlementId, requestContext),
    }),
    defineRoute({
      method: 'post', path: '/v1/admin/finance/payouts/:payoutId/complete', summary: 'Record the bank transfer made for a payout (books the money as paid)', tag, access: 'payout.manage',
      params: PO, body: CompletePayoutSchema, response: SettlementSchema,
      handler: ({ me, params, body, requestContext }) => settlements.completePayout(me(), params.payoutId, body.bankReference, requestContext),
    }),
    defineRoute({
      method: 'post', path: '/v1/admin/finance/payouts/:payoutId/fail', summary: 'Record that a payout transfer failed (can be started again)', tag, access: 'payout.manage',
      params: PO, body: FailPayoutSchema, response: SettlementSchema,
      handler: ({ me, params, body, requestContext }) => settlements.failPayout(me(), params.payoutId, body.reason, requestContext),
    }),

    // Restaurants and riders: their own statements
    defineRoute({
      method: 'get', path: '/v1/vendor/restaurants/:restaurantId/settlements', summary: 'This restaurant’s approved settlements and payouts', tag: 'Vendor: reports', access: 'finance.read.own',
      params: z.object({ restaurantId: IdSchema }), response: OwnSettlementListSchema,
      handler: ({ me, params }) => settlements.forRestaurant(me(), params.restaurantId),
    }),
    defineRoute({
      method: 'get', path: '/v1/rider/settlements', summary: 'My approved settlements and payouts', tag: 'Rider', access: 'earnings.read.own',
      response: OwnSettlementListSchema,
      handler: ({ me }) => settlements.forRider(me()),
    }),
    defineRoute({
      method: 'get', path: '/v1/rider/remittances', summary: 'My cash hand-ins and their status', tag: 'Rider', access: 'earnings.read.own',
      response: RemittanceListSchema,
      handler: ({ me }) => cash.ownList(me()),
    }),
    defineRoute({
      method: 'post', path: '/v1/rider/remittances', summary: 'Declare a bank transfer of collected cash (finance confirms it)', tag: 'Rider', access: 'delivery.work.own',
      body: DeclareRemittanceSchema, response: RemittanceSchema, status: 201,
      handler: ({ me, body }) => cash.declare(me(), body),
    }),
  ];
}
