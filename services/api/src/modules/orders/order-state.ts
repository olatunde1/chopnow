import { canTransitionOrder } from '@chopnow/shared-schemas';
import type { Tx } from '../../db/client.js';
import type { OrderStatus, Prisma } from '../../generated/prisma/client.js';
import { AppError } from '../../lib/errors.js';

export interface Actor {
  userId: string | null;
  /** Role name, or 'SYSTEM' for timeouts and payment events. */
  role: string;
}

const TIMESTAMP: Partial<Record<OrderStatus, keyof Prisma.OrderUpdateManyMutationInput>> = {
  ACCEPTED: 'acceptedAt',
  PREPARING: 'preparingAt',
  READY_FOR_PICKUP: 'readyAt',
  PICKED_UP: 'pickedUpAt',
  DELIVERED: 'deliveredAt',
  CANCELLED: 'cancelledAt',
  REJECTED: 'rejectedAt',
};

/**
 * The only way an order's fulfilment status changes. Checks the transition table, applies the change
 * only if the order is still in the expected state (so two concurrent actions cannot both succeed),
 * stamps the matching timestamp and appends to the status history.
 */
export async function transitionOrder(
  tx: Tx,
  params: { orderId: string; from: OrderStatus; to: OrderStatus; actor: Actor; reason?: string; data?: Prisma.OrderUpdateManyMutationInput },
): Promise<void> {
  const { orderId, from, to, actor, reason } = params;
  if (!canTransitionOrder(from, to)) {
    throw new AppError(409, 'INVALID_ORDER_TRANSITION', `An order that is ${from.toLowerCase().replace(/_/g, ' ')} cannot become ${to.toLowerCase().replace(/_/g, ' ')}`);
  }
  const now = new Date();
  const stamp = TIMESTAMP[to];
  const updated = await tx.order.updateMany({
    where: { id: orderId, status: from },
    data: { ...params.data, status: to, ...(stamp ? { [stamp]: now } : {}) },
  });
  if (updated.count !== 1) {
    throw new AppError(409, 'ORDER_STATE_CHANGED', 'This order was updated by someone else. Refresh and try again.');
  }
  await tx.orderStatusHistory.create({
    data: { orderId, fromStatus: from, toStatus: to, actorUserId: actor.userId, actorRole: actor.role, reason: reason ?? null, createdAt: now },
  });
}
