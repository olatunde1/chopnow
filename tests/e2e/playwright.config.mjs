import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';
import { PORTS, url } from './ports.mjs';

/**
 * Browser end-to-end run: the real API (e2e database, mock payments) plus the four built web apps.
 * Build the apps first: npm run build -w @chopnow/e2e (the root `npm run test:e2e` does both).
 * Uses an installed Microsoft Edge or Chrome, so no browser download is needed; override with E2E_BROWSER_CHANNEL.
 */
const channel =
  process.env.E2E_BROWSER_CHANNEL ??
  (existsSync('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe') || existsSync('/usr/bin/microsoft-edge') ? 'msedge' : 'chrome');

const spa = (name) => ({
  command: `node serve-spa.mjs ${name} ${PORTS[name]}`,
  url: url(name),
  reuseExistingServer: false,
  timeout: 20_000,
});

export default defineConfig({
  testDir: './specs',
  // One shared database and one dispatch loop: the journey runs serially.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    channel,
    headless: process.env.E2E_HEADED !== '1',
    viewport: { width: 1280, height: 860 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 15_000,
    timezoneId: 'Africa/Lagos',
    locale: 'en-NG',
  },
  webServer: [
    // Migrates and reseeds first; allow for a busy machine.
    { command: 'node start-api.mjs', url: `${url('api')}/health`, reuseExistingServer: false, timeout: 240_000, stdout: 'pipe' },
    spa('vendor'),
    spa('admin'),
    spa('customer'),
    spa('rider'),
  ],
});
