import { formatMinor } from '@chopnow/shared-utils';
import type { DbOrTx } from '../../db/client.js';
import { notify, orderParties } from './notify.js';

/**
 * Every user-facing notification, in one place so the wording stays consistent. Each function is
 * called inside the transaction of the change it describes.
 */

const lagosTime = (d: Date | null | undefined) => (d ? new Date(d.getTime() + 3_600_000).toISOString().slice(11, 16) : null);
const naira = (kobo: number) => formatMinor(kobo);

/** Restaurant: a new order has arrived (cash orders on placement, online orders once paid). */
export async function notifyNewOrder(db: DbOrTx, orderId: string, at: Date) {
  const p = await orderParties(db, orderId);
  if (!p.vendorUserId) return;
  await notify(db, {
    userId: p.vendorUserId, type: 'order.new', orderId, dedupeKey: `order:${orderId}:new`,
    title: `New order ${p.order.code}`,
    body: `${naira(p.order.totalKobo)} · ${p.order.paymentMethod === 'ONLINE' ? 'paid online' : 'cash on delivery'}. Accept within 10 minutes.`,
    data: { restaurantId: p.order.restaurant.id }, push: { priority: 'high' },
  }, at);
}

export async function notifyPaymentConfirmed(db: DbOrTx, orderId: string, at: Date) {
  const p = await orderParties(db, orderId);
  await notify(db, { userId: p.customerId, type: 'payment.confirmed', orderId, dedupeKey: `order:${orderId}:paid`, title: 'Payment confirmed', body: `We’ve sent your order to ${p.order.restaurant.name}.` }, at);
}

export async function notifyAccepted(db: DbOrTx, orderId: string, at: Date) {
  const p = await orderParties(db, orderId);
  const ready = lagosTime(p.order.estimatedReadyAt);
  await notify(db, { userId: p.customerId, type: 'order.accepted', orderId, dedupeKey: `order:${orderId}:accepted`, title: `${p.order.restaurant.name} accepted your order`, body: ready ? `Food expected ready around ${ready}.` : 'They’re preparing it now.' }, at);
}

export async function notifyDelayed(db: DbOrTx, orderId: string, at: Date) {
  const p = await orderParties(db, orderId);
  const ready = lagosTime(p.order.estimatedReadyAt);
  await notify(db, { userId: p.customerId, type: 'order.delayed', orderId, dedupeKey: `order:${orderId}:delay:${p.order.estimatedReadyAt?.getTime()}`, title: 'Your food is running a little late', body: ready ? `${p.order.restaurant.name} now expects it ready around ${ready}.` : `${p.order.restaurant.name} needs a little more time.` }, at);
}

/** Order closed without delivery. The customer always hears; the restaurant hears unless it closed it. */
export async function notifyClosed(db: DbOrTx, orderId: string, how: 'CANCELLED' | 'REJECTED', reason: string, refund: boolean, actorRole: string, at: Date) {
  const p = await orderParties(db, orderId);
  const refundText = refund ? ' Your payment will be refunded.' : '';
  const list = [];
  if (actorRole !== 'CUSTOMER') {
    list.push({ userId: p.customerId, type: how === 'REJECTED' ? 'order.rejected' : 'order.cancelled', orderId, dedupeKey: `order:${orderId}:closed:customer`, title: how === 'REJECTED' ? `${p.order.restaurant.name} couldn’t take your order` : `Order ${p.order.code} was cancelled`, body: `${reason}.${refundText}`.replace('..', '.') });
  }
  if (p.vendorUserId && actorRole !== 'VENDOR') {
    list.push({ userId: p.vendorUserId, type: 'order.cancelled', orderId, dedupeKey: `order:${orderId}:closed:vendor`, title: `Order ${p.order.code} ${how === 'REJECTED' ? 'expired' : 'was cancelled'}`, body: how === 'REJECTED' ? 'It wasn’t accepted in time.' : 'Don’t prepare it.', data: { restaurantId: p.order.restaurant.id } });
  }
  if (p.riderUserId) list.push({ userId: p.riderUserId, type: 'delivery.cancelled', orderId, dedupeKey: `order:${orderId}:closed:rider`, title: `Order ${p.order.code} was cancelled`, body: 'You no longer need to collect it.' });
  await notify(db, list, at);
}

export async function notifyRiderAssigned(db: DbOrTx, orderId: string, at: Date) {
  const p = await orderParties(db, orderId);
  await notify(db, { userId: p.customerId, type: 'delivery.assigned', orderId, dedupeKey: `order:${orderId}:assigned:${p.riderUserId}`, title: `${p.riderFirstName ?? 'A rider'} will deliver your order`, body: `They’re heading to ${p.order.restaurant.name}.` }, at);
}

export async function notifyPickedUp(db: DbOrTx, orderId: string, at: Date) {
  const p = await orderParties(db, orderId);
  await notify(db, { userId: p.customerId, type: 'delivery.picked_up', orderId, dedupeKey: `order:${orderId}:picked_up`, title: 'Your food is on the way', body: `${p.riderFirstName ?? 'Your rider'} has collected it. Have your 4-digit PIN ready.`, push: { priority: 'high' } }, at);
}

export async function notifyDelivered(db: DbOrTx, orderId: string, at: Date) {
  const p = await orderParties(db, orderId);
  await notify(db, { userId: p.customerId, type: 'order.delivered', orderId, dedupeKey: `order:${orderId}:delivered`, title: 'Delivered. Enjoy your meal!', body: `Tell us how ${p.order.restaurant.name} did.` }, at);
}

export async function notifyDeliveryProblem(db: DbOrTx, orderId: string, at: Date) {
  const p = await orderParties(db, orderId);
  await notify(db, { userId: p.customerId, type: 'delivery.problem', orderId, dedupeKey: `order:${orderId}:problem:${at.getTime()}`, title: 'There’s a problem with your delivery', body: 'Our team is sorting it out and will contact you shortly.', push: { priority: 'high' } }, at);
}

// ───────── Riders ─────────

export async function notifyOffer(db: DbOrTx, p: { offerId: string; riderUserId: string; orderId: string; restaurantName: string; earningKobo: number; cashKobo: number; ttlSeconds: number }, at: Date) {
  await notify(db, {
    userId: p.riderUserId, type: 'delivery.offer', orderId: p.orderId, dedupeKey: `offer:${p.offerId}`,
    title: `New delivery: earn ${naira(p.earningKobo)}`,
    body: `Collect from ${p.restaurantName}${p.cashKobo ? ` · collect ${naira(p.cashKobo)} cash` : ''}. Open the app to accept.`,
    data: { offerId: p.offerId }, push: { priority: 'high', ttlSeconds: p.ttlSeconds },
  }, at);
}

export async function notifyRiderJobChange(db: DbOrTx, riderUserId: string, orderId: string, kind: 'assigned' | 'removed', code: string, at: Date) {
  await notify(db, {
    userId: riderUserId, type: kind === 'assigned' ? 'delivery.assigned_by_staff' : 'delivery.unassigned', orderId, dedupeKey: `order:${orderId}:staff:${kind}:${riderUserId}:${at.getTime()}`,
    title: kind === 'assigned' ? `ChopNow gave you order ${code}` : `Order ${code} was taken off you`,
    body: kind === 'assigned' ? 'Open the app for the pickup details.' : 'You don’t need to collect it.', push: { priority: 'high' },
  }, at);
}

// ───────── Accounts and money ─────────

export async function notifyApproval(db: DbOrTx, p: { userId: string; what: 'restaurant' | 'rider'; name: string; status: 'APPROVED' | 'REJECTED' | 'SUSPENDED'; reason?: string | null; entityId: string }, at: Date) {
  const title = p.status === 'APPROVED' ? (p.what === 'restaurant' ? `${p.name} is approved` : 'You’re approved to ride with ChopNow') : p.status === 'REJECTED' ? `Your ${p.what} application wasn’t approved` : `Your ${p.what} account is suspended`;
  const body = p.status === 'APPROVED' ? (p.what === 'restaurant' ? 'Switch on “Accepting orders” when you’re ready.' : 'Go online in the app to start receiving deliveries.') : (p.reason ?? 'Contact ChopNow support for details.');
  await notify(db, { userId: p.userId, type: `${p.what}.${p.status.toLowerCase()}`, dedupeKey: `${p.what}:${p.entityId}:${p.status}:${at.getTime()}`, title, body }, at);
}

export async function notifyDocumentRejected(db: DbOrTx, p: { userId: string; documentId: string; note: string }, at: Date) {
  await notify(db, { userId: p.userId, type: 'document.rejected', dedupeKey: `document:${p.documentId}:rejected:${at.getTime()}`, title: 'Please upload a document again', body: p.note }, at);
}

export async function notifyRemittance(db: DbOrTx, p: { riderUserId: string; remittanceId: string; amountKobo: number; confirmed: boolean; reason?: string }, at: Date) {
  await notify(db, {
    userId: p.riderUserId, type: p.confirmed ? 'cash.confirmed' : 'cash.rejected', dedupeKey: `remittance:${p.remittanceId}:${p.confirmed ? 'confirmed' : 'rejected'}`,
    title: p.confirmed ? `Cash hand-in of ${naira(p.amountKobo)} confirmed` : 'We couldn’t match your cash transfer',
    body: p.confirmed ? 'Thank you. Your cash balance has been updated.' : (p.reason ?? 'Contact ChopNow finance.'),
  }, at);
}

export async function notifyPayout(db: DbOrTx, p: { userId: string; payoutId: string; amountKobo: number; reference: string }, at: Date) {
  await notify(db, { userId: p.userId, type: 'payout.paid', dedupeKey: `payout:${p.payoutId}:paid`, title: `ChopNow sent you ${naira(p.amountKobo)}`, body: `Bank transfer reference ${p.reference}. It may take a few hours to show.` }, at);
}

export async function notifyRefund(db: DbOrTx, p: { customerId: string; refundId: string; orderId: string; amountKobo: number; manual: boolean }, at: Date) {
  await notify(db, {
    userId: p.customerId, type: 'refund.completed', orderId: p.orderId, dedupeKey: `refund:${p.refundId}:paid`,
    title: `Refund of ${naira(p.amountKobo)} sent`,
    body: p.manual ? 'We’ve sent it by bank transfer.' : 'Banks can take up to 10 working days to show it on your statement.',
  }, at);
}
