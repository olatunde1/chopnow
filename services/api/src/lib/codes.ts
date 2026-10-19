import { randomInt } from 'node:crypto';

// No 0/O, 1/I/L, U to avoid misreading over the phone.
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';

function randomString(length: number): string {
  let s = '';
  for (let i = 0; i < length; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return s;
}

/** Customer-facing order reference, e.g. CN-7K3Q9P (30^6 ≈ 729M combinations; uniqueness enforced by the DB). */
export function generateOrderCode(): string {
  return `CN-${randomString(6)}`;
}

export function generateTicketCode(): string {
  return `ST-${randomString(6)}`;
}

/** 4-digit proof-of-delivery PIN. */
export function generateDeliveryPin(): string {
  return randomInt(0, 10_000).toString().padStart(4, '0');
}

/** Our reference for a payout transfer, e.g. PO-7K3Q9P2M (quoted in the bank transfer narration). */
export function generatePayoutReference(): string {
  return `PO-${randomString(8)}`;
}
