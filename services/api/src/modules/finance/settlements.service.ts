import type { Db, Tx } from '../../db/client.js';
import { Prisma, type SettlementStatus } from '../../generated/prisma/client.js';
import { generatePayoutReference } from '../../lib/codes.js';
import { AppError, Errors } from '../../lib/errors.js';
import { lagosDate, lagosDayStartUtc } from '../../lib/lagos.js';
import { writeAudit, type RequestContext } from '../audit/audit.js';
import type { Principal } from '../auth/auth.service.js';
import { outstandingCashByRider } from '../dispatch/dispatch.service.js';
import { postJournal } from './ledger.js';
import { notifyPayout } from '../notifications/messages.js';

type Kind = 'VENDOR' | 'RIDER';
const LIVE: SettlementStatus[] = ['DRAFT', 'APPROVED', 'PAYOUT_INITIATED', 'PAID', 'FAILED'];
const payoutSelect = { id: true, reference: true, amountKobo: true, method: true, status: true, bankReference: true, failureReason: true, initiatedAt: true, completedAt: true } as const;

const vendorInclude = { restaurant: { select: { name: true } }, payouts: { select: payoutSelect, orderBy: { createdAt: 'asc' } } } satisfies Prisma.VendorSettlementInclude;
const riderInclude = { rider: { select: { user: { select: { fullName: true } } } }, payouts: { select: payoutSelect, orderBy: { createdAt: 'asc' } } } satisfies Prisma.RiderSettlementInclude;
type VendorRow = Prisma.VendorSettlementGetPayload<{ include: typeof vendorInclude }>;
type RiderRow = Prisma.RiderSettlementGetPayload<{ include: typeof riderInclude }>;

const period = (s: { periodStart: Date; periodEnd: Date }) => ({ from: lagosDate(s.periodStart), to: lagosDate(new Date(s.periodEnd.getTime() - 1)) });

function vendorDto(s: VendorRow) {
  return {
    kind: 'VENDOR' as const,
    id: s.id, restaurantId: s.restaurantId, restaurantName: s.restaurant.name,
    periodStart: s.periodStart, periodEnd: s.periodEnd, ...period(s),
    status: s.status, orderCount: s.orderCount, grossSalesKobo: s.grossSalesKobo, commissionKobo: s.commissionKobo,
    restaurantFundedDiscountKobo: s.restaurantFundedDiscountKobo, refundDeductionsKobo: s.refundDeductionsKobo,
    adjustmentsKobo: s.adjustmentsKobo, netPayableKobo: s.netPayableKobo, approvedAt: s.approvedAt, note: s.note, createdAt: s.createdAt, payouts: s.payouts,
  };
}
function riderDto(s: RiderRow, cash: Map<string, number>) {
  return {
    kind: 'RIDER' as const,
    id: s.id, riderId: s.riderId, riderName: s.rider.user.fullName,
    periodStart: s.periodStart, periodEnd: s.periodEnd, ...period(s),
    status: s.status, deliveryCount: s.deliveryCount, earningsKobo: s.earningsKobo,
    cashOutstandingKobo: cash.get(s.riderId) ?? 0,
    adjustmentsKobo: s.adjustmentsKobo, netPayableKobo: s.netPayableKobo, approvedAt: s.approvedAt,
    note: s.note, createdAt: s.createdAt, payouts: s.payouts,
  };
}

/** Net credit balance of a payable sub-ledger before `before`, ignoring payouts (credits − debits). */
async function payableBalance(tx: Tx | Db, kind: Kind, ownerId: string, before: Date, after?: Date) {
  const where: Prisma.LedgerEntryWhereInput = {
    account: kind === 'VENDOR' ? 'VENDOR_PAYABLE' : 'RIDER_PAYABLE',
    ...(kind === 'VENDOR' ? { restaurantId: ownerId } : { riderId: ownerId }),
    createdAt: { lt: before, ...(after ? { gte: after } : {}) },
    transaction: { type: { not: 'PAYOUT' } },
  };
  const rows = await tx.ledgerEntry.groupBy({ by: ['direction'], where, _sum: { amountKobo: true } });
  const sum = (d: 'DEBIT' | 'CREDIT') => rows.find((r) => r.direction === d)?._sum.amountKobo ?? 0;
  return sum('CREDIT') - sum('DEBIT');
}

/**
 * Settlements: what ChopNow owes each restaurant and rider for a period, from the ledger.
 *
 *   net payable = payable balance at period end (excluding payouts) − Σ earlier settlements that
 *                 had something to pay (net > 0)
 *
 * so anything not covered before (a refund charged to the restaurant after its last settlement)
 * carries forward automatically, a negative net (the restaurant owes us) is netted off the next
 * settlement rather than forgotten, and the totals always reconcile with the ledger. Periods for the same party may not overlap. Lifecycle: DRAFT → APPROVED → PAYOUT_INITIATED
 * → PAID (finance confirms the bank transfer) | FAILED (retry). Zero or negative nets are approved
 * with nothing to pay. Payouts are manual bank transfers; the PAYOUT journal (Dr payable / Cr
 * PLATFORM_BANK) is posted only when finance records the transfer reference.
 */
export class SettlementsService {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async generate(actor: Principal, input: { from: string; to: string; kind: Kind | 'ALL' }, ctx: RequestContext) {
    const start = lagosDayStartUtc(input.from);
    const end = new Date(lagosDayStartUtc(input.to).getTime() + 86_400_000);
    if (end > this.now()) throw new AppError(422, 'PERIOD_NOT_ENDED', 'Settle only periods that have ended (up to yesterday, Lagos time).');
    const skipped: { kind: Kind; name: string; reason: string }[] = [];
    let created = 0;

    if (input.kind !== 'RIDER') {
      const owners = await this.db.ledgerEntry.findMany({ where: { account: 'VENDOR_PAYABLE', restaurantId: { not: null }, createdAt: { lt: end } }, distinct: ['restaurantId'], select: { restaurantId: true, restaurant: { select: { name: true } } } });
      for (const o of owners) {
        const r = await this.db.$transaction((tx) => this.generateVendor(tx, o.restaurantId!, start, end));
        if (r === 'created') created++;
        else if (r !== 'empty') skipped.push({ kind: 'VENDOR', name: o.restaurant!.name, reason: r });
      }
    }
    if (input.kind !== 'VENDOR') {
      const owners = await this.db.ledgerEntry.findMany({ where: { account: 'RIDER_PAYABLE', riderId: { not: null }, createdAt: { lt: end } }, distinct: ['riderId'], select: { riderId: true, rider: { select: { user: { select: { fullName: true } } } } } });
      for (const o of owners) {
        const r = await this.db.$transaction((tx) => this.generateRider(tx, o.riderId!, start, end));
        if (r === 'created') created++;
        else if (r !== 'empty') skipped.push({ kind: 'RIDER', name: o.rider!.user.fullName, reason: r });
      }
    }
    await writeAudit(this.db, { actorUserId: actor.userId, actorRole: actor.role, action: 'settlement.generate', entityType: 'Settlement', after: { ...input, created, skipped: skipped.length } }, ctx);
    return { created, skipped };
  }

  private async generateVendor(tx: Tx, restaurantId: string, start: Date, end: Date): Promise<'created' | 'empty' | string> {
    await tx.$queryRaw`SELECT id FROM restaurants WHERE id = ${restaurantId}::uuid FOR UPDATE`;
    const overlap = await tx.vendorSettlement.count({ where: { restaurantId, status: { in: LIVE }, periodStart: { lt: end }, periodEnd: { gt: start } } });
    if (overlap) return 'Already settled for an overlapping period';
    const later = await tx.vendorSettlement.count({ where: { restaurantId, status: { in: LIVE }, periodStart: { gte: end } } });
    if (later) return 'A later period is already settled';
    const balance = await payableBalance(tx, 'VENDOR', restaurantId, end);
    const prior = await tx.vendorSettlement.aggregate({ where: { restaurantId, status: { in: LIVE }, periodEnd: { lte: start }, netPayableKobo: { gt: 0 } }, _sum: { netPayableKobo: true } });
    const net = balance - (prior._sum.netPayableKobo ?? 0);

    const settled = await tx.financialTransaction.findMany({ where: { type: 'ORDER_SETTLED', createdAt: { gte: start, lt: end }, order: { restaurantId } }, select: { order: { select: { subtotalKobo: true, commissionKobo: true, discountKobo: true, promotion: { select: { fundedBy: true } } } } } });
    const orders = settled.map((t) => t.order!);
    if (net === 0 && orders.length === 0) return 'empty';
    const gross = orders.reduce((s, o) => s + o.subtotalKobo, 0);
    const commission = orders.reduce((s, o) => s + o.commissionKobo, 0);
    const rDisc = orders.reduce((s, o) => s + (o.promotion?.fundedBy === 'RESTAURANT' ? o.discountKobo : 0), 0);
    const refundRows = await tx.ledgerEntry.aggregate({ where: { account: 'VENDOR_PAYABLE', restaurantId, direction: 'DEBIT', createdAt: { gte: start, lt: end }, transaction: { type: 'REFUND' } }, _sum: { amountKobo: true } });
    const refunds = refundRows._sum.amountKobo ?? 0;
    const data = {
      orderCount: orders.length, grossSalesKobo: gross, commissionKobo: commission, restaurantFundedDiscountKobo: rDisc, refundDeductionsKobo: refunds,
      adjustmentsKobo: net - (gross - commission - rDisc - refunds), netPayableKobo: net, status: 'DRAFT' as const, approvedAt: null, approvedById: null, note: null,
    };
    await tx.vendorSettlement.upsert({ where: { restaurantId_periodStart_periodEnd: { restaurantId, periodStart: start, periodEnd: end } }, create: { restaurantId, periodStart: start, periodEnd: end, ...data, createdAt: this.now() }, update: data });
    return 'created';
  }

  private async generateRider(tx: Tx, riderId: string, start: Date, end: Date): Promise<'created' | 'empty' | string> {
    await tx.$queryRaw`SELECT id FROM riders WHERE id = ${riderId}::uuid FOR UPDATE`;
    const overlap = await tx.riderSettlement.count({ where: { riderId, status: { in: LIVE }, periodStart: { lt: end }, periodEnd: { gt: start } } });
    if (overlap) return 'Already settled for an overlapping period';
    const later = await tx.riderSettlement.count({ where: { riderId, status: { in: LIVE }, periodStart: { gte: end } } });
    if (later) return 'A later period is already settled';
    const balance = await payableBalance(tx, 'RIDER', riderId, end);
    const prior = await tx.riderSettlement.aggregate({ where: { riderId, status: { in: LIVE }, periodEnd: { lte: start }, netPayableKobo: { gt: 0 } }, _sum: { netPayableKobo: true } });
    const net = balance - (prior._sum.netPayableKobo ?? 0);
    const periodEarnings = await payableBalance(tx, 'RIDER', riderId, end, start);
    const deliveries = await tx.riderEarning.count({ where: { riderId, type: 'DELIVERY_FEE', status: { not: 'VOIDED' }, createdAt: { gte: start, lt: end } } });
    if (net === 0 && deliveries === 0) return 'empty';
    const data = {
      deliveryCount: deliveries, earningsKobo: periodEarnings, cashOffsetKobo: 0, adjustmentsKobo: net - periodEarnings, netPayableKobo: net,
      status: 'DRAFT' as const, approvedAt: null, approvedById: null, note: null,
    };
    const s = await tx.riderSettlement.upsert({ where: { riderId_periodStart_periodEnd: { riderId, periodStart: start, periodEnd: end } }, create: { riderId, periodStart: start, periodEnd: end, ...data, createdAt: this.now() }, update: data });
    await tx.riderEarning.updateMany({ where: { riderId, settlementId: null, status: 'CALCULATED', createdAt: { lt: end } }, data: { settlementId: s.id } });
    return 'created';
  }

  async list(q: { page: number; pageSize: number; kind?: Kind; status?: SettlementStatus }) {
    const where = q.status ? { status: q.status } : {};
    const take = q.page * q.pageSize;
    const [vendors, riders, vCount, rCount] = await Promise.all([
      q.kind === 'RIDER' ? [] : this.db.vendorSettlement.findMany({ where, include: vendorInclude, orderBy: { periodEnd: 'desc' }, take }),
      q.kind === 'VENDOR' ? [] : this.db.riderSettlement.findMany({ where, include: riderInclude, orderBy: { periodEnd: 'desc' }, take }),
      q.kind === 'RIDER' ? 0 : this.db.vendorSettlement.count({ where }),
      q.kind === 'VENDOR' ? 0 : this.db.riderSettlement.count({ where }),
    ]);
    const cash = await outstandingCashByRider(this.db, riders.map((r) => r.riderId));
    const all = [...vendors.map(vendorDto), ...riders.map((r) => riderDto(r, cash))].sort((a, b) => b.periodEnd.getTime() - a.periodEnd.getTime() || a.id.localeCompare(b.id));
    return { items: all.slice((q.page - 1) * q.pageSize, take), page: q.page, pageSize: q.pageSize, total: vCount + rCount };
  }

  async get(kind: Kind, id: string) {
    if (kind === 'VENDOR') {
      const s = await this.db.vendorSettlement.findUnique({ where: { id }, include: vendorInclude });
      if (!s) throw Errors.notFound('Settlement');
      return vendorDto(s);
    }
    const s = await this.db.riderSettlement.findUnique({ where: { id }, include: riderInclude });
    if (!s) throw Errors.notFound('Settlement');
    return riderDto(s, await outstandingCashByRider(this.db, [s.riderId]));
  }

  /** Moves a settlement between statuses only if it is still in one of `from`. */
  private async move(tx: Tx, kind: Kind, id: string, from: SettlementStatus[], data: { status: SettlementStatus; approvedAt?: Date; approvedById?: string; note?: string }) {
    const res = kind === 'VENDOR' ? await tx.vendorSettlement.updateMany({ where: { id, status: { in: from } }, data }) : await tx.riderSettlement.updateMany({ where: { id, status: { in: from } }, data });
    if (res.count !== 1) {
      await this.get(kind, id);
      throw new AppError(409, 'SETTLEMENT_STATE_CHANGED', `Only ${from.map((s) => s.toLowerCase()).join(' or ')} settlements can do that.`);
    }
  }

  async approve(actor: Principal, kind: Kind, id: string, ctx: RequestContext) {
    await this.db.$transaction(async (tx) => {
      const s = await this.get(kind, id);
      await this.move(tx, kind, id, ['DRAFT'], { status: 'APPROVED', approvedAt: this.now(), approvedById: actor.userId, ...(s.netPayableKobo <= 0 ? { note: s.netPayableKobo < 0 ? 'Negative balance: carried forward to the next settlement' : 'Nothing to pay this period' } : {}) });
      if (kind === 'RIDER') await tx.riderEarning.updateMany({ where: { settlementId: id, status: 'CALCULATED' }, data: { status: 'APPROVED' } });
      await writeAudit(tx, { actorUserId: actor.userId, actorRole: actor.role, action: 'settlement.approve', entityType: kind === 'VENDOR' ? 'VendorSettlement' : 'RiderSettlement', entityId: id, after: { netPayableKobo: s.netPayableKobo } }, ctx);
    });
    return this.get(kind, id);
  }

  /** Withdraws a settlement that hasn't been paid (e.g. to regenerate it after a correction). */
  async cancel(actor: Principal, kind: Kind, id: string, reason: string, ctx: RequestContext) {
    await this.db.$transaction(async (tx) => {
      await this.move(tx, kind, id, ['DRAFT', 'APPROVED', 'FAILED'], { status: 'CANCELLED', note: reason });
      if (kind === 'RIDER') await tx.riderEarning.updateMany({ where: { settlementId: id, status: { in: ['CALCULATED', 'APPROVED'] } }, data: { settlementId: null, status: 'CALCULATED' } });
      await writeAudit(tx, { actorUserId: actor.userId, actorRole: actor.role, action: 'settlement.cancel', entityType: kind === 'VENDOR' ? 'VendorSettlement' : 'RiderSettlement', entityId: id, after: { reason } }, ctx);
    });
    return this.get(kind, id);
  }

  /** Records that finance is about to transfer the money (gives the reference to quote). */
  async initiatePayout(actor: Principal, kind: Kind, id: string, ctx: RequestContext) {
    try {
      await this.db.$transaction(async (tx) => {
        const s = await this.get(kind, id);
        if (s.netPayableKobo <= 0) throw new AppError(409, 'NOTHING_TO_PAY', 'This settlement has nothing to pay.');
        await this.move(tx, kind, id, ['APPROVED', 'FAILED'], { status: 'PAYOUT_INITIATED' });
        const now = this.now();
        const p = await tx.payout.create({
          data: {
            beneficiary: kind,
            ...(s.kind === 'VENDOR' ? { restaurantId: s.restaurantId, vendorSettlementId: s.id } : { riderId: s.riderId, riderSettlementId: s.id }),
            amountKobo: s.netPayableKobo,
            reference: generatePayoutReference(),
            status: 'INITIATED',
            initiatedById: actor.userId,
            initiatedAt: now,
            createdAt: now,
          },
        });
        await writeAudit(tx, { actorUserId: actor.userId, actorRole: actor.role, action: 'payout.initiate', entityType: 'Payout', entityId: p.id, after: { reference: p.reference, amountKobo: p.amountKobo, settlementId: id } }, ctx);
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw new AppError(409, 'PAYOUT_IN_PROGRESS', 'A payout for this settlement is already in progress.');
      throw err;
    }
    return this.get(kind, id);
  }

  private async livePayout(tx: Tx, payoutId: string) {
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM payouts WHERE id = ${payoutId}::uuid FOR UPDATE`;
    if (!locked.length) throw Errors.notFound('Payout');
    const p = await tx.payout.findUniqueOrThrow({ where: { id: payoutId } });
    if (p.status !== 'INITIATED') throw new AppError(409, 'PAYOUT_NOT_IN_PROGRESS', 'This payout has already been completed or failed.');
    return p;
  }

  /** Finance made the transfer: record the bank reference. Only now is the money booked as paid. */
  async completePayout(actor: Principal, payoutId: string, bankReference: string, ctx: RequestContext) {
    const kind = await this.db.$transaction(async (tx) => {
      const p = await this.livePayout(tx, payoutId);
      const kind: Kind = p.beneficiary;
      const now = this.now();
      await tx.payout.update({ where: { id: p.id }, data: { status: 'SUCCESSFUL', bankReference, completedAt: now } });
      await this.move(tx, kind, (p.vendorSettlementId ?? p.riderSettlementId)!, ['PAYOUT_INITIATED'], { status: 'PAID' });
      await postJournal(tx, {
        type: 'PAYOUT',
        idempotencyKey: `payout:${p.id}:paid`,
        description: `Payout ${p.reference} (bank ref ${bankReference})`,
        payoutId: p.id,
        createdById: actor.userId,
        at: now,
        lines: [
          kind === 'VENDOR' ? { account: 'VENDOR_PAYABLE', direction: 'DEBIT', amountKobo: p.amountKobo, restaurantId: p.restaurantId! } : { account: 'RIDER_PAYABLE', direction: 'DEBIT', amountKobo: p.amountKobo, riderId: p.riderId! },
          { account: 'PLATFORM_BANK', direction: 'CREDIT', amountKobo: p.amountKobo },
        ],
      });
      if (kind === 'RIDER') await tx.riderEarning.updateMany({ where: { settlementId: p.riderSettlementId!, status: { in: ['CALCULATED', 'APPROVED'] } }, data: { status: 'SETTLED' } });
      const payee = kind === 'VENDOR' ? (await tx.restaurant.findUniqueOrThrow({ where: { id: p.restaurantId! }, select: { ownerId: true } })).ownerId : (await tx.rider.findUniqueOrThrow({ where: { id: p.riderId! }, select: { userId: true } })).userId;
      await notifyPayout(tx, { userId: payee, payoutId: p.id, amountKobo: p.amountKobo, reference: bankReference }, now);
      await writeAudit(tx, { actorUserId: actor.userId, actorRole: actor.role, action: 'payout.complete', entityType: 'Payout', entityId: p.id, after: { reference: p.reference, bankReference, amountKobo: p.amountKobo } }, ctx);
      return { kind, id: (p.vendorSettlementId ?? p.riderSettlementId)! };
    });
    return this.get(kind.kind, kind.id);
  }

  async failPayout(actor: Principal, payoutId: string, reason: string, ctx: RequestContext) {
    const ref = await this.db.$transaction(async (tx) => {
      const p = await this.livePayout(tx, payoutId);
      await tx.payout.update({ where: { id: p.id }, data: { status: 'FAILED', failureReason: reason } });
      await this.move(tx, p.beneficiary, (p.vendorSettlementId ?? p.riderSettlementId)!, ['PAYOUT_INITIATED'], { status: 'FAILED' });
      await writeAudit(tx, { actorUserId: actor.userId, actorRole: actor.role, action: 'payout.fail', entityType: 'Payout', entityId: p.id, after: { reference: p.reference, reason } }, ctx);
      return { kind: p.beneficiary, id: (p.vendorSettlementId ?? p.riderSettlementId)! };
    });
    return this.get(ref.kind, ref.id);
  }

  /** Vendor portal: this restaurant's settlements (drafts hidden until approved). */
  async forRestaurant(principal: Principal, restaurantId: string) {
    const r = await this.db.restaurant.findFirst({ where: { id: restaurantId, ownerId: principal.userId } });
    if (!r) throw Errors.notFound('Restaurant');
    const rows = await this.db.vendorSettlement.findMany({ where: { restaurantId, status: { in: ['APPROVED', 'PAYOUT_INITIATED', 'PAID', 'FAILED'] } }, include: vendorInclude, orderBy: { periodEnd: 'desc' }, take: 52 });
    return { items: rows.map(vendorDto) };
  }

  /** Rider app: own settlements (drafts hidden until approved). */
  async forRider(principal: Principal) {
    const rider = await this.db.rider.findUnique({ where: { userId: principal.userId } });
    if (!rider) throw Errors.notFound('Rider profile');
    const rows = await this.db.riderSettlement.findMany({ where: { riderId: rider.id, status: { in: ['APPROVED', 'PAYOUT_INITIATED', 'PAID', 'FAILED'] } }, include: riderInclude, orderBy: { periodEnd: 'desc' }, take: 52 });
    const cash = await outstandingCashByRider(this.db, [rider.id]);
    return { items: rows.map((r) => riderDto(r, cash)) };
  }
}
