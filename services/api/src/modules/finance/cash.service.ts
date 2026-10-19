import type { Db, Tx } from '../../db/client.js';
import type { Prisma, RemittanceMethod, RemittanceStatus } from '../../generated/prisma/client.js';
import { AppError, Errors } from '../../lib/errors.js';
import { writeAudit, type RequestContext } from '../audit/audit.js';
import type { Principal } from '../auth/auth.service.js';
import { cashLimitFor } from '../dispatch/dispatch.service.js';
import { getBusinessRules } from '../settings/business-rules.js';
import { postJournal } from './ledger.js';
import { notifyRemittance } from '../notifications/messages.js';

const OPEN = ['OUTSTANDING', 'PARTIALLY_RECONCILED'] as const;

const remittanceInclude = {
  rider: { select: { user: { select: { fullName: true } } } },
  allocations: { include: { cashCollection: { select: { order: { select: { code: true } } } } } },
} satisfies Prisma.CashRemittanceInclude;
type RemittanceRow = Prisma.CashRemittanceGetPayload<{ include: typeof remittanceInclude }>;

const toDto = (r: RemittanceRow) => ({
  id: r.id,
  riderId: r.riderId,
  riderName: r.rider.user.fullName,
  amountKobo: r.amountKobo,
  method: r.method,
  reference: r.reference,
  status: r.status,
  note: r.note,
  confirmedAt: r.confirmedAt,
  createdAt: r.createdAt,
  allocations: r.allocations.map((a) => ({ orderCode: a.cashCollection.order.code, amountKobo: a.amountKobo })),
});

/**
 * Cash riders collected on deliveries and hand to ChopNow. A rider declares a bank transfer (or
 * finance records a counted hand-in); confirming it clears the rider's oldest open collections first
 * and posts Dr PLATFORM_BANK / Cr RIDER_CASH_HELD. A remittance can never exceed what is outstanding.
 */
export class CashService {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private async outstanding(tx: Tx | Db, riderId: string) {
    const rows = await tx.cashCollection.findMany({ where: { riderId, reconciliationStatus: { in: [...OPEN] } }, select: { amountCollectedKobo: true, amountReconciledKobo: true } });
    return rows.reduce((s, c) => s + c.amountCollectedKobo - c.amountReconciledKobo, 0);
  }

  async positions() {
    const rules = await getBusinessRules(this.db);
    const open = await this.db.cashCollection.findMany({
      where: { riderId: { not: null }, reconciliationStatus: { in: [...OPEN] } },
      select: { riderId: true, amountCollectedKobo: true, amountReconciledKobo: true, collectedAt: true },
    });
    const pending = await this.db.cashRemittance.groupBy({ by: ['riderId'], where: { status: 'PENDING_CONFIRMATION' }, _sum: { amountKobo: true } });
    const byRider = new Map<string, { outstanding: number; count: number; oldest: Date | null }>();
    for (const c of open) {
      const e = byRider.get(c.riderId!) ?? { outstanding: 0, count: 0, oldest: null };
      e.outstanding += c.amountCollectedKobo - c.amountReconciledKobo;
      e.count++;
      if (c.collectedAt && (!e.oldest || c.collectedAt < e.oldest)) e.oldest = c.collectedAt;
      byRider.set(c.riderId!, e);
    }
    const riders = await this.db.rider.findMany({ where: { id: { in: [...byRider.keys()] } }, include: { user: { select: { fullName: true } } } });
    const items = riders
      .map((r) => {
        const e = byRider.get(r.id)!;
        return {
          riderId: r.id,
          riderName: r.user.fullName,
          outstandingKobo: e.outstanding,
          limitKobo: cashLimitFor(r, rules),
          openCollections: e.count,
          oldestCollectedAt: e.oldest,
          pendingDeclaredKobo: pending.find((p) => p.riderId === r.id)?._sum.amountKobo ?? 0,
        };
      })
      .sort((a, b) => b.outstandingKobo - a.outstandingKobo);
    return { items, totalOutstandingKobo: items.reduce((s, i) => s + i.outstandingKobo, 0) };
  }

  async list(q: { page: number; pageSize: number; status?: RemittanceStatus; riderId?: string }) {
    const where: Prisma.CashRemittanceWhereInput = { ...(q.status ? { status: q.status } : {}), ...(q.riderId ? { riderId: q.riderId } : {}) };
    const [total, rows] = await Promise.all([
      this.db.cashRemittance.count({ where }),
      this.db.cashRemittance.findMany({ where, include: remittanceInclude, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    ]);
    return { items: rows.map(toDto), page: q.page, pageSize: q.pageSize, total };
  }

  private async get(id: string) {
    const r = await this.db.cashRemittance.findUnique({ where: { id }, include: remittanceInclude });
    if (!r) throw Errors.notFound('Remittance');
    return toDto(r);
  }

  /** Rider app: "I've transferred ₦X, reference Y". Waits for finance to match it to the bank statement. */
  async declare(principal: Principal, input: { amountKobo: number; reference: string }) {
    const rider = await this.db.rider.findUnique({ where: { userId: principal.userId } });
    if (!rider) throw Errors.notFound('Rider profile');
    const id = await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM riders WHERE id = ${rider.id}::uuid FOR UPDATE`;
      const out = await this.outstanding(tx, rider.id);
      const pending = await tx.cashRemittance.aggregate({ where: { riderId: rider.id, status: 'PENDING_CONFIRMATION' }, _sum: { amountKobo: true } });
      const available = out - (pending._sum.amountKobo ?? 0);
      if (input.amountKobo > available) throw new AppError(422, 'REMITTANCE_EXCEEDS_OUTSTANDING', available > 0 ? `You can declare at most ${available} kobo (cash still to hand in, minus transfers awaiting confirmation).` : 'You have no cash to hand in.', { availableKobo: available });
      const r = await tx.cashRemittance.create({ data: { riderId: rider.id, amountKobo: input.amountKobo, method: 'BANK_TRANSFER', reference: input.reference, createdAt: this.now() } });
      return r.id;
    });
    return this.get(id);
  }

  async ownList(principal: Principal) {
    const rider = await this.db.rider.findUnique({ where: { userId: principal.userId } });
    if (!rider) throw Errors.notFound('Rider profile');
    const rows = await this.db.cashRemittance.findMany({ where: { riderId: rider.id }, include: remittanceInclude, orderBy: { createdAt: 'desc' }, take: 50 });
    return { items: rows.map(toDto), page: 1, pageSize: 50, total: rows.length };
  }

  /** Finance counted the cash (or saw the transfer) itself: record and confirm in one step. */
  async record(actor: Principal, input: { riderId: string; amountKobo: number; method: RemittanceMethod; reference?: string; note?: string }, ctx: RequestContext) {
    const rider = await this.db.rider.findUnique({ where: { id: input.riderId } });
    if (!rider) throw Errors.notFound('Rider');
    const id = await this.db.$transaction(async (tx) => {
      const r = await tx.cashRemittance.create({ data: { riderId: input.riderId, amountKobo: input.amountKobo, method: input.method, reference: input.reference ?? null, note: input.note ?? null, createdAt: this.now() } });
      await this.confirmIn(tx, actor, r.id, ctx);
      return r.id;
    });
    return this.get(id);
  }

  async confirm(actor: Principal, id: string, ctx: RequestContext) {
    await this.db.$transaction((tx) => this.confirmIn(tx, actor, id, ctx));
    return this.get(id);
  }

  private async confirmIn(tx: Tx, actor: Principal, id: string, ctx: RequestContext) {
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM cash_remittances WHERE id = ${id}::uuid FOR UPDATE`;
    if (locked.length === 0) throw Errors.notFound('Remittance');
    const r = await tx.cashRemittance.findUniqueOrThrow({ where: { id } });
    if (r.status !== 'PENDING_CONFIRMATION') throw new AppError(409, 'REMITTANCE_NOT_PENDING', 'This remittance has already been decided.');

    // Oldest open collections first, locked so two confirmations can't clear the same cash.
    const open = await tx.$queryRaw<{ id: string; collected: number; reconciled: number }[]>`
      SELECT id, "amountCollectedKobo" AS collected, "amountReconciledKobo" AS reconciled FROM cash_collections
      WHERE "riderId" = ${r.riderId}::uuid AND "reconciliationStatus" IN ('OUTSTANDING', 'PARTIALLY_RECONCILED')
      ORDER BY "collectedAt" ASC NULLS LAST, id ASC FOR UPDATE`;
    const outstanding = open.reduce((s, c) => s + c.collected - c.reconciled, 0);
    if (r.amountKobo > outstanding) {
      throw new AppError(409, 'REMITTANCE_EXCEEDS_OUTSTANDING', `This rider only has ${outstanding} kobo outstanding. Correct the amount or reject it.`, { outstandingKobo: outstanding });
    }
    let left = r.amountKobo;
    for (const c of open) {
      if (left === 0) break;
      const take = Math.min(left, c.collected - c.reconciled);
      left -= take;
      const reconciled = c.reconciled + take;
      await tx.cashCollection.update({ where: { id: c.id }, data: { amountReconciledKobo: reconciled, reconciliationStatus: reconciled === c.collected ? 'RECONCILED' : 'PARTIALLY_RECONCILED' } });
      await tx.cashRemittanceAllocation.create({ data: { remittanceId: r.id, cashCollectionId: c.id, amountKobo: take } });
    }
    const now = this.now();
    await tx.cashRemittance.update({ where: { id }, data: { status: 'CONFIRMED', confirmedById: actor.userId, confirmedAt: now } });
    await postJournal(tx, {
      type: 'CASH_REMITTED',
      idempotencyKey: `remittance:${r.id}:confirmed`,
      description: `Rider cash hand-in ${r.reference ?? r.id} (${r.method.toLowerCase().replace('_', ' ')})`,
      remittanceId: r.id,
      createdById: actor.userId,
      at: now,
      lines: [
        { account: 'PLATFORM_BANK', direction: 'DEBIT', amountKobo: r.amountKobo },
        { account: 'RIDER_CASH_HELD', direction: 'CREDIT', amountKobo: r.amountKobo, riderId: r.riderId },
      ],
    });
    const riderUser = await tx.rider.findUniqueOrThrow({ where: { id: r.riderId }, select: { userId: true } });
    await notifyRemittance(tx, { riderUserId: riderUser.userId, remittanceId: r.id, amountKobo: r.amountKobo, confirmed: true }, now);
    await writeAudit(tx, { actorUserId: actor.userId, actorRole: actor.role, action: 'cash.remittance_confirm', entityType: 'CashRemittance', entityId: id, after: { amountKobo: r.amountKobo, method: r.method, reference: r.reference } }, ctx);
  }

  async reject(actor: Principal, id: string, reason: string, ctx: RequestContext) {
    const res = await this.db.cashRemittance.updateMany({ where: { id, status: 'PENDING_CONFIRMATION' }, data: { status: 'REJECTED', note: reason, confirmedById: actor.userId, confirmedAt: this.now() } });
    if (res.count !== 1) {
      await this.get(id);
      throw new AppError(409, 'REMITTANCE_NOT_PENDING', 'This remittance has already been decided.');
    }
    await writeAudit(this.db, { actorUserId: actor.userId, actorRole: actor.role, action: 'cash.remittance_reject', entityType: 'CashRemittance', entityId: id, after: { reason } }, ctx);
    const r = await this.db.cashRemittance.findUniqueOrThrow({ where: { id }, select: { amountKobo: true, rider: { select: { userId: true } } } });
    await notifyRemittance(this.db, { riderUserId: r.rider.userId, remittanceId: id, amountKobo: r.amountKobo, confirmed: false, reason }, this.now());
    return this.get(id);
  }
}
