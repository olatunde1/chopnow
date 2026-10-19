import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

// Prisma 7 does not load .env files itself. Load the repo-root .env for local development;
// CI and hosting provide DATABASE_URL directly. Variables already set in the environment win.
const rootEnv = new URL('../../.env', import.meta.url);
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

export default defineConfig({
  schema: '../../database/prisma/schema.prisma',
  migrations: {
    path: '../../database/prisma/migrations',
  },
  datasource: {
    // `prisma generate` needs no database; the placeholder is only used when DATABASE_URL is unset.
    url: process.env.DATABASE_URL ?? 'postgresql://unset:unset@localhost:5432/unset',
  },
});
