import { describe, expect, it } from 'vitest';
import { hashPassword, needsRehash, verifyPassword } from '../src/modules/auth/password.js';
import { TokenService, generateRefreshToken, hashToken } from '../src/modules/auth/tokens.js';

// scrypt is deliberately slow and memory-hard (~64 MiB per hash); allow for parallel test workers.
describe('password hashing', { timeout: 30_000 }, () => {
  it('hashes with a random salt and verifies only the right password', async () => {
    const a = await hashPassword('jollof123');
    const b = await hashPassword('jollof123');
    expect(a).not.toBe(b);
    expect(a.startsWith('scrypt$65536$8$2$')).toBe(true);
    expect(a).not.toContain('jollof123');
    expect(await verifyPassword('jollof123', a)).toBe(true);
    expect(await verifyPassword('jollof124', a)).toBe(false);
    expect(await verifyPassword('jollof123', 'garbage')).toBe(false);
  });

  it('flags weaker parameters for rehash', () => {
    expect(needsRehash('scrypt$16384$8$1$c2FsdA$aGFzaA')).toBe(true);
    expect(needsRehash('bcrypt$whatever')).toBe(true);
  });
});

describe('access tokens', () => {
  const svc = new TokenService('unit-test-secret-0123456789-abcdefghijklmnop', 900);

  it('round-trips claims', async () => {
    const t = await svc.signAccess({ sub: 'u1', role: 'VENDOR', tv: 3 });
    expect(await svc.verifyAccess(t)).toEqual({ sub: 'u1', role: 'VENDOR', tv: 3 });
  });

  it('rejects tokens signed with another key or tampered with', async () => {
    const other = new TokenService('another-secret-0123456789-abcdefghijklmnopqrs', 900);
    const t = await other.signAccess({ sub: 'u1', role: 'ADMIN', tv: 0 });
    expect(await svc.verifyAccess(t)).toBeNull();

    const good = await svc.signAccess({ sub: 'u1', role: 'CUSTOMER', tv: 0 });
    const [h, , s] = good.split('.');
    const forgedPayload = Buffer.from(JSON.stringify({ sub: 'u1', role: 'ADMIN', tv: 0 })).toString('base64url');
    expect(await svc.verifyAccess(`${h}.${forgedPayload}.${s}`)).toBeNull();
  });

  it('rejects "alg: none" tokens', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ sub: 'u1', role: 'ADMIN', tv: 0, iss: 'chopnow-api', aud: 'chopnow-clients' })).toString('base64url');
    expect(await svc.verifyAccess(`${header}.${payload}.`)).toBeNull();
  });

  it('rejects expired tokens', async () => {
    const short = new TokenService('unit-test-secret-0123456789-abcdefghijklmnop', -10);
    const t = await short.signAccess({ sub: 'u1', role: 'CUSTOMER', tv: 0 });
    expect(await svc.verifyAccess(t)).toBeNull();
  });
});

describe('refresh tokens', () => {
  it('are high-entropy and stored only as a hash', () => {
    const t = generateRefreshToken();
    expect(t.length).toBeGreaterThanOrEqual(43);
    expect(hashToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(t)).not.toContain(t);
  });
});
