/**
 * Starts the API for the e2e run: migrates and resets the e2e database (seed data, all restaurants
 * open, no stray deliveries), then serves on the e2e port with mock payments and log-only push.
 * Database: E2E_DATABASE_URL, or DATABASE_URL_TEST from the root .env with the name swapped to chopnow_e2e.
 */
import { execSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PORTS, url } from './ports.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const api = `${root}/services/api`;
if (existsSync(`${root}/.env`)) process.loadEnvFile(`${root}/.env`);

const dbUrl = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL_TEST?.replace(/\/[^/?]+(\?|$)/, '/chopnow_e2e$1');
if (!dbUrl) {
  console.error('Set E2E_DATABASE_URL (or DATABASE_URL_TEST in the root .env).');
  process.exit(1);
}
const env = {
  ...process.env,
  APP_ENV: 'test',
  DATABASE_URL: dbUrl,
  API_PORT: String(PORTS.api),
  PUBLIC_API_URL: url('api'),
  CORS_ALLOWED_ORIGINS: ['vendor', 'admin', 'customer', 'rider'].map(url).join(','),
  PAYMENT_PROVIDER: 'mock',
  PUSH_PROVIDER: 'log',
  SENTRY_DSN: '',
  LOG_LEVEL: process.env.E2E_API_LOG_LEVEL ?? 'warn',
  // Several sign-ins per run from one IP; keep the limiter on but out of the way.
  RATE_LIMIT_AUTH_MAX: process.env.RATE_LIMIT_AUTH_MAX ?? '500',
};
const run = (cmd) => execSync(cmd, { cwd: api, env, stdio: ['ignore', 'inherit', 'inherit'] });
run('npx prisma migrate deploy');
run('npx tsx src/scripts/reset-test-db.ts');
// node + the tsx loader directly (no npx/shell layers), so killing this process tree stops the server.
const server = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], { cwd: api, env, stdio: 'inherit' });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.kill(sig));
server.on('exit', (code) => process.exit(code ?? 0));
