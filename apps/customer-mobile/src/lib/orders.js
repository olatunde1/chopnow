/**
 * Order helpers shared by checkout, order detail and history.
 */

/** Cart lines → the API's OrderRequest items. Prices are deliberately not sent. */
export function toOrderItems(lines) {
  return lines.map((l) => ({
    menuItemId: l.menuItemId,
    variantId: l.variantId ?? null,
    extras: (l.extras ?? []).filter((e) => e.quantity > 0).map((e) => ({ extraId: e.id, quantity: e.quantity })),
    quantity: l.quantity,
    ...(l.instructions ? { specialInstructions: l.instructions } : {}),
  }));
}

/** A fresh Idempotency-Key. Uniqueness, not secrecy, is what matters here. */
export function newIdempotencyKey() {
  const rand = () => Math.random().toString(36).slice(2, 10);
  return `app-${Date.now().toString(36)}-${rand()}${rand()}`;
}

/**
 * Keeps one Idempotency-Key per logical request. A retry of the same request (e.g. after a timeout)
 * reuses the key, so the server returns the original order instead of creating a second one. A changed
 * request, or a request that definitively failed, gets a new key.
 */
export function createIdempotencyTracker() {
  let current = null; // { key, fingerprint }
  return {
    keyFor(request) {
      const fingerprint = JSON.stringify(request);
      if (!current || current.fingerprint !== fingerprint) current = { key: newIdempotencyKey(), fingerprint };
      return current.key;
    },
    /** Call after success or a definitive rejection. Network errors and 409 "in progress" keep the key. */
    settle(error) {
      const retryable = error && (error.code === 'NETWORK_ERROR' || error.status === 409 || error.status >= 500);
      if (!retryable) current = null;
    },
  };
}

export const ORDER_STEPS = ['PLACED', 'ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP', 'PICKED_UP', 'DELIVERED'];

const LABELS = {
  PLACED: 'Order placed',
  ACCEPTED: 'Accepted by restaurant',
  PREPARING: 'Being prepared',
  READY_FOR_PICKUP: 'Ready for pickup',
  PICKED_UP: 'On the way',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
  REJECTED: 'Declined by restaurant',
  DELIVERY_EXCEPTION: 'Delivery problem',
};
export const statusLabel = (s) => LABELS[s] ?? s;

export function statusTone(status) {
  if (status === 'DELIVERED') return 'success';
  if (status === 'CANCELLED' || status === 'REJECTED') return 'danger';
  if (status === 'DELIVERY_EXCEPTION') return 'warning';
  return 'brand';
}

const PAYMENT_LABELS = {
  PENDING: 'Awaiting payment',
  SUCCESSFUL: 'Paid',
  FAILED: 'Payment failed',
  REFUND_PENDING: 'Refund in progress',
  PARTIALLY_REFUNDED: 'Partly refunded',
  REFUNDED: 'Refunded',
};

/** Payment line for an order; cash orders read differently from online ones. */
export function paymentLabel(order) {
  if (order.paymentMethod === 'CASH_ON_DELIVERY') {
    if (order.paymentStatus === 'SUCCESSFUL') return 'Paid in cash';
    if (order.paymentStatus === 'PENDING') return 'Pay cash on delivery';
  }
  return PAYMENT_LABELS[order.paymentStatus] ?? order.paymentStatus;
}

export const isTerminal = (status) => status === 'DELIVERED' || status === 'CANCELLED' || status === 'REJECTED';

/** Plain-language rider progress for the customer (no live location in v1). */
export const riderLine = (deliveryStatus) =>
  deliveryStatus === 'ASSIGNED' ? 'is heading to the restaurant' : deliveryStatus === 'ARRIVED_AT_RESTAURANT' ? 'is at the restaurant' : deliveryStatus === 'PICKED_UP' ? 'is on the way to you' : 'is your rider';
