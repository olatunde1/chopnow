import { formatMinor, minutesToHHMM, parseMajorToMinor } from '@chopnow/shared-utils';

export const money = (kobo) => (kobo === null || kobo === undefined ? '—' : formatMinor(kobo));

/** "2500" or "2,500.50" (naira) → kobo, or null when the text isn't a valid amount. */
export function nairaToKobo(text) {
  const cleaned = String(text ?? '').replace(/[₦,\s]/g, '');
  if (!cleaned) return null;
  try {
    const kobo = parseMajorToMinor(cleaned);
    return kobo >= 0 ? kobo : null;
  } catch {
    return null;
  }
}

export const koboToNairaInput = (kobo) => (kobo === null || kobo === undefined ? '' : (kobo / 100).toFixed(kobo % 100 ? 2 : 0));

export const time = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' }) : '—');
export const dateTime = (iso) =>
  iso ? new Date(iso).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' }) : '—';

export const hhmm = minutesToHHMM;

/** Today's date in Lagos as YYYY-MM-DD. */
export function lagosToday(now = new Date()) {
  return new Date(now.getTime() + 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function daysAgo(isoDate, n) {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
}

const STATUS = {
  PLACED: ['New', 'brand'],
  ACCEPTED: ['Accepted', 'info'],
  PREPARING: ['Preparing', 'info'],
  READY_FOR_PICKUP: ['Ready for pickup', 'ok'],
  PICKED_UP: ['Picked up', 'ok'],
  DELIVERED: ['Delivered', 'ok'],
  CANCELLED: ['Cancelled', 'bad'],
  REJECTED: ['Declined', 'bad'],
  DELIVERY_EXCEPTION: ['Delivery problem', 'warn'],
};
export const orderStatus = (s) => ({ label: STATUS[s]?.[0] ?? s, tone: STATUS[s]?.[1] ?? 'neutral' });

export const APPROVAL = {
  PENDING: { label: 'Awaiting approval', tone: 'warn' },
  APPROVED: { label: 'Approved', tone: 'ok' },
  REJECTED: { label: 'Not approved', tone: 'bad' },
  SUSPENDED: { label: 'Suspended', tone: 'bad' },
};
