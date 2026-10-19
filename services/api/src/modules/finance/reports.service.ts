import type { Db } from '../../db/client.js';
import { LedgerAccount, type Prisma } from '../../generated/prisma/client.js';
import { lagosDayStartUtc } from '../../lib/lagos.js';

type Sums = Map<string, { debit: number; credit: number }>;

async function sums(db: Db, where: Prisma.LedgerEntryWhereInput): Promise<Sums> {
  const rows = await db.ledgerEntry.groupBy({ by: ['account', 'direction'], where, _sum: { amountKobo: true } });
  const out: Sums = new Map();
  for (const r of rows) {
    const e = out.get(r.account) ?? { debit: 0, credit: 0 };
    if (r.direction === 'DEBIT') e.debit += r._sum.amountKobo ?? 0;
    else e.credit += r._sum.amountKobo ?? 0;
    out.set(r.account, e);
  }
  return out;
}
const cr = (s: Sums, a: LedgerAccount) => (s.get(a)?.credit ?? 0) - (s.get(a)?.debit ?? 0);
const dr = (s: Sums, a: LedgerAccount) => -cr(s, a);

/**
 * Finance overview straight from the ledger: period revenue (orders delivered in the range),
 * balances owed right now, the work queue, and a trial balance that must always balance.
 */
export class FinanceReportsService {
  constructor(private readonly db: Db) {}

  async summary(from: string, to: string) {
    const start = lagosDayStartUtc(from);
    const end = new Date(lagosDayStartUtc(to).getTime() + 86_400_000);
    const inPeriod = { createdAt: { gte: start, lt: end } };

    const [settled, period, refundsPaid, all, pending] = await Promise.all([
      this.db.financialTransaction.findMany({ where: { type: 'ORDER_SETTLED', ...inPeriod }, select: { order: { select: { totalKobo: true, subtotalKobo: true } } } }),
      sums(this.db, { ...inPeriod, transaction: { type: 'ORDER_SETTLED' } }),
      this.db.ledgerEntry.aggregate({ where: { ...inPeriod, account: 'REFUNDS_PAYABLE', direction: 'DEBIT', transaction: { type: 'REFUND' } }, _sum: { amountKobo: true } }),
      sums(this.db, {}),
      Promise.all([
        this.db.refund.count({ where: { status: 'REQUESTED' } }),
        this.db.cashRemittance.count({ where: { status: 'PENDING_CONFIRMATION' } }),
        Promise.all([this.db.vendorSettlement.count({ where: { status: 'DRAFT' } }), this.db.riderSettlement.count({ where: { status: 'DRAFT' } })]),
        this.db.payout.count({ where: { status: 'INITIATED' } }),
      ]),
    ]);

    const commission = cr(period, 'PLATFORM_COMMISSION_REVENUE');
    const deliveryMargin = cr(period, 'PLATFORM_DELIVERY_REVENUE');
    const serviceFees = cr(period, 'PLATFORM_SERVICE_FEE_REVENUE');
    const accounts = Object.values(LedgerAccount).map((account) => ({ account, debitKobo: all.get(account)?.debit ?? 0, creditKobo: all.get(account)?.credit ?? 0 }));
    const totalDr = accounts.reduce((s, a) => s + a.debitKobo, 0);
    const totalCr = accounts.reduce((s, a) => s + a.creditKobo, 0);

    return {
      from,
      to,
      deliveredOrders: settled.length,
      grossOrderValueKobo: settled.reduce((s, t) => s + (t.order?.totalKobo ?? 0), 0),
      foodSalesKobo: settled.reduce((s, t) => s + (t.order?.subtotalKobo ?? 0), 0),
      revenue: { commissionKobo: commission, deliveryMarginKobo: deliveryMargin, serviceFeesKobo: serviceFees, totalKobo: commission + deliveryMargin + serviceFees },
      promotionCostKobo: dr(period, 'PROMOTION_EXPENSE'),
      refundsPaidKobo: refundsPaid._sum.amountKobo ?? 0,
      balances: {
        owedToRestaurantsKobo: cr(all, 'VENDOR_PAYABLE'),
        owedToRidersKobo: cr(all, 'RIDER_PAYABLE'),
        cashHeldByRidersKobo: dr(all, 'RIDER_CASH_HELD'),
        refundsOwedKobo: cr(all, 'REFUNDS_PAYABLE'),
        providerClearingKobo: dr(all, 'PROVIDER_CLEARING'),
        customerFundsHeldKobo: cr(all, 'CUSTOMER_ORDER_FUNDS'),
      },
      pending: { refundRequests: pending[0], remittancesToConfirm: pending[1], settlementsToApprove: pending[2][0] + pending[2][1], payoutsInFlight: pending[3] },
      trialBalance: { accounts, balanced: totalDr === totalCr },
    };
  }
}
