/**
 * Customer discovery against the seeded neighbourhood (acceptance steps 3–5: search "jollof rice",
 * see eligible restaurants and their available meals).
 */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb } from './helpers.js';
import { ABUJA, LAGOS_3AM, ADA_HOME, bearer, buildTestApp, freshSeed, tokenFor } from './http-helpers.js';

const db = createTestDb();
const app = buildTestApp(db);

type FoodHit = { item: { name: string; fromPriceKobo: number; isAvailable: boolean }; restaurant: { slug: string; isAcceptingOrders: boolean; deliveryFeeKobo: number | null; distanceMeters: number | null }; orderable: boolean };

beforeAll(() => freshSeed(db), 120_000);
afterAll(() => db.$disconnect());

const searchFood = (q: Record<string, string | number>) => request(app).get('/v1/search/food').query(q);

describe('food-first search', () => {
  it('finds jollof rice at eligible restaurants only, with prices and delivery fees', async () => {
    const res = await searchFood({ q: 'jollof rice', lat: ADA_HOME.lat, lng: ADA_HOME.lng });
    expect(res.status).toBe(200);
    const hits = res.body.items as FoodHit[];
    const slugs = new Set(hits.map((h) => h.restaurant.slug));
    expect(slugs).toEqual(new Set(['mama-nkechis-kitchen', 'bukka-republic']));
    expect(slugs.has('suya-spot-express')).toBe(false); // vendor switched off
    expect(slugs.has('grandmas-pot')).toBe(false); // not approved
    for (const h of hits) {
      expect(h.orderable).toBe(true);
      expect(h.restaurant.deliveryFeeKobo).toBe(50_000); // within the included 2 km
      expect(h.restaurant.distanceMeters).toBeLessThan(2000);
    }
    expect(hits.find((h) => h.item.name === 'Jollof Rice')!.item.fromPriceKobo).toBe(250_000);
  });

  it('shows closed restaurants only when asked, flagged as not accepting orders', async () => {
    const res = await searchFood({ q: 'jollof', includeUnavailable: 'true' });
    const suya = (res.body.items as FoodHit[]).filter((h) => h.restaurant.slug === 'suya-spot-express');
    expect(suya.length).toBeGreaterThan(0);
    for (const h of suya) expect(h).toMatchObject({ orderable: false, restaurant: { isAcceptingOrders: false } });
    expect((res.body.items as FoodHit[]).some((h) => h.restaurant.slug === 'grandmas-pot')).toBe(false);
  });

  it('returns nothing for a location outside every delivery radius', async () => {
    const res = await searchFood({ q: 'jollof', lat: ABUJA.lat, lng: ABUJA.lng, includeUnavailable: 'true' });
    expect(res.body.total).toBe(0);
  });

  it('respects opening hours (03:00 Lagos: nothing is orderable)', async () => {
    const night = buildTestApp(db, { now: LAGOS_3AM });
    const res = await request(night).get('/v1/search/food').query({ q: 'jollof' });
    expect(res.body.total).toBe(0);
    const flagged = await request(night).get('/v1/search/food').query({ q: 'jollof', includeUnavailable: 'true' });
    expect((flagged.body.items as FoodHit[]).every((h) => !h.orderable)).toBe(true);
  });

  it('filters by price and sorts by price', async () => {
    const res = await searchFood({ q: 'rice', minPriceKobo: 260_000, maxPriceKobo: 300_000, sort: 'price_asc' });
    const prices = (res.body.items as FoodHit[]).map((h) => h.item.fromPriceKobo);
    expect(prices.length).toBeGreaterThan(0);
    expect(prices.every((p) => p >= 260_000 && p <= 300_000)).toBe(true);
    expect([...prices].sort((a, b) => a - b)).toEqual(prices);
  });

  it('does not list sold-out items by default', async () => {
    const res = await searchFood({ q: 'ofada' });
    expect(res.body.total).toBe(0);
    const all = await searchFood({ q: 'ofada', includeUnavailable: 'true' });
    expect(all.body.items[0]).toMatchObject({ orderable: false, item: { isAvailable: false } });
  });

  it('treats LIKE wildcards in the query literally', async () => {
    const res = await searchFood({ q: '%%' });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
  });

  it('validates the query', async () => {
    expect((await searchFood({ q: 'j' })).status).toBe(400);
    expect((await searchFood({ q: 'jollof', lat: ADA_HOME.lat })).status).toBe(400);
    expect((await searchFood({ q: 'jollof', minPriceKobo: 5, maxPriceKobo: 1 })).status).toBe(400);
  });
});

describe('restaurant-first browsing', () => {
  it('lists accepting restaurants near the customer with distance and fee', async () => {
    const res = await request(app).get('/v1/restaurants').query({ lat: ADA_HOME.lat, lng: ADA_HOME.lng, sort: 'distance' });
    expect(res.status).toBe(200);
    expect(res.body.items.map((r: { slug: string }) => r.slug)).toEqual(['mama-nkechis-kitchen', 'bukka-republic']);
    expect(res.body.items[0]).toMatchObject({ isAcceptingOrders: true, deliversToLocation: true, deliveryFeeKobo: 50_000 });
  });

  it('searches restaurant names', async () => {
    const res = await request(app).get('/v1/restaurants').query({ q: 'bukka' });
    expect(res.body.items.map((r: { slug: string }) => r.slug)).toEqual(['bukka-republic']);
  });

  it('shows a restaurant with its menu; sold-out items are flagged; pending restaurants 404', async () => {
    const res = await request(app).get('/v1/restaurants/mama-nkechis-kitchen').query({ lat: ADA_HOME.lat, lng: ADA_HOME.lng });
    expect(res.status).toBe(200);
    const items = res.body.menu.categories.flatMap((c: { items: unknown[] }) => c.items) as { name: string; isAvailable: boolean; variants: unknown[]; extras: unknown[] }[];
    expect(items.find((i) => i.name === 'Jollof Rice')).toMatchObject({ isAvailable: true });
    expect(items.find((i) => i.name === 'Jollof Rice')!.variants).toHaveLength(2);
    expect(items.find((i) => i.name === 'Jollof Rice')!.extras.length).toBeGreaterThan(0);
    expect(items.find((i) => i.name === 'Ofada Rice & Ayamase')).toMatchObject({ isAvailable: false });
    expect(res.body.hours).toHaveLength(7);
    expect((await request(app).get('/v1/restaurants/grandmas-pot')).status).toBe(404);
  });

  it('lists food categories that can be ordered now', async () => {
    const res = await request(app).get('/v1/food-categories');
    const names = res.body.categories.map((c: { name: string }) => c.name);
    expect(names).toEqual(expect.arrayContaining(['Rice', 'Mains']));
    expect(names).not.toContain('Grill'); // only at the paused Suya Spot
  });
});

describe('favourites', () => {
  it('a customer can favourite a restaurant and see it marked in results', async () => {
    const ada = await tokenFor(app, 'ada');
    const bukka = await db.restaurant.findUniqueOrThrow({ where: { slug: 'bukka-republic' } });
    expect((await request(app).put(`/v1/me/favourites/${bukka.id}`).set(bearer(ada))).status).toBe(200);
    expect((await request(app).put(`/v1/me/favourites/${bukka.id}`).set(bearer(ada))).status).toBe(200); // idempotent

    const list = await request(app).get('/v1/restaurants').set(bearer(ada));
    expect(list.body.items.find((r: { slug: string }) => r.slug === 'bukka-republic').isFavourite).toBe(true);
    const anon = await request(app).get('/v1/restaurants');
    expect(anon.body.items.every((r: { isFavourite: boolean }) => !r.isFavourite)).toBe(true);

    const favs = await request(app).get('/v1/me/favourites').set(bearer(ada));
    expect(favs.body.items.map((r: { slug: string }) => r.slug)).toEqual(['bukka-republic']);

    const pending = await db.restaurant.findUniqueOrThrow({ where: { slug: 'grandmas-pot' } });
    expect((await request(app).put(`/v1/me/favourites/${pending.id}`).set(bearer(ada))).status).toBe(404);
  });
});
