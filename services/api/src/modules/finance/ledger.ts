import type { DbOrTx } from '../../db/client.js';
import type { FinancialTransactionType, LedgerAccount, LedgerDirection } from '../../generated/prisma/client.js';

export interface LedgerLine {
  account: LedgerAccount;
  direction: LedgerDirection;
  amountKobo: number;
  restaurantId?: string;
  riderId?: string;
}

export interface JournalInput {
  type: FinancialTransactionType;
  /** Unique per business event, e.g. `payment:<id>:captured`. Re-posting the same key is a no-op. */
  idempotencyKey: string;
  description: string;
  orderId?: string;
  paymentId?: string;
  refundId?: string;
  remittanceId?: string;
  payoutId?: string;
  createdById?: string;
  /** Business time of the event (the app clock). Defaults to the database time. */
  at?: Date;
  lines: LedgerLine[];
}

/**
 * Posts a balanced journal entry exactly once. Must be called inside the same database transaction
 * as the business change it records. The database also enforces balance and immutability.
 */
export async function postJournal(tx: DbOrTx, input: JournalInput): Promise<{ id: string; created: boolean }> {
  const existing = await tx.financialTransaction.findUnique({ where: { idempotencyKey: input.idempotencyKey }, select: { id: true } });
  if (existing) return { id: existing.id, created: false };

  const lines = input.lines.filter((l) => l.amountKobo !== 0);
  for (const l of lines) {
    if (!Number.isSafeInteger(l.amountKobo) || l.amountKobo < 0) throw new Error(`Ledger amounts must be positive integers (${input.idempotencyKey})`);
  }
  const debit = lines.filter((l) => l.direction === 'DEBIT').reduce((s, l) => s + l.amountKobo, 0);
  const credit = lines.filter((l) => l.direction === 'CREDIT').reduce((s, l) => s + l.amountKobo, 0);
  if (debit !== credit || debit === 0) throw new Error(`Unbalanced journal ${input.idempotencyKey}: ${debit} != ${credit}`);

  const { lines: _l, at, ...header } = input;
  const created = await tx.financialTransaction.create({
    data: { ...header, ...(at ? { createdAt: at } : {}), entries: { create: lines.map((l) => (at ? { ...l, createdAt: at } : l)) } },
    select: { id: true },
  });
  return { id: created.id, created: true };
}
