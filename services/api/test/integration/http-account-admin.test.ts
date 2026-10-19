import { readFileSync } from 'node:fs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb } from './helpers.js';
import { YABA, bearer, buildTestApp, freshSeed, tokenFor } from './http-helpers.js';

const db = createTestDb();
const app = buildTestApp(db);

beforeAll(() => freshSeed(db), 120_000);
afterAll(() => db.$disconnect());

describe('auth over HTTP', () => {
  it('register → me → refresh → logout', async () => {
    const reg = await request(app).post('/v1/auth/register').send({ email: 'Chi@Example.com', password: 'egusi2026', fullName: 'Chioma Eze' });
    expect(reg.status).toBe(201);
    expect(reg.body.user).toMatchObject({ email: 'chi@example.com', role: 'CUSTOMER' });

    const me = await request(app).get('/v1/me').set(bearer(reg.body.accessToken));
    expect(me.body).toMatchObject({ fullName: 'Chioma Eze', status: 'ACTIVE', rider: null, restaurants: [] });

    const refreshed = await request(app).post('/v1/auth/refresh').send({ refreshToken: reg.body.refreshToken });
    expect(refreshed.status).toBe(200);
    expect((await request(app).post('/v1/auth/refresh').send({ refreshToken: reg.body.refreshToken })).status).toBe(401);

    expect((await request(app).post('/v1/auth/logout').send({ refreshToken: refreshed.body.refreshToken })).status).toBe(200);
    expect((await request(app).post('/v1/auth/refresh').send({ refreshToken: refreshed.body.refreshToken })).status).toBe(401);
  });

  it('changing password keeps this device signed in and signs out the others', async () => {
    const first = await request(app).post('/v1/auth/register').send({ email: 'pw@example.com', password: 'moimoi2026', fullName: 'Pat Okon' });
    const second = await request(app).post('/v1/auth/login').send({ email: 'pw@example.com', password: 'moimoi2026' });

    const wrong = await request(app).post('/v1/me/password').set(bearer(first.body.accessToken)).send({ currentPassword: 'nope12345', newPassword: 'akara2026' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.code).toBe('CURRENT_PASSWORD_INCORRECT');

    const changed = await request(app).post('/v1/me/password').set(bearer(first.body.accessToken)).send({ currentPassword: 'moimoi2026', newPassword: 'akara2026' });
    expect(changed.status).toBe(200);
    expect((await request(app).get('/v1/me').set(bearer(changed.body.accessToken))).status).toBe(200);
    expect((await request(app).get('/v1/me').set(bearer(second.body.accessToken))).status).toBe(401);
    expect((await request(app).post('/v1/auth/refresh').send({ refreshToken: second.body.refreshToken })).status).toBe(401);
    expect((await request(app).post('/v1/auth/login').send({ email: 'pw@example.com', password: 'akara2026' })).status).toBe(200);
  });
});

describe('profile and addresses', () => {
  it('updates profile; phone must be unique', async () => {
    const tunde = await tokenFor(app, 'tunde');
    const ok = await request(app).patch('/v1/me').set(bearer(tunde)).send({ fullName: 'Tunde B.' });
    expect(ok.body.fullName).toBe('Tunde B.');
    const taken = await request(app).patch('/v1/me').set(bearer(tunde)).send({ phone: '08031110001' }); // Ada's
    expect(taken.status).toBe(409);
  });

  it('manages addresses: coordinates required, first becomes default, default moves, delete is soft', async () => {
    const reg = await request(app).post('/v1/auth/register').send({ email: 'addr@example.com', password: 'suya12345', fullName: 'Addy Test' });
    const t = reg.body.accessToken;
    const noCoords = await request(app).post('/v1/me/addresses').set(bearer(t)).send({ label: 'Home', line1: '1 Road', area: 'Yaba', city: 'Lagos' });
    expect(noCoords.status).toBe(400);

    const a = await request(app).post('/v1/me/addresses').set(bearer(t)).send({ label: 'Home', line1: '1 Akoka Road', area: 'Yaba', city: 'Lagos', latitude: YABA.lat, longitude: YABA.lng });
    expect(a.status).toBe(201);
    expect(a.body.isDefault).toBe(true);
    const b = await request(app).post('/v1/me/addresses').set(bearer(t)).send({ label: 'Work', line1: '2 Herbert Macaulay', area: 'Yaba', city: 'Lagos', latitude: 6.51, longitude: 3.37, makeDefault: true });
    expect(b.body.isDefault).toBe(true);

    const list = await request(app).get('/v1/me/addresses').set(bearer(t));
    expect(list.body.items.map((x: { label: string; isDefault: boolean }) => [x.label, x.isDefault])).toEqual([['Home', false], ['Work', true]]);

    expect((await request(app).delete(`/v1/me/addresses/${b.body.id}`).set(bearer(t))).status).toBe(200);
    const after = await request(app).get('/v1/me/addresses').set(bearer(t));
    expect(after.body.items).toHaveLength(1);
    expect(await db.address.count({ where: { id: b.body.id } })).toBe(1); // soft-deleted
    const me = await request(app).get('/v1/me').set(bearer(t));
    expect(me.body.defaultAddressId).toBeNull();
  });

  it('vendors and riders cannot manage customer addresses', async () => {
    const vendor = await tokenFor(app, 'vendor.bukka');
    expect((await request(app).get('/v1/me/addresses').set(bearer(vendor))).status).toBe(403);
  });
});

describe('rider approvals', () => {
  it('approves a pending rider as CORE; cannot approve twice', async () => {
    const ops = await tokenFor(app, 'ops');
    const pending = await db.rider.findFirstOrThrow({ where: { verificationStatus: 'PENDING' } });
    const list = await request(app).get('/v1/admin/riders').query({ status: 'PENDING' }).set(bearer(ops));
    expect(list.body.items.map((r: { id: string }) => r.id)).toContain(pending.id);

    const res = await request(app).post(`/v1/admin/riders/${pending.id}/approve`).set(bearer(ops)).send({ riderType: 'CORE' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ verificationStatus: 'APPROVED', riderType: 'CORE' });
    expect((await request(app).post(`/v1/admin/riders/${pending.id}/approve`).set(bearer(ops)).send({ riderType: 'CORE' })).status).toBe(409);
    expect(await db.auditLog.count({ where: { action: 'rider.approve', entityId: pending.id } })).toBe(1);
  });

  it('suspends a rider (forcing offline) unless they hold an active delivery', async () => {
    const ops = await tokenFor(app, 'ops');
    const online = await db.rider.findFirstOrThrow({ where: { riderType: 'INDEPENDENT', availability: 'ONLINE' } });

    const offering = await db.delivery.findFirstOrThrow({ where: { status: 'OFFERING' } });
    await db.delivery.update({ where: { id: offering.id }, data: { status: 'ASSIGNED', currentRiderId: online.id } });
    const blocked = await request(app).post(`/v1/admin/riders/${online.id}/suspend`).set(bearer(ops)).send({ reason: 'Repeated late deliveries' });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('RIDER_HAS_ACTIVE_DELIVERY');

    await db.delivery.update({ where: { id: offering.id }, data: { status: 'OFFERING', currentRiderId: null } });
    const ok = await request(app).post(`/v1/admin/riders/${online.id}/suspend`).set(bearer(ops)).send({ reason: 'Repeated late deliveries' });
    expect(ok.body).toMatchObject({ verificationStatus: 'SUSPENDED', availability: 'OFFLINE' });
  });
});

describe('business rules configuration', () => {
  it('only ADMIN can change rules; changes are validated and audited with before/after', async () => {
    const ops = await tokenFor(app, 'ops');
    expect((await request(app).get('/v1/admin/settings/business-rules').set(bearer(ops))).status).toBe(403);

    const admin = await tokenFor(app, 'admin');
    const current = (await request(app).get('/v1/admin/settings/business-rules').set(bearer(admin))).body;
    expect(current.pricing.commissionBps).toBe(1500);

    const bad = await request(app).put('/v1/admin/settings/business-rules').set(bearer(admin)).send({ ...current, pricing: { ...current.pricing, commissionBps: 20_000 } });
    expect(bad.status).toBe(400);

    const next = { ...current, pricing: { ...current.pricing, commissionBps: 1200 } };
    const ok = await request(app).put('/v1/admin/settings/business-rules').set(bearer(admin)).send(next);
    expect(ok.status).toBe(200);
    expect(ok.body.pricing.commissionBps).toBe(1200);
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: 'settings.business_rules_update' } });
    expect(audit.before).toMatchObject({ pricing: { commissionBps: 1500 } });
    expect(audit.after).toMatchObject({ pricing: { commissionBps: 1200 } });
  });
});

describe('API documentation', () => {
  it('serves an OpenAPI document covering every route, and docs/API_DOCUMENTATION.md lists them all', async () => {
    const res = await request(app).get('/v1/openapi.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe('3.1.0');
    const documented = Object.entries(res.body.paths as Record<string, Record<string, unknown>>).flatMap(([p, ops]) =>
      Object.keys(ops).map((m) => `${m.toUpperCase()} ${p}`),
    );
    expect(documented.length).toBeGreaterThan(40);

    const markdown = readFileSync(new URL('../../../../docs/API_DOCUMENTATION.md', import.meta.url), 'utf8');
    const missing = documented.filter((d) => !markdown.includes(`\`${d}\``));
    expect(missing).toEqual([]);
  });

  it('is not served when disabled', async () => {
    const prod = buildTestApp(db, { env: { API_DOCS_ENABLED: 'false' } });
    expect((await request(prod).get('/v1/openapi.json')).status).toBe(404);
  });
});
