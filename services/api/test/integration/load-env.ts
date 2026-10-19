import { existsSync } from 'node:fs';

const rootEnv = new URL('../../../../.env', import.meta.url);
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

/** Returns the test database URL, refusing anything that does not look like a test database. */
export function testDatabaseUrl(): string {
  const url = process.env.DATABASE_URL_TEST;
  if (!url) throw new Error('DATABASE_URL_TEST is not set. Integration tests need a dedicated PostgreSQL test database.');
  const dbName = new URL(url).pathname.slice(1);
  if (!/test/i.test(dbName)) {
    throw new Error(`Refusing to run integration tests against "${dbName}": the database name must contain "test" (tests truncate every table).`);
  }
  return url;
}
