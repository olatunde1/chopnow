/**
 * npm run db:seed -w @chopnow/api
 * Wipes and reseeds the DEVELOPMENT database with clearly marked test data.
 * Refuses to run unless APP_ENV is development/test and the database holds only test accounts.
 */
import { createPrismaClient } from '../db/client.js';
import { DEFAULT_SEED_PASSWORD, SEED_EMAIL_DOMAIN, SeedRefusedError, seedDevelopmentData } from '../db/seed/dev-seed.js';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}
const db = createPrismaClient(url);
try {
  const summary = await seedDevelopmentData(db, {
    appEnv: process.env.APP_ENV ?? 'development',
    password: process.env.SEED_USER_PASSWORD,
  });
  console.log('Seeded development data (TEST DATA ONLY):', summary);
  console.log(`Accounts: admin|ops|support|finance|ada|tunde|vendor.mamankechi|vendor.bukka|rider.core1 ... ${SEED_EMAIL_DOMAIN}`);
  console.log(
    process.env.SEED_USER_PASSWORD
      ? 'Password: the value of SEED_USER_PASSWORD.'
      : `Password: the development default in src/db/seed/dev-seed.ts (DEFAULT_SEED_PASSWORD, ${DEFAULT_SEED_PASSWORD.length} chars).`,
  );
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
