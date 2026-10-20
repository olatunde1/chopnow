/**
 * Notifications and realtime (Phase 10): the notification outbox along the order journey, privacy
 * of their contents, the in-app list, push tokens and the push sender (dead tokens, outages, stale
 * messages), realtime tickets and the WebSocket (auth, origin, who receives which event), and /ready.
 */
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import request from 'supertest';
import { WebSocket } from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { JobHealth } from '../../src/modules/monitoring/monitoring.js';
import { MemoryPushProvider } from '../../src/modules/notifications/push.js';
import { attachRealtime } from '../../src/modules/realtime/server.js';
import { createTestDb, TEST_JWT_SECRET } from './helpers.js';
import { LAGOS_NOON, bearer, buildTestHarness, freshSeed, seededEmail, tokenFor, expectNoPin } from './http-helpers.js';

const db = createTestDb();
let t = LAGOS_NOON.getTime();
const clock = () => new Date(t);
const push = new MemoryPushProvider();
const jobHealth = new JobHealth();
const harness = buildTestHarness(db, { clock, deps: { pushProvider: push, jobHealth } });
const { app, services } = harness;
const tok: Record<string, string> = {};
const as = (name: string) => bearer(tok[name]!);
const userId = async (name: string) => (await db.user.findUniqueOrThrow({ where: { email: seededEmail(name) } })).id;
let mamaId: string;
const addressIds: Record<string, string> = {};
let jollof: { id: string; large: string };
let n = 0;
const key = () => `notify-test-${Date.now()}-${++n}`;
const TOKEN = (s: string) => `ExponentPushToken[${s.padEnd(22, 'x')}]`;
let server: Server;
let realtime: { close(): Promise<void> };
let wsBase: string;

async function placeCash(customer = 'ada') {
  const res = await request(app).post('/v1/orders').set(as(customer)).set('Idempotency-Key', key()).send({ restaurantId: mamaId, addressId: addressIds[customer], paymentMethod: 'CASH_ON_DELIVERY', items: [{ menuItemId: jollof.id, variantId: jollof.large, quantity: 1 }] });
  expect(res.status).toBe(201);
  return res.body as { id: string; code: string; deliveryPin: string; totalKobo: number };
}
const notes = (uid: string, orderId?: string) => db.notification.findMany({ where: { userId: uid, ...(orderId ? { orderId } : {}) }, orderBy: { createdAt: 'asc' } });

/** Opens a socket with a fresh ticket and collects messages. */
async function connect(name: string, origin?: string) {
  const ticket = (await request(app).post('/v1/realtime/ticket').set(as(name)).send()).body;
  const ws = new WebSocket(`${wsBase}?ticket=${encodeURIComponent(ticket.ticket)}`, origin ? { headers: { Origin: origin } } : {});
  const messages: { type: string; [k: string]: unknown }[] = [];
  ws.on('message', (d) => messages.push(JSON.parse(String(d))));
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
    ws.once('error', reject);
  });
  await waitFor(() => messages.some((m) => m.type === 'hello'));
  return { ws, messages };
}
async function waitFor(check: () => boolean, ms = 2000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 20));
  }
}
const upgradeStatus = (url: string, headers: Record<string, string> = {}) =>
  new Promise<number>((resolve) => {
    const ws = new WebSocket(url, { headers });
    ws.once('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
    ws.once('open', () => {
      ws.close();
      resolve(101);
    });
    ws.once('error', () => resolve(-1));
  });

beforeAll(async () => {
  await freshSeed(db);
  for (const name of ['ada', 'tunde', 'vendor.mamankechi', 'vendor.bukka', 'rider.core1', 'ops']) tok[name] = await tokenFor(app, name);
  mamaId = (await db.restaurant.findUniqueOrThrow({ where: { slug: 'mama-nkechis-kitchen' } })).id;
  for (const c of ['ada', 'tunde']) addressIds[c] = (await db.address.findFirstOrThrow({ where: { user: { email: seededEmail(c) } } })).id;
  const j = await db.menuItem.findFirstOrThrow({ where: { restaurantId: mamaId, name: 'Jollof Rice' }, include: { variants: true } });
  jollof = { id: j.id, large: j.variants.find((x) => x.name === 'Large')!.id };
  await db.delivery.updateMany({ where: { status: { in: ['UNASSIGNED', 'OFFERING'] } }, data: { status: 'CANCELLED' } });
  await db.rider.updateMany({ data: { availability: 'OFFLINE' } });
  server = app.listen(0);
  await new Promise<void>((r) => server.once('listening', () => r()));
  realtime = attachRealtime(server, { db, hub: services.realtime, secret: TEST_JWT_SECRET, allowedOrigins: ['http://localhost:5173'], now: clock });
  wsBase = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/v1/realtime`;
}, 120_000);
afterAll(async () => {
  await realtime.close();
  await new Promise((r) => server.close(r));
  await db.$disconnect();
});

describe('notifications along the order journey', () => {
  it('each party hears about each step, once, without PINs or addresses', async () => {
    const [ada, vendor, rider] = [await userId('ada'), await userId('vendor.mamankechi'), await userId('rider.core1')];
    const o = await placeCash();
    expect((await notes(vendor, o.id)).map((x) => x.type)).toEqual(['order.new']);

    await request(app).post(`/v1/vendor/restaurants/${mamaId}/orders/${o.id}/accept`).set(as('vendor.mamankechi')).send({ prepTimeMinutes: 20 });
    const accepted = (await notes(ada, o.id)).find((x) => x.type === 'order.accepted')!;
    expect(accepted.body).toBe('Food expected ready around 12:20.');

    await request(app).put('/v1/rider/availability').set(as('rider.core1')).send({ online: true });
    await services.dispatch.tick();
    const offer = (await notes(rider, o.id)).find((x) => x.type === 'delivery.offer')!;
    expect(offer.title).toBe('New delivery: earn ₦400');
    expect(offer.data).toMatchObject({ _push: { priority: 'high', ttlSeconds: 45 } });

    const work = await request(app).get('/v1/rider/work').set(as('rider.core1'));
    await request(app).post(`/v1/rider/offers/${work.body.offer.id}/accept`).set(as('rider.core1')).send();
    await request(app).post(`/v1/vendor/restaurants/${mamaId}/orders/${o.id}/ready`).set(as('vendor.mamankechi')).send();
    await request(app).post(`/v1/rider/deliveries/${work.body.offer.deliveryId}/picked-up`).set(as('rider.core1')).send();
    await request(app).post(`/v1/rider/deliveries/${work.body.offer.deliveryId}/complete`).set(as('rider.core1')).send({ pin: o.deliveryPin, cashCollectedKobo: o.totalKobo });

    const customer = await notes(ada, o.id);
    expect(customer.map((x) => x.type)).toEqual(['order.accepted', 'delivery.assigned', 'delivery.picked_up', 'order.delivered']);
    expect(customer.find((x) => x.type === 'delivery.assigned')!.title).toBe('Chinedu will deliver your order');
    const everything = JSON.stringify(await db.notification.findMany({ where: { orderId: o.id } }));
    expectNoPin(everything, o.deliveryPin);
    expect(everything).not.toMatch(/Sabo Road|\+234|@chopnow/);
    await request(app).put('/v1/rider/availability').set(as('rider.core1')).send({ online: false });
  });

  it('cancellations tell the customer and the restaurant, but not the person who cancelled', async () => {
    const [ada, vendor] = [await userId('ada'), await userId('vendor.mamankechi')];
    const o = await placeCash();
    await request(app).post(`/v1/orders/${o.id}/cancel`).set(as('ada')).send({});
    expect((await notes(ada, o.id)).map((x) => x.type)).toEqual([]);
    expect((await notes(vendor, o.id)).map((x) => x.type)).toEqual(['order.new', 'order.cancelled']);

    const o2 = await placeCash();
    await request(app).post(`/v1/vendor/restaurants/${mamaId}/orders/${o2.id}/reject`).set(as('vendor.mamankechi')).send({ reason: 'TOO_BUSY' });
    const rejected = (await notes(ada, o2.id))[0]!;
    expect(rejected).toMatchObject({ type: 'order.rejected', body: 'The restaurant is too busy.' });
    expect((await notes(vendor, o2.id)).map((x) => x.type)).toEqual(['order.new']);
  });
});

describe('in-app list', () => {
  it('lists newest first with an unread count; mark some or all read; never someone else’s', async () => {
    const list = await request(app).get('/v1/me/notifications').set(as('ada'));
    expect(list.status).toBe(200);
    expect(list.body.unreadCount).toBe(list.body.total);
    expect(list.body.items[0].data).not.toHaveProperty('_push');
    const first = list.body.items[0].id;
    expect((await request(app).post('/v1/me/notifications/read').set(as('tunde')).send({ ids: [first] })).body.updated).toBe(0);
    expect((await request(app).post('/v1/me/notifications/read').set(as('ada')).send({ ids: [first] })).body.updated).toBe(1);
    expect((await request(app).get('/v1/me/notifications').query({ unread: 'true' }).set(as('ada'))).body.total).toBe(list.body.total - 1);
    await request(app).post('/v1/me/notifications/read').set(as('ada')).send({ all: true });
    expect((await request(app).get('/v1/me/notifications').set(as('ada'))).body.unreadCount).toBe(0);
    expect((await request(app).post('/v1/me/notifications/read').set(as('ada')).send({})).status).toBe(400);
  });
});

describe('push delivery', () => {
  it('rejects tokens that aren’t Expo tokens; a device token moves to whoever signs in on it', async () => {
    expect((await request(app).put('/v1/me/push-tokens').set(as('ada')).send({ token: 'not-a-token', platform: 'ANDROID' })).status).toBe(400);
    expect((await request(app).put('/v1/me/push-tokens').set(as('tunde')).send({ token: TOKEN('shared'), platform: 'ANDROID' })).status).toBe(200);
    await request(app).put('/v1/me/push-tokens').set(as('ada')).send({ token: TOKEN('shared'), platform: 'ANDROID' });
    expect((await db.pushToken.findUniqueOrThrow({ where: { token: TOKEN('shared') } })).userId).toBe(await userId('ada'));
  });

  it('pushes pending notifications to the user’s devices and marks them handled; users without devices too', async () => {
    await db.notification.updateMany({ data: { pushedAt: new Date() } }); // start clean
    await request(app).put('/v1/me/push-tokens').set(as('vendor.mamankechi')).send({ token: TOKEN('vendorphone'), platform: 'IOS' });
    push.sent.length = 0;
    const o = await placeCash('tunde');
    const res = await services.notifications.deliverPending();
    expect(res.sent).toBe(1);
    expect(push.sent).toEqual([expect.objectContaining({ to: TOKEN('vendorphone'), title: `New order ${o.code}`, priority: 'high', data: expect.objectContaining({ type: 'order.new', orderId: o.id }) })]);
    expectNoPin(push.sent, o.deliveryPin);
    expect(await db.notification.count({ where: { pushedAt: null } })).toBe(0);
    expect((await services.notifications.deliverPending()).handled).toBe(0); // nothing sent twice
  });

  it('keeps notifications pending through a push outage, and disables dead tokens', async () => {
    await placeCash('tunde');
    push.failNext = true;
    expect((await services.notifications.deliverPending()).sent).toBe(0);
    const pending = await db.notification.findFirstOrThrow({ where: { pushedAt: null } });
    expect(pending).toMatchObject({ pushAttempts: 1, pushError: 'simulated outage' });
    push.dead.add(TOKEN('vendorphone'));
    await services.notifications.deliverPending();
    expect((await db.pushToken.findUniqueOrThrow({ where: { token: TOKEN('vendorphone') } })).disabledAt).not.toBeNull();
    expect(await db.notification.count({ where: { pushedAt: null } })).toBe(0);
  });

  it('doesn’t buzz phones with stale news, and stops after sign-out', async () => {
    await request(app).put('/v1/me/push-tokens').set(as('vendor.mamankechi')).send({ token: TOKEN('newphone'), platform: 'ANDROID' });
    const old = await placeCash('tunde');
    t += 31 * 60_000;
    push.sent.length = 0;
    await services.notifications.deliverPending();
    expect(push.sent).toHaveLength(0);
    expect((await db.notification.findFirstOrThrow({ where: { type: 'order.new', orderId: old.id } })).pushError).toMatch(/stale/);

    await request(app).post('/v1/me/push-tokens/remove').set(as('vendor.mamankechi')).send({ token: TOKEN('newphone') });
    await placeCash('tunde');
    await services.notifications.deliverPending();
    expect(push.sent).toHaveLength(0);
  });
});

describe('realtime', () => {
  it('needs a valid, fresh ticket and an allowed origin', async () => {
    expect(await upgradeStatus(`${wsBase}?ticket=forged.ticket`)).toBe(401);
    expect(await upgradeStatus(wsBase)).toBe(401);
    const { ticket } = (await request(app).post('/v1/realtime/ticket').set(as('ada')).send()).body;
    expect(await upgradeStatus(`${wsBase}?ticket=${ticket}`, { Origin: 'https://evil.example' })).toBe(403);
    t += 31_000;
    expect(await upgradeStatus(`${wsBase}?ticket=${ticket}`)).toBe(401);
    expect((await request(app).post('/v1/realtime/ticket').send()).status).toBe(401);
    const ok = await connect('ada', 'http://localhost:5173');
    ok.ws.close();
  });

  it('tells the right people that an order changed, and nobody else', async () => {
    await services.changeFeed.poll(); // flush earlier tests' changes before anyone connects
    const ada = await connect('ada');
    const vendor = await connect('vendor.mamankechi');
    const otherVendor = await connect('vendor.bukka');
    const tunde = await connect('tunde');
    const ops = await connect('ops');
    const o = await placeCash();
    await request(app).post(`/v1/vendor/restaurants/${mamaId}/orders/${o.id}/accept`).set(as('vendor.mamankechi')).send({});
    await services.changeFeed.poll();
    await waitFor(() => ada.messages.some((m) => m.type === 'order.updated' && m.status === 'ACCEPTED'));
    await waitFor(() => vendor.messages.some((m) => m.type === 'notification.new' && m.notificationType === 'order.new'));
    expect(vendor.messages).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'order.updated', orderId: o.id, restaurantId: mamaId }), expect.objectContaining({ type: 'notification.new', notificationType: 'order.new' })]));
    await waitFor(() => ops.messages.some((m) => m.type === 'order.updated' && m.orderId === o.id));
    expect(otherVendor.messages.filter((m) => m.type !== 'hello')).toEqual([]);
    expect(tunde.messages.filter((m) => m.type !== 'hello')).toEqual([]);
    expect(JSON.stringify(ada.messages)).not.toMatch(new RegExp(`${o.deliveryPin}|Sabo Road|\\+234`));

    // Polling again does not repeat events.
    const before = ada.messages.length;
    await services.changeFeed.poll();
    expect(ada.messages.length).toBe(before);
    for (const c of [ada, vendor, otherVendor, tunde, ops]) c.ws.close();
  });

  it('a rider hears about a new offer at once', async () => {
    const rider = await connect('rider.core1');
    await request(app).put('/v1/rider/availability').set(as('rider.core1')).send({ online: true });
    await placeCash().then((o) => request(app).post(`/v1/vendor/restaurants/${mamaId}/orders/${o.id}/accept`).set(as('vendor.mamankechi')).send({}));
    await services.changeFeed.poll();
    await waitFor(() => rider.messages.some((m) => m.type === 'work.updated'));
    await waitFor(() => rider.messages.some((m) => m.type === 'notification.new' && m.notificationType === 'delivery.offer'));
    rider.ws.close();
    await request(app).put('/v1/rider/availability').set(as('rider.core1')).send({ online: false });
  });

  it('a suspended user can’t open a socket with an old ticket', async () => {
    const { ticket } = (await request(app).post('/v1/realtime/ticket').set(as('tunde')).send()).body;
    await db.user.update({ where: { email: seededEmail('tunde') }, data: { tokenVersion: { increment: 1 } } });
    expect(await upgradeStatus(`${wsBase}?ticket=${ticket}`)).toBe(401);
  });
});

describe('/ready', () => {
  it('reports background jobs and turns unhealthy when one stalls', async () => {
    jobHealth.register('push', 3000);
    jobHealth.ok('push');
    const ok = await request(app).get('/ready');
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ status: 'ready', jobs: { push: { stalled: false } } });
    jobHealth.register('dispatch', 1); // registered long enough ago to look stalled once its grace passes
    (jobHealth as unknown as { jobs: Map<string, { started: number }> }).jobs.get('dispatch')!.started = Date.now() - 60_000;
    const bad = await request(app).get('/ready');
    expect(bad.status).toBe(503);
    expect(bad.body.jobs.dispatch.stalled).toBe(true);
  });
});
