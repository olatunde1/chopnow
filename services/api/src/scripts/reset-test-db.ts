/**
 * Resets the browser end-to-end test database (tests/e2e runs this before starting the API).
 * Same wipe-and-seed as db:seed, then makes the data time-independent: every restaurant is open
 * all day, and the seeded in-progress sample orders are cancelled so dispatch only sees the
 * order the test places. Refuses unless APP_ENV=test and the database name says test/e2e.
 */
import { createPrismaClient } from '../db/client.js';
import { SeedRefusedError, seedDevelopmentData } from '../db/seed/dev-seed.js';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}
const dbName = new URL(url).pathname.slice(1);
if (process.env.APP_ENV !== 'test' || !/test|e2e/i.test(dbName)) {
  console.error(`Refusing to reset: needs APP_ENV=test and a test/e2e database (got APP_ENV=${process.env.APP_ENV ?? ''}, database "${dbName}").`);
  process.exit(2);
}

const db = createPrismaClient(url);
try {
  await seedDevelopmentData(db, { appEnv: 'test', password: process.env.SEED_USER_PASSWORD });
  await db.$transaction([
    db.restaurantHours.updateMany({ data: { opensAt: 0, closesAt: 1440 } }),
    db.delivery.updateMany({ where: { status: { notIn: ['DELIVERED', 'CANCELLED'] } }, data: { status: 'CANCELLED', currentRiderId: null } }),
    db.cashCollection.updateMany({ where: { status: 'PENDING' }, data: { status: 'WAIVED' } }),
    db.order.updateMany({ where: { status: { notIn: ['DELIVERED', 'CANCELLED', 'REJECTED'] } }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancellationReason: '[Test data] cleared for the e2e run' } }),
  ]);
  console.log(`Reset e2e database "${dbName}" (TEST DATA ONLY).`);
} catch (err) {
  if (err instanceof SeedRefusedError) {
    console.error(err.message);
    process.exitCode = 2;
  } else {
    throw err;
  }
} finally {
  await db.$disconnect();
}
