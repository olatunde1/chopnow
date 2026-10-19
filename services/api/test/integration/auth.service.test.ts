import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { AuthService, MAX_FAILED_LOGINS } from '../../src/modules/auth/auth.service.js';
import { TokenService } from '../../src/modules/auth/tokens.js';
import { AppError } from '../../src/lib/errors.js';
import { TEST_JWT_SECRET, createTestDb, resetDb } from './helpers.js';

const db = createTestDb();
const tokens = new TokenService(TEST_JWT_SECRET, 900);
const auth = new AuthService(db, tokens, { refreshTokenTtlDays: 30, accessTokenTtlSeconds: 900 });

const customer = { email: 'Ada@Example.com', password: 'jollof123', fullName: 'Ada Obi' };

async function expectAppError(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === code);
}

beforeEach(() => resetDb(db));
afterAll(() => db.$disconnect());

describe('registration', () => {
  it('creates a customer with a profile, hashed password and audit entry', async () => {
    const res = await auth.register(customer);
    expect(res.user).toMatchObject({ email: 'ada@example.com', role: 'CUSTOMER' });
    expect(res.accessToken).toBeTruthy();
    expect(res.refreshToken).toBeTruthy();

    const user = await db.user.findUniqueOrThrow({ where: { email: 'ada@example.com' }, include: { customerProfile: true } });
    expect(user.passwordHash).not.toContain('jollof123');
    expect(user.customerProfile).not.toBeNull();
    expect(await db.auditLog.count({ where: { action: 'auth.register', entityId: user.id } })).toBe(1);
    // Only the hash of the refresh token is stored.
    expect(await db.authSession.count({ where: { tokenHash: res.refreshToken } })).toBe(0);
  });

  it('rejects duplicate emails regardless of case', async () => {
    await auth.register(customer);
    await expectAppError(auth.register({ ...customer, email: 'ADA@example.com' }), 'ACCOUNT_EXISTS');
  });

  it('cannot self-register as staff or inject privileged fields', async () => {
    await expectAppError(auth.register({ ...customer, role: 'ADMIN' }), 'VALIDATION_FAILED');
    await expectAppError(auth.register({ ...customer, role: 'CUSTOMER', status: 'ACTIVE', tokenVersion: 9 }), 'VALIDATION_FAILED');
    expect(await db.user.count()).toBe(0);
  });

  it('creates riders as PENDING and OFFLINE', async () => {
    await auth.register({
      email: 'rider@example.com', password: 'okada123', fullName: 'Kunle Rider', phone: '08031234567',
      role: 'RIDER', rider: { vehicleType: 'MOTORCYCLE', vehiclePlate: 'LAG-1' },
    });
    const rider = await db.rider.findFirstOrThrow({ include: { user: true } });
    expect(rider.verificationStatus).toBe('PENDING');
    expect(rider.availability).toBe('OFFLINE');
    expect(rider.user.phone).toBe('+2348031234567');
  });
});

describe('login', () => {
  it('signs in with correct credentials and resolves the principal from the database', async () => {
    await auth.register(customer);
    const res = await auth.login({ email: 'ada@example.com', password: 'jollof123' });
    expect(await auth.authenticate(res.accessToken)).toMatchObject({ role: 'CUSTOMER' });
  });

  it('gives the same error for a wrong password and an unknown email', async () => {
    await auth.register(customer);
    await expectAppError(auth.login({ email: 'ada@example.com', password: 'wrong1234' }), 'INVALID_CREDENTIALS');
    await expectAppError(auth.login({ email: 'nobody@example.com', password: 'wrong1234' }), 'INVALID_CREDENTIALS');
  });

  it(`locks the account after ${MAX_FAILED_LOGINS} failures, even for the right password`, async () => {
    await auth.register(customer);
    for (let i = 0; i < MAX_FAILED_LOGINS - 1; i++) {
      await expectAppError(auth.login({ email: 'ada@example.com', password: 'wrong1234' }), 'INVALID_CREDENTIALS');
    }
    await expectAppError(auth.login({ email: 'ada@example.com', password: 'wrong1234' }), 'ACCOUNT_LOCKED');
    await expectAppError(auth.login({ email: 'ada@example.com', password: 'jollof123' }), 'ACCOUNT_LOCKED');
    expect(await db.auditLog.count({ where: { action: 'auth.account_locked' } })).toBe(1);
  });

  it('refuses suspended accounts and invalidates their existing access tokens', async () => {
    const { accessToken } = await auth.register(customer);
    await db.user.update({ where: { email: 'ada@example.com' }, data: { status: 'SUSPENDED' } });
    await expectAppError(auth.login({ email: 'ada@example.com', password: 'jollof123' }), 'ACCOUNT_INACTIVE');
    expect(await auth.authenticate(accessToken)).toBeNull();
  });

  it('uses the role stored in the database, not the one in the token', async () => {
    const { accessToken } = await auth.register(customer);
    await db.user.update({ where: { email: 'ada@example.com' }, data: { role: 'SUPPORT' } });
    expect(await auth.authenticate(accessToken)).toMatchObject({ role: 'SUPPORT' });
  });
});

describe('refresh token rotation', () => {
  it('issues a new token and makes the old one unusable', async () => {
    const first = await auth.register(customer);
    const second = await auth.refresh({ refreshToken: first.refreshToken });
    expect(second.refreshToken).not.toBe(first.refreshToken);
    await expectAppError(auth.refresh({ refreshToken: first.refreshToken }), 'UNAUTHENTICATED');
  });

  it('revokes the whole session family when a rotated token is replayed', async () => {
    const first = await auth.register(customer);
    const second = await auth.refresh({ refreshToken: first.refreshToken });
    await expectAppError(auth.refresh({ refreshToken: first.refreshToken }), 'UNAUTHENTICATED'); // replay
    await expectAppError(auth.refresh({ refreshToken: second.refreshToken }), 'UNAUTHENTICATED'); // legit one now dead too
    expect(await db.auditLog.count({ where: { action: 'auth.refresh_reuse_detected' } })).toBe(1);
  });

  it('allows only one of two concurrent refreshes with the same token', async () => {
    const first = await auth.register(customer);
    const results = await Promise.allSettled([
      auth.refresh({ refreshToken: first.refreshToken }),
      auth.refresh({ refreshToken: first.refreshToken }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('logout revokes the session; logoutAll also kills outstanding access tokens', async () => {
    const a = await auth.register(customer);
    await auth.logout({ refreshToken: a.refreshToken });
    await expectAppError(auth.refresh({ refreshToken: a.refreshToken }), 'UNAUTHENTICATED');

    const b = await auth.login({ email: 'ada@example.com', password: 'jollof123' });
    const principal = (await auth.authenticate(b.accessToken))!;
    await auth.logoutAll(principal.userId, principal);
    expect(await auth.authenticate(b.accessToken)).toBeNull();
    await expectAppError(auth.refresh({ refreshToken: b.refreshToken }), 'UNAUTHENTICATED');
  });
});
