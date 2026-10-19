import { createPrismaClient, type Db } from '../../src/db/client.js';
import { truncateAll } from '../../src/db/seed/dev-seed.js';
import { testDatabaseUrl } from './load-env.js';

export function createTestDb(): Db {
  return createPrismaClient(testDatabaseUrl());
}

export async function resetDb(db: Db): Promise<void> {
  await truncateAll(db);
}

export const TEST_JWT_SECRET = 'integration-test-secret-0123456789-abcdefghijklmnop';
