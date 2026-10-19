import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { testDatabaseUrl } from './load-env.js';

/** Applies all migrations to the test database once before the integration suite. */
export default function setup() {
  const url = testDatabaseUrl();
  execSync('npx prisma migrate deploy', {
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
  });
}
