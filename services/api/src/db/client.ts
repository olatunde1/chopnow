import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

export type Db = PrismaClient;
/** Interactive-transaction client; services accept this so callers can compose them in one transaction. */
export type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];
export type DbOrTx = Db | Tx;

/**
 * `poolMax` caps this process's PostgreSQL connections (node-postgres defaults to 10). Keep
 * instances × poolMax under the server's connection limit. A burst can queue more transactions than
 * there are connections, so each may wait up to 10 s for one (Prisma's default is 2 s) before
 * failing with P2028, which the error handler turns into a retryable 503.
 */
export function createPrismaClient(connectionString: string, opts: { poolMax?: number } = {}): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString, ...(opts.poolMax ? { max: opts.poolMax } : {}) }),
    transactionOptions: { maxWait: 10_000, timeout: 10_000 },
  });
}
