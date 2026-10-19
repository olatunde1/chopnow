import * as WebBrowser from 'expo-web-browser';
import { api } from './api';
import { createIdempotencyTracker } from './orders';

const trackers = new Map();
const trackerFor = (orderId) => {
  if (!trackers.has(orderId)) trackers.set(orderId, createIdempotencyTracker());
  return trackers.get(orderId);
};

/**
 * Opens the provider's checkout for an order, then asks the API whether it was paid. The API checks
 * with the provider itself; this app never decides that a payment succeeded.
 * Returns the API's verification result ({ status, message, ... }).
 */
export async function payForOrder(orderId) {
  const tracker = trackerFor(orderId);
  let init;
  try {
    init = await api.orders.startPayment(orderId, tracker.keyFor({ orderId }));
    tracker.settle(null);
  } catch (err) {
    tracker.settle(err);
    throw err;
  }
  await WebBrowser.openBrowserAsync(init.authorizationUrl, { showTitle: true, enableBarCollapsing: true });
  return { init, result: await api.orders.verifyPayment(init.reference) };
}
