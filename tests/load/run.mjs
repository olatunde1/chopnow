/**
 * Indicative load check for the busiest paths. Starts its own API on the e2e database (wiped and
 * reseeded first, mock payments), then measures:
 *   1. food search (anonymous)        2. cart quote (signed in)        3. order placement
 *   4. dispatch: time from the restaurant accepting to the rider seeing an offer
 *   5. realtime fan-out: N customers on WebSockets, time from the restaurant accepting to each
 *      customer's socket hearing about it
 * Everything runs on one machine, so the numbers show relative cost and regressions, not
 * production capacity. Usage: npm run test:load  (LOAD_SECONDS, LOAD_SOCKETS to tune)
 */
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import autocannon from 'autocannon';
import WebSocket from 'ws';

const API = 'http://localhost:4100';
const SECONDS = Number(process.env.LOAD_SECONDS ?? 15);
const SOCKETS = Number(process.env.LOAD_SOCKETS ?? 200);
const YABA = { lat: 6.5175, lng: 3.3691 }; // the seeded customer's home address area
const NEAR_MAMA = { latitude: 6.5115, longitude: 3.3701 }; // where the rider waits
const seedSource = readFileSync(new URL('../../services/api/src/db/seed/dev-seed.ts', import.meta.url), 'utf8');
const PASSWORD = process.env.SEED_USER_PASSWORD ?? /DEFAULT_SEED_PASSWORD = '([^']+)'/.exec(seedSource)[1];

// ───────── helpers ─────────
async function call(method, path, body, token, headers = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(json)}`);
  return json;
}
const login = async (email) => (await call('POST', '/v1/auth/login', { email, password: PASSWORD })).accessToken;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (xs, p) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const ms = (n) => `${Math.round(n)} ms`;
const results = [];

function cannon(title, opts) {
  return new Promise((resolve, reject) => {
    // autocannon takes the path as part of url; a separate path option is ignored.
    const { path, ...rest } = opts;
    const inst = autocannon({ url: API + path, duration: SECONDS, connections: 25, ...rest }, (err, r) => {
      if (err) return reject(err);
      const codes = Object.entries(r.statusCodeStats ?? {}).map(([c, v]) => `${c}×${v.count}`).join(' ');
      const row = { test: title, codes, 'req/s': Math.round(r.requests.average), p50: ms(r.latency.p50), p90: ms(r.latency.p90), p99: ms(r.latency.p99), '2xx': r['2xx'], 'non-2xx': r.non2xx, errors: r.errors + r.timeouts };
      results.push(row);
      console.log(`  ${title}: ${row['req/s']} req/s, p50 ${row.p50}, p99 ${row.p99}, non-2xx ${row['non-2xx']}`);
      resolve(r);
    });
    process.once('SIGINT', () => inst.stop());
  });
}

// ───────── start the API ─────────
const api = spawn(process.execPath, ['start-api.mjs'], {
  cwd: fileURLToPath(new URL('../e2e/', import.meta.url)),
  env: {
    ...process.env,
    E2E_API_LOG_LEVEL: 'error',
    // One machine sends everything from one IP and few accounts: lift the limiters for the measurement.
    RATE_LIMIT_GLOBAL_MAX: '10000000',
    RATE_LIMIT_AUTH_MAX: '100000',
    RATE_LIMIT_ORDER_MAX: '1000000',
    RATE_LIMIT_PAYMENT_MAX: '1000000',
  },
  stdio: ['ignore', 'ignore', 'inherit'],
});
const stop = () => {
  // Synchronous, so the API is gone before this process exits.
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(api.pid), '/T', '/F'], { stdio: 'ignore' });
  else api.kill('SIGTERM');
};
process.on('exit', stop);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));

try {
  for (let i = 0; ; i++) {
    if (i > 120) throw new Error('API did not start within 2 minutes');
    if (await fetch(`${API}/health`).then((r) => r.ok, () => false)) break;
    await sleep(1000);
  }
  console.log(`API up. ${SECONDS}s per HTTP test, ${SOCKETS} sockets.\n`);

  // Shared fixtures from the seed: Ada, her address, Mama Nkechi's Jollof (Large + chicken).
  const ada = await login('ada@chopnow.test');
  const address = (await call('GET', '/v1/me/addresses', undefined, ada)).items[0];
  const mama = (await call('GET', `/v1/restaurants?lat=${address.latitude}&lng=${address.longitude}`, undefined, ada)).items.find((r) => r.name.startsWith('Mama'));
  const menu = await call('GET', `/v1/restaurants/${mama.slug}?lat=${address.latitude}&lng=${address.longitude}`);
  const jollof = menu.menu.categories.flatMap((c) => c.items).find((i) => i.name === 'Jollof Rice');
  const cart = (paymentMethod, quantity = 1) => ({
    restaurantId: mama.id,
    addressId: address.id,
    paymentMethod,
    items: [{ menuItemId: jollof.id, variantId: jollof.variants.find((v) => v.isDefault)?.id ?? jollof.variants[0]?.id, quantity, extras: [] }],
  });

  // ───────── 1–3: HTTP throughput ─────────
  console.log('HTTP');
  await cannon('food search (anonymous)', { path: `/v1/search/food?q=jollof&lat=${YABA.lat}&lng=${YABA.lng}` });
  await cannon('cart quote', { method: 'POST', path: '/v1/orders/quote', headers: { 'content-type': 'application/json', authorization: `Bearer ${ada}` }, body: JSON.stringify(cart('ONLINE', 2)) });
  // Online orders await payment, so they never reach the restaurant or dispatch: this measures placement alone.
  await cannon('order placement', {
    connections: 10,
    method: 'POST',
    path: '/v1/orders',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${ada}` },
    body: JSON.stringify(cart('ONLINE', 2)),
    requests: [{ setupRequest: (req) => ({ ...req, headers: { ...req.headers, 'idempotency-key': randomUUID() } }) }],
  });

  // ───────── 4: dispatch latency (quiet board, as at launch) ─────────
  console.log('\nDispatch');
  const vendor = await login('vendor.mamankechi@chopnow.test');
  const rider = await login('rider.core1@chopnow.test');
  const samples = [];
  for (let i = 0; i < 5; i++) {
    await call('PUT', '/v1/rider/location', NEAR_MAMA, rider); // fresh heartbeat
    const order = await call('POST', '/v1/orders', cart('CASH_ON_DELIVERY'), ada, { 'Idempotency-Key': randomUUID() });
    await call('POST', `/v1/vendor/restaurants/${mama.id}/orders/${order.id}/accept`, { prepTimeMinutes: 20 }, vendor);
    const t0 = performance.now();
    let offer = null;
    while (!offer && performance.now() - t0 < 30_000) {
      offer = (await call('GET', '/v1/rider/work', undefined, rider)).offer;
      if (!offer) await sleep(50);
    }
    if (!offer) { console.log(`  sample ${i + 1}: no offer within 30 s`); continue; }
    samples.push(performance.now() - t0);
    console.log(`  sample ${i + 1}: rider saw the offer ${ms(samples.at(-1))} after the restaurant accepted`);
    // Decline so the rider is free for the next sample (nobody else is near, so that job just waits).
    await call('POST', `/v1/rider/offers/${offer.id}/decline`, { reason: 'BUSY' }, rider);
  }
  results.push({ test: 'dispatch: accepted → rider sees offer', 'req/s': '-', p50: ms(pct(samples, 50)), p90: ms(pct(samples, 90)), p99: ms(Math.max(...samples)), '2xx': samples.length, 'non-2xx': 5 - samples.length, errors: 0 });

  // ───────── 5: realtime fan-out ─────────
  console.log('\nRealtime fan-out');
  const run = randomUUID().slice(0, 6);
  const customers = [];
  for (let i = 0; i < SOCKETS; i++) {
    const reg = await call('POST', '/v1/auth/register', { email: `load-${run}-${i}@chopnow.test`, password: PASSWORD, fullName: `Load Test ${i}` });
    const token = reg.accessToken;
    const addr = await call('POST', '/v1/me/addresses', { label: 'Home', line1: `${i + 1} Akoka Road`, area: 'Yaba', city: 'Lagos', latitude: address.latitude, longitude: address.longitude }, token);
    customers.push({ token, addressId: addr.id });
  }
  const connectStart = performance.now();
  await Promise.all(
    customers.map(async (c) => {
      const t = await call('POST', '/v1/realtime/ticket', undefined, c.token);
      c.ws = new WebSocket(`${t.url}?ticket=${encodeURIComponent(t.ticket)}`);
      c.heard = new Map();
      c.ws.on('message', (raw) => {
        const e = JSON.parse(String(raw));
        if (e.type === 'order.updated' && e.status === 'ACCEPTED' && !c.heard.has(e.orderId)) c.heard.set(e.orderId, performance.now());
      });
      await new Promise((res, rej) => (c.ws.once('open', res), c.ws.once('error', rej)));
    }),
  );
  console.log(`  ${SOCKETS} sockets open in ${ms(performance.now() - connectStart)}`);
  for (const c of customers) {
    // First cash orders are capped at ₦10,000, so each places one plate.
    c.order = await call('POST', '/v1/orders', { ...cart('CASH_ON_DELIVERY'), addressId: c.addressId }, c.token, { 'Idempotency-Key': randomUUID() });
  }
  const acceptStart = performance.now();
  await Promise.all(customers.map(async (c) => {
    await call('POST', `/v1/vendor/restaurants/${mama.id}/orders/${c.order.id}/accept`, { prepTimeMinutes: 20 }, vendor);
    c.acceptedAt = performance.now();
  }));
  const acceptMs = performance.now() - acceptStart;
  const deadline = performance.now() + 20_000;
  while (performance.now() < deadline && customers.some((c) => !c.heard.has(c.order.id))) await sleep(100);
  const lags = customers.filter((c) => c.heard.has(c.order.id)).map((c) => c.heard.get(c.order.id) - c.acceptedAt);
  const missed = customers.length - lags.length;
  const fan = { test: `fan-out to ${SOCKETS} sockets`, 'req/s': Math.round(SOCKETS / (acceptMs / 1000)), p50: ms(pct(lags, 50)), p90: ms(pct(lags, 90)), p99: ms(pct(lags, 99)), '2xx': lags.length, 'non-2xx': missed, errors: 0 };
  results.push(fan);
  console.log(`  ${SOCKETS} accepts in ${ms(acceptMs)}; event reached customer p50 ${fan.p50}, p99 ${fan.p99}; missed ${missed}`);
  for (const c of customers) c.ws.close();

  console.log('\nSummary (indicative: one machine, embedded PostgreSQL, API and load generator sharing CPU)');
  console.table(results);
} finally {
  stop();
}
process.exit(0);
