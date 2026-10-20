/**
 * Restaurant onboarding to discoverable menu, over HTTP:
 * vendor registers → applies → admin approval gate → hours → approval → menu → open → customers find it.
 */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb } from './helpers.js';
import { ADA_HOME, bearer, buildTestApp, freshSeed, tokenFor } from './http-helpers.js';

const db = createTestDb();
const app = buildTestApp(db);

let vendor: string;
let restaurantId: string;
let slug: string;
let categoryId: string;
let itemId: string;

beforeAll(async () => {
  await freshSeed(db);
  const res = await request(app).post('/v1/auth/register').send({
    email: 'owner@iya-basira.test', password: 'amala2026', fullName: 'Basirat Lawal', phone: '08051112222', role: 'VENDOR',
  });
  expect(res.status).toBe(201);
  vendor = res.body.accessToken;
}, 120_000);
afterAll(() => db.$disconnect());

const v = (path = '') => `/v1/vendor/restaurants/${restaurantId}${path}`;
const searchAmala = () => request(app).get('/v1/search/food').query({ q: 'amala', lat: ADA_HOME.lat, lng: ADA_HOME.lng });

describe('restaurant onboarding', () => {
  it('vendor registers a restaurant; it starts pending and hidden', async () => {
    const res = await request(app).post('/v1/vendor/restaurants').set(bearer(vendor)).send({
      name: "Iya Basira's Amala", description: 'Amala, ewedu and gbegiri.', phone: '08051112222',
      addressLine: '3 Akarigbo Street', area: 'Makun', city: 'Sagamu', latitude: 6.8425, longitude: 3.6484, prepTimeMinutes: 20,
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ verificationStatus: 'PENDING', isAcceptingOrders: false, slug: 'iya-basiras-amala' });
    restaurantId = res.body.id;
    slug = res.body.slug;

    expect((await request(app).get(`/v1/restaurants/${slug}`)).status).toBe(404);
  });

  it('vendor cannot switch on orders before approval', async () => {
    const res = await request(app).put(v('/availability')).set(bearer(vendor)).send({ isAcceptingOrders: true });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('RESTAURANT_NOT_APPROVED');
  });

  it('vendor cannot change verification fields', async () => {
    const res = await request(app).patch(v()).set(bearer(vendor)).send({ verificationStatus: 'APPROVED' });
    expect(res.status).toBe(400);
  });

  it('admin cannot approve until opening hours exist', async () => {
    const admin = await tokenFor(app, 'admin');
    const res = await request(app).post(`/v1/admin/restaurants/${restaurantId}/approve`).set(bearer(admin)).send({});
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('RESTAURANT_INCOMPLETE');
  });

  it('vendor sets opening hours; overlapping windows are rejected', async () => {
    const bad = await request(app).put(v('/hours')).set(bearer(vendor)).send({
      windows: [{ dayOfWeek: 3, opensAt: 480, closesAt: 900 }, { dayOfWeek: 3, opensAt: 840, closesAt: 1200 }],
    });
    expect(bad.status).toBe(400);
    const ok = await request(app).put(v('/hours')).set(bearer(vendor)).send({
      windows: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, opensAt: 9 * 60, closesAt: 21 * 60 })),
    });
    expect(ok.status).toBe(200);
    expect(ok.body.hours).toHaveLength(7);
    expect(ok.body.isOpenNow).toBe(true); // test clock: Wednesday 12:00 Lagos
  });

  it('support staff can view but not approve; operations can approve (audited)', async () => {
    const support = await tokenFor(app, 'support');
    expect((await request(app).get(`/v1/admin/restaurants/${restaurantId}`).set(bearer(support))).status).toBe(200);
    expect((await request(app).post(`/v1/admin/restaurants/${restaurantId}/approve`).set(bearer(support)).send({})).status).toBe(403);

    const ops = await tokenFor(app, 'ops');
    const res = await request(app).post(`/v1/admin/restaurants/${restaurantId}/approve`).set(bearer(ops)).send({ note: 'Kitchen inspected' });
    expect(res.status).toBe(200);
    expect(res.body.verificationStatus).toBe('APPROVED');
    expect(await db.auditLog.count({ where: { action: 'restaurant.approve', entityId: restaurantId } })).toBe(1);
  });
});

describe('menu management', () => {
  it('vendor creates a category and an item with variants and extras', async () => {
    const cat = await request(app).post(v('/categories')).set(bearer(vendor)).send({ name: 'Swallow' });
    expect(cat.status).toBe(201);
    categoryId = cat.body.id;
    expect((await request(app).post(v('/categories')).set(bearer(vendor)).send({ name: 'Swallow' })).status).toBe(409);

    const item = await request(app).post(v('/items')).set(bearer(vendor)).send({
      categoryId, name: 'Amala & Ewedu', description: 'With gbegiri and stew', priceKobo: 250_000,
      variants: [{ name: 'Regular', priceKobo: 250_000 }, { name: 'Big wrap', priceKobo: 320_000 }],
      extras: [{ name: 'Goat meat', priceKobo: 150_000, maxQuantity: 2 }, { name: 'Ponmo', priceKobo: 50_000 }],
    });
    expect(item.status).toBe(201);
    itemId = item.body.id;
    expect(item.body.fromPriceKobo).toBe(250_000);
    expect(item.body.variants.filter((x: { isDefault: boolean }) => x.isDefault)).toHaveLength(1);
  });

  it('rejects invalid prices and duplicate variant names', async () => {
    const neg = await request(app).post(v('/items')).set(bearer(vendor)).send({ categoryId, name: 'Bad', priceKobo: -1 });
    expect(neg.status).toBe(400);
    const frac = await request(app).post(v('/items')).set(bearer(vendor)).send({ categoryId, name: 'Bad', priceKobo: 100.5 });
    expect(frac.status).toBe(400);
    const dup = await request(app).post(v('/items')).set(bearer(vendor)).send({
      categoryId, name: 'Bad', priceKobo: 100, variants: [{ name: 'A', priceKobo: 1 }, { name: 'a', priceKobo: 2 }],
    });
    expect(dup.status).toBe(400);
  });

  it('is not discoverable until the vendor switches orders on', async () => {
    const before = await searchAmala();
    expect(before.body.items.some((r: { restaurant: { id: string } }) => r.restaurant.id === restaurantId)).toBe(false);

    const on = await request(app).put(v('/availability')).set(bearer(vendor)).send({ isAcceptingOrders: true });
    expect(on.status).toBe(200);

    const after = await searchAmala();
    const hit = after.body.items.find((r: { item: { id: string } }) => r.item.id === itemId);
    expect(hit).toMatchObject({ orderable: true, item: { fromPriceKobo: 250_000, hasVariants: true, hasExtras: true } });
    expect(hit.restaurant.deliveryFeeKobo).toBeGreaterThan(0);
  });

  it('updating an item retires removed variants but keeps past references', async () => {
    const menu = await request(app).get(v('/menu')).set(bearer(vendor));
    const item = menu.body.categories[0].items[0];
    const regular = item.variants.find((x: { name: string }) => x.name === 'Regular');
    const res = await request(app).put(v(`/items/${itemId}`)).set(bearer(vendor)).send({
      categoryId, name: 'Amala & Ewedu', priceKobo: 260_000,
      variants: [{ id: regular.id, name: 'Regular', priceKobo: 260_000, isDefault: true }],
      extras: [],
    });
    expect(res.status).toBe(200);
    expect(res.body.variants).toHaveLength(1);
    expect(res.body.extras).toHaveLength(0);
    expect(await db.menuItemVariant.count({ where: { menuItemId: itemId } })).toBe(2); // retired, not deleted

    const foreign = await db.menuItemVariant.findFirstOrThrow({ where: { menuItem: { restaurant: { slug: 'bukka-republic' } } } });
    const bad = await request(app).put(v(`/items/${itemId}`)).set(bearer(vendor)).send({
      categoryId, name: 'Amala & Ewedu', priceKobo: 260_000, variants: [{ id: foreign.id, name: 'Stolen', priceKobo: 1 }],
    });
    expect(bad.status).toBe(400);
  });

  it('sold-out items are hidden from default search but visible (not orderable) on request', async () => {
    expect((await request(app).put(v(`/items/${itemId}/availability`)).set(bearer(vendor)).send({ isAvailable: false })).status).toBe(200);
    const hidden = await searchAmala();
    expect(hidden.body.items.some((r: { item: { id: string } }) => r.item.id === itemId)).toBe(false);
    const shown = await request(app).get('/v1/search/food').query({ q: 'amala', includeUnavailable: 'true' });
    expect(shown.body.items.find((r: { item: { id: string } }) => r.item.id === itemId)).toMatchObject({ orderable: false, item: { isAvailable: false } });
    await request(app).put(v(`/items/${itemId}/availability`)).set(bearer(vendor)).send({ isAvailable: true });
  });

  it('a category with live items cannot be deleted; deleting the item removes it from menus', async () => {
    expect((await request(app).delete(v(`/categories/${categoryId}`)).set(bearer(vendor))).status).toBe(409);
    expect((await request(app).delete(v(`/items/${itemId}`)).set(bearer(vendor))).status).toBe(200);
    const detail = await request(app).get(`/v1/restaurants/${slug}`);
    expect(detail.status).toBe(200);
    expect(JSON.stringify(detail.body.menu)).not.toContain(itemId);
    expect((await request(app).delete(v(`/categories/${categoryId}`)).set(bearer(vendor))).status).toBe(200);
  });
});

describe('suspension', () => {
  it('suspending a restaurant stops orders and hides it, with a required reason', async () => {
    const ops = await tokenFor(app, 'ops');
    const noReason = await request(app).post(`/v1/admin/restaurants/${restaurantId}/suspend`).set(bearer(ops)).send({});
    expect(noReason.status).toBe(400);
    const res = await request(app).post(`/v1/admin/restaurants/${restaurantId}/suspend`).set(bearer(ops)).send({ reason: 'Hygiene complaint under review' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ verificationStatus: 'SUSPENDED', isAcceptingOrders: false });
    expect((await request(app).get(`/v1/restaurants/${slug}`)).status).toBe(404);
    const vendorView = await request(app).get(v()).set(bearer(vendor));
    expect(vendorView.body.verificationNote).toBe('Hygiene complaint under review');
  });
});
