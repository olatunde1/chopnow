import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { SEED_EMAIL_DOMAIN, SeedRefusedError, seedDevelopmentData } from '../../src/db/seed/dev-seed.js';
import { getBusinessRules } from '../../src/modules/settings/business-rules.js';
import { createTestDb, resetDb } from './helpers.js';

const db = createTestDb();
beforeEach(() => resetDb(db));
afterAll(() => db.$disconnect());

describe('development seed', () => {
  it('refuses to run outside development/test', async () => {
    await expect(seedDevelopmentData(db, { appEnv: 'production' })).rejects.toBeInstanceOf(SeedRefusedError);
    await expect(seedDevelopmentData(db, { appEnv: 'staging' })).rejects.toBeInstanceOf(SeedRefusedError);
  });

  it('refuses to wipe a database that contains real accounts', async () => {
    await db.user.create({ data: { email: 'real.person@gmail.com', fullName: 'Real', role: 'CUSTOMER', passwordHash: 'x' } });
    await expect(seedDevelopmentData(db, { appEnv: 'development' })).rejects.toBeInstanceOf(SeedRefusedError);
    expect(await db.user.count()).toBe(1);
  });

  it('seeds marked test data, is repeatable, and creates no financial transactions', async () => {
    const first = await seedDevelopmentData(db, { appEnv: 'test' });
    const second = await seedDevelopmentData(db, { appEnv: 'test' });
    expect(second).toEqual(first);
    expect(first).toMatchObject({ restaurants: 4, orders: 3 });

    expect(await db.user.count({ where: { NOT: { email: { endsWith: SEED_EMAIL_DOMAIN } } } })).toBe(0);
    expect(await db.restaurant.count({ where: { NOT: { description: { startsWith: '[Test data]' } } } })).toBe(0);
    expect(await db.platformSetting.findUnique({ where: { key: 'seed_info' } })).toMatchObject({ value: { isTestData: true } });
    expect(await db.financialTransaction.count()).toBe(0);
    expect(await db.ledgerEntry.count()).toBe(0);
    expect((await getBusinessRules(db)).pricing.commissionBps).toBe(1500);
  });

  it('includes jollof rice from approved, open restaurants plus closed and pending ones for negative cases', async () => {
    await seedDevelopmentData(db, { appEnv: 'test' });
    const jollofs = await db.menuItem.findMany({
      where: { name: { contains: 'jollof', mode: 'insensitive' } },
      include: { restaurant: true, variants: true, extras: true },
    });
    const orderable = jollofs.filter((j) => j.restaurant.verificationStatus === 'APPROVED' && j.restaurant.isAcceptingOrders);
    expect(orderable.length).toBeGreaterThanOrEqual(2);
    expect(jollofs.some((j) => !j.restaurant.isAcceptingOrders)).toBe(true);
    expect(orderable.every((j) => j.variants.length > 0 && j.extras.length > 0)).toBe(true);
  });
});
