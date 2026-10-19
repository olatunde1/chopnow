import type { Tx } from '../../db/client.js';
import type { DeliveryStatus, OrderStatus } from '../../generated/prisma/client.js';
import { AppError } from '../../lib/errors.js';
import { postJournal } from '../finance/ledger.js';
import { postOrderSettlement } from '../finance/order-settlement.js';
import { transitionOrder, type Actor } from '../orders/order-state.js';
import { notifyDelivered } from '../notifications/messages.js';

export interface FinalizeInput {
  delivery: { id: string; currentRiderId: string | null };
  order: { id: string; code: string; status: OrderStatus; totalKobo: number; riderEarningKobo: number };
  cash: { id: string; amountDueKobo: number } | null;
  /** Cash actually received (cash orders only). */
  collectedKobo: number;
  actor: Actor;
  at: Date;
  /** The customer's PIN was checked, or a staff member confirmed delivery another way (audited by the caller). */
  proof: { kind: 'pin' } | { kind: 'override'; byUserId: string; reason: string };
  fromDeliveryStatuses: DeliveryStatus[];
}

/**
 * Everything that happens when food reaches the customer, in the caller's transaction: delivery and
 * order become DELIVERED, cash is recorded against the rider (and journalled), the rider's earning
 * is created, and the order's money is split (ORDER_SETTLED). Used by the rider app (PIN) and by
 * operations (proof override). Conditional updates make a second call fail with 409.
 */
export async function finalizeDelivery(tx: Tx, p: FinalizeInput) {
  const { delivery: d, order, cash, at } = p;
  const proof = p.proof.kind === 'pin' ? { pinVerifiedAt: at } : { proofOverrideById: p.proof.byUserId, proofOverrideReason: p.proof.reason };
  const moved = await tx.delivery.updateMany({ where: { id: d.id, status: { in: p.fromDeliveryStatuses }, pickedUpAt: { not: null } }, data: { status: 'DELIVERED', deliveredAt: at, ...proof } });
  if (moved.count !== 1) throw new AppError(409, 'DELIVERY_STATE_CHANGED', 'This delivery was updated. Refresh and try again.');
  await transitionOrder(tx, { orderId: order.id, from: order.status, to: 'DELIVERED', actor: p.actor, ...(p.proof.kind === 'override' ? { reason: p.proof.reason } : {}), ...(cash ? { data: { paymentStatus: 'SUCCESSFUL' } } : {}) });

  if (cash && d.currentRiderId) {
    await tx.cashCollection.update({
      where: { id: cash.id },
      data: { amountCollectedKobo: p.collectedKobo, status: p.collectedKobo === cash.amountDueKobo ? 'COLLECTED' : 'PARTIALLY_COLLECTED', collectedAt: at, reconciliationStatus: 'OUTSTANDING', riderId: d.currentRiderId },
    });
    await postJournal(tx, {
      type: 'CASH_COLLECTED',
      idempotencyKey: `cash:${cash.id}:collected`,
      at,
      description: `Cash collected by rider for order ${order.code}`,
      orderId: order.id,
      createdById: p.actor.userId ?? undefined,
      lines: [
        { account: 'RIDER_CASH_HELD', direction: 'DEBIT', amountKobo: p.collectedKobo, riderId: d.currentRiderId },
        { account: 'CUSTOMER_ORDER_FUNDS', direction: 'CREDIT', amountKobo: p.collectedKobo },
      ],
    });
  }
  if (d.currentRiderId) {
    await tx.riderEarning.create({ data: { riderId: d.currentRiderId, orderId: order.id, deliveryId: d.id, type: 'DELIVERY_FEE', amountKobo: order.riderEarningKobo, createdAt: at } });
    await tx.rider.update({ where: { id: d.currentRiderId }, data: { completedDeliveries: { increment: 1 } } });
    await postOrderSettlement(tx, { orderId: order.id, riderId: d.currentRiderId, receivedKobo: cash ? p.collectedKobo : order.totalKobo, at, createdById: p.actor.userId ?? undefined });
  }
  await notifyDelivered(tx, order.id, at);
  await tx.deliveryEvent.create({
    data: {
      deliveryId: d.id,
      riderId: d.currentRiderId,
      actorUserId: p.actor.userId,
      type: p.proof.kind === 'pin' ? 'DELIVERED' : 'DELIVERED_BY_OVERRIDE',
      note: [cash ? `Cash collected: ${p.collectedKobo}` : null, p.proof.kind === 'override' ? p.proof.reason : null].filter(Boolean).join(' · ') || null,
      createdAt: at,
    },
  });
}
