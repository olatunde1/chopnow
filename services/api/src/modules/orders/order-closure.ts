import type { Tx } from '../../db/client.js';
import type { Order, OrderStatus } from '../../generated/prisma/client.js';
import { cancelDelivery } from '../dispatch/dispatch.service.js';
import { transitionOrder, type Actor } from './order-state.js';
import { notifyClosed } from '../notifications/messages.js';

/**
 * Ends an order that will not be fulfilled (customer cancel, restaurant reject, accept timeout).
 * In one transaction: status change + history, promotion released, open payment attempts abandoned,
 * and, if the customer already paid, paymentStatus REFUND_PENDING plus a full refund request.
 * Returns whether a refund was requested.
 */
export async function closeUnfulfilledOrder(
  tx: Tx,
  params: { order: Pick<Order, 'id' | 'status' | 'paymentStatus'>; to: Extract<OrderStatus, 'CANCELLED' | 'REJECTED'>; actor: Actor; reason: string },
): Promise<{ refundRequested: boolean }> {
  const { order, to, actor, reason } = params;
  // Same lock order as payment confirmation (payments, then the order), and decide from fresh data:
  // callers pass a snapshot read before this transaction, and a payment confirmed in between must
  // be refunded, never lost.
  await tx.$queryRaw`SELECT id FROM payments WHERE "orderId" = ${order.id}::uuid FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM orders WHERE id = ${order.id}::uuid FOR UPDATE`;
  const current = await tx.order.findUniqueOrThrow({ where: { id: order.id }, select: { paymentStatus: true } });
  const paid = current.paymentStatus === 'SUCCESSFUL';
  await transitionOrder(tx, {
    orderId: order.id,
    from: order.status,
    to,
    actor,
    reason,
    data: { cancellationReason: reason, ...(paid ? { paymentStatus: 'REFUND_PENDING' } : {}) },
  });
  await cancelDelivery(tx, order.id, reason, new Date());
  await tx.promotionRedemption.updateMany({ where: { orderId: order.id }, data: { isActive: false } });
  await tx.payment.updateMany({ where: { orderId: order.id, status: 'INITIALIZED' }, data: { status: 'ABANDONED', failureReason: `Order ${to.toLowerCase()}` } });
  if (paid) {
    const payment = await tx.payment.findFirstOrThrow({ where: { orderId: order.id, status: 'SUCCESSFUL' } });
    await tx.refund.create({
      data: {
        orderId: order.id,
        paymentId: payment.id,
        amountKobo: payment.amountKobo,
        reason: `${to === 'REJECTED' ? 'Order not accepted' : 'Order cancelled'}: ${reason}`,
        requestedById: actor.userId,
        idempotencyKey: `close:${order.id}`,
      },
    });
  }
  await notifyClosed(tx, order.id, to, reason, paid, actor.role, new Date());
  return { refundRequested: paid };
}
