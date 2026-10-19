import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Short-lived ticket for opening the WebSocket. Browsers can't send an Authorization header on a
 * WebSocket, and putting the access token in the URL would leak it into logs; a 30-second ticket
 * bound to the user's token version is far less valuable if it leaks, and the user is re-checked
 * against the database when the socket opens.
 */
export const TICKET_TTL_SECONDS = 30;

const b64 = (b: Buffer) => b.toString('base64url');

export function signTicket(secret: string, p: { userId: string; tokenVersion: number }, now: Date) {
  const payload = b64(Buffer.from(JSON.stringify({ sub: p.userId, tv: p.tokenVersion, exp: Math.floor(now.getTime() / 1000) + TICKET_TTL_SECONDS, n: b64(randomBytes(8)) })));
  const sig = b64(createHmac('sha256', `${secret}:realtime`).update(payload).digest());
  return { ticket: `${payload}.${sig}`, expiresAt: new Date(now.getTime() + TICKET_TTL_SECONDS * 1000) };
}

export function verifyTicket(secret: string, ticket: string, now: Date): { userId: string; tokenVersion: number } | null {
  const [payload, sig] = ticket.split('.');
  if (!payload || !sig || ticket.length > 512) return null;
  const expected = createHmac('sha256', `${secret}:realtime`).update(payload).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { sub?: string; tv?: number; exp?: number };
    if (typeof p.sub !== 'string' || typeof p.tv !== 'number' || typeof p.exp !== 'number' || p.exp * 1000 < now.getTime()) return null;
    return { userId: p.sub, tokenVersion: p.tv };
  } catch {
    return null;
  }
}
