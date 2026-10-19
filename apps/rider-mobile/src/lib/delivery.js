import { formatMinor, parseMajorToMinor } from '@chopnow/shared-utils';

export const money = (kobo) => formatMinor(kobo ?? 0);

/** "650 m" / "2.4 km"; null when unknown. */
export function distanceLabel(meters) {
  if (meters === null || meters === undefined) return null;
  return meters < 1000 ? `${Math.round(meters / 10) * 10} m` : `${(meters / 1000).toFixed(1)} km`;
}

/** Seconds left on an offer, never negative. */
export const secondsLeft = (expiresAt, now = Date.now()) => Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 1000));

/** What the rider should do next, for the big heading on the delivery screen. */
export function stepFor(delivery) {
  switch (delivery.status) {
    case 'ASSIGNED':
      return { key: 'to_restaurant', title: `Go to ${delivery.restaurant.name}`, hint: delivery.foodReady ? 'The food is ready for you.' : 'Tap “I’ve arrived” when you get there.' };
    case 'ARRIVED_AT_RESTAURANT':
      return { key: 'pickup', title: 'Collect the order', hint: delivery.foodReady ? `Ask for order ${delivery.orderCode} and check the items.` : 'Waiting for the restaurant to mark the food ready.' };
    case 'PICKED_UP':
      return { key: 'to_customer', title: `Deliver to ${delivery.dropoff?.customerFirstName ?? 'the customer'}`, hint: delivery.cashToCollectKobo ? `Collect ${money(delivery.cashToCollectKobo)} in cash, then enter their PIN.` : 'Paid online: don’t collect any cash. Ask for their 4-digit PIN.' };
    case 'DELIVERED':
      return { key: 'done', title: 'Delivered', hint: 'Nice work.' };
    case 'FAILED':
      return { key: 'failed', title: 'Problem reported', hint: 'Operations will contact you about the food. Go online again when you’re free.' };
    default:
      return { key: 'other', title: 'Delivery', hint: '' };
  }
}

/**
 * Validates the completion form. Cash must be the full amount due (the API also enforces this,
 * unless partial collection is enabled by operations).
 */
export function validateCompletion({ pin, cashText }, delivery) {
  const errors = {};
  if (!/^\d{4}$/.test(pin)) errors.pin = 'Enter the 4-digit PIN from the customer';
  let cashCollectedKobo;
  if (delivery.cashToCollectKobo > 0) {
    try {
      cashCollectedKobo = parseMajorToMinor(String(cashText ?? '').replace(/[₦,\s]/g, '') || 'x');
    } catch {
      cashCollectedKobo = undefined;
    }
    if (cashCollectedKobo === undefined) errors.cash = 'Enter the cash you received, e.g. 4250';
    else if (cashCollectedKobo !== delivery.cashToCollectKobo) errors.cash = `Collect exactly ${money(delivery.cashToCollectKobo)}. If they can’t pay, report a problem.`;
  }
  return { ok: Object.keys(errors).length === 0, errors, cashCollectedKobo };
}

/** Maps link for a destination; prefers coordinates, falls back to the address text. */
export function mapsUrl(place) {
  const q = place.latitude !== null && place.latitude !== undefined ? `${place.latitude},${place.longitude}` : [place.line1 ?? place.addressLine, place.area, 'Lagos'].filter(Boolean).join(', ');
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(q)}`;
}

export const VEHICLE_LABEL = { MOTORCYCLE: 'Motorcycle', BICYCLE: 'Bicycle', CAR: 'Car', ON_FOOT: 'On foot' };
export const APPROVAL_LABEL = { PENDING: 'Awaiting approval', APPROVED: 'Approved', REJECTED: 'Not approved', SUSPENDED: 'Suspended' };
export const RELEASE_REASONS = [
  ['VEHICLE_ISSUE', 'Vehicle problem'],
  ['EMERGENCY', 'Personal emergency'],
  ['RESTAURANT_TOO_SLOW', 'Food taking too long'],
  ['OTHER', 'Other'],
];
export const PROBLEM_REASONS = [
  ['CUSTOMER_UNREACHABLE', 'Can’t reach the customer'],
  ['CUSTOMER_REFUSED', 'Customer refused the order'],
  ['CANNOT_PAY', 'Customer can’t pay'],
  ['WRONG_ADDRESS', 'Can’t find the address'],
  ['UNSAFE', 'Location feels unsafe'],
  ['ACCIDENT', 'Accident or emergency'],
  ['OTHER', 'Other'],
];
export const DOCUMENT_TYPES = [
  ['DRIVERS_LICENCE', 'Driver’s licence'],
  ['RIDER_ID', 'Government ID'],
  ['VEHICLE_PAPERS', 'Vehicle papers'],
  ['OTHER', 'Other'],
];

/** Today's date in Lagos (UTC+1) as YYYY-MM-DD. */
export const lagosToday = (now = new Date()) => new Date(now.getTime() + 3_600_000).toISOString().slice(0, 10);
export const daysAgo = (isoDate, n) => new Date(Date.parse(`${isoDate}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

/** Validates a declared cash transfer: an amount in naira, up to what can still be declared. */
export function validateHandIn({ amountText, reference }, availableKobo) {
  const errors = {};
  let amountKobo;
  try {
    amountKobo = parseMajorToMinor(String(amountText ?? '').replace(/[₦,\s]/g, '') || 'x');
  } catch {
    amountKobo = undefined;
  }
  if (amountKobo === undefined || amountKobo <= 0) errors.amount = 'Enter the amount you transferred, e.g. 8700';
  else if (amountKobo > availableKobo) errors.amount = `You can declare at most ${money(availableKobo)}`;
  if (String(reference ?? '').trim().length < 3) errors.reference = 'Enter the transfer reference from your bank app';
  return { ok: Object.keys(errors).length === 0, errors, amountKobo };
}

export const REMITTANCE_STATUS = { PENDING_CONFIRMATION: ['Awaiting confirmation', 'warning'], CONFIRMED: ['Confirmed', 'success'], REJECTED: ['Not matched', 'danger'] };
export const SETTLEMENT_STATUS = { APPROVED: ['Approved', 'info'], PAYOUT_INITIATED: ['Transfer in progress', 'warning'], PAID: ['Paid', 'success'], FAILED: ['Transfer failed', 'danger'] };
