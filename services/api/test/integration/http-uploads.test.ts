/**
 * Food image uploads and private verification documents: type sniffing, re-encoding (metadata
 * stripped), size limits, ownership, no hot-linking, and signed access to private files.
 */
import sharp from 'sharp';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LocalStorageDriver, assertSafeKey } from '../../src/modules/storage/storage.js';
import { createTestDb } from './helpers.js';
import { bearer, buildTestHarness, freshSeed, tokenFor } from './http-helpers.js';

const db = createTestDb();
const harness = buildTestHarness(db);
const app = harness.app;

let vendor: string;
let otherVendor: string;
let customer: string;
let mamaId: string;
let categoryId: string;
const upload = (token: string, buf: Buffer, filename: string, purpose = 'menu_item', restaurantId = mamaId) =>
  request(app).post(`/v1/vendor/restaurants/${restaurantId}/images`).query({ purpose }).set(bearer(token)).attach('file', buf, filename);

/** A real JPEG carrying EXIF data (copyright + camera), to prove metadata is stripped. */
async function jpegWithExif(width = 1200, height = 900) {
  return sharp({ create: { width, height, channels: 3, background: { r: 200, g: 90, b: 30 } } })
    .jpeg()
    .withExif({ IFD0: { Copyright: 'Owner secret', Make: 'TestCam' } })
    .toBuffer();
}

beforeAll(async () => {
  await freshSeed(db);
  vendor = await tokenFor(app, 'vendor.mamankechi');
  otherVendor = await tokenFor(app, 'vendor.bukka');
  customer = await tokenFor(app, 'ada');
  const mama = await db.restaurant.findUniqueOrThrow({ where: { slug: 'mama-nkechis-kitchen' }, include: { categories: true } });
  mamaId = mama.id;
  categoryId = mama.categories[0]!.id;
}, 120_000);
afterAll(() => db.$disconnect());

describe('image uploads', () => {
  let url: string;

  it('re-encodes a JPEG to WebP, bounds its size and strips metadata', async () => {
    const original = await jpegWithExif(3000, 2000);
    expect((await sharp(original).metadata()).exif).toBeDefined();

    const res = await upload(vendor, original, 'jollof.jpg');
    expect(res.status).toBe(201);
    url = res.body.url;
    expect(url).toMatch(new RegExp(`^http://localhost:4000/media/restaurants/${mamaId}/menu-item/[0-9a-f-]+\\.webp$`));
    expect(res.body).toMatchObject({ width: 1600, height: 1067 });

    const served = await request(app).get(new URL(url).pathname).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toBe('image/webp');
    expect(served.headers['cross-origin-resource-policy']).toBe('cross-origin');
    const meta = await sharp(served.body as Buffer).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.exif).toBeUndefined();
    expect((served.body as Buffer).toString('latin1')).not.toContain('Owner secret');
  });

  it('rejects files that are not really images, tiny images and oversized files', async () => {
    const fake = await upload(vendor, Buffer.from('<script>alert(1)</script>'), 'photo.jpg');
    expect(fake.status).toBe(400);
    expect(fake.body.error.code).toBe('INVALID_IMAGE');

    const truncated = (await jpegWithExif()).subarray(0, 400);
    expect((await upload(vendor, truncated, 'broken.jpg')).status).toBe(400);

    const tiny = await sharp({ create: { width: 50, height: 50, channels: 3, background: '#fff' } }).png().toBuffer();
    expect((await upload(vendor, tiny, 'tiny.png')).body.error.message).toMatch(/200 × 200/);

    const huge = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(6 * 1024 * 1024)]);
    const big = await upload(vendor, huge, 'huge.jpg');
    expect(big.status).toBe(413);
    expect(big.body.error.code).toBe('FILE_TOO_LARGE');
  });

  it("only the restaurant's owner can upload", async () => {
    const img = await jpegWithExif();
    expect((await upload(otherVendor, img, 'x.jpg')).status).toBe(404);
    expect((await upload(customer, img, 'x.jpg')).status).toBe(403);
    expect((await request(app).post(`/v1/vendor/restaurants/${mamaId}/images`).query({ purpose: 'menu_item' }).attach('file', img, 'x.jpg')).status).toBe(401);
  });

  it('menu items accept uploaded ChopNow images but not hot-linked URLs', async () => {
    const external = await request(app)
      .post(`/v1/vendor/restaurants/${mamaId}/items`)
      .set(bearer(vendor))
      .send({ categoryId, name: 'Hotlinked Rice', priceKobo: 100_000, imageUrl: 'https://evil.example/tracker.jpg' });
    expect(external.status).toBe(400);
    expect(external.body.error.code).toBe('INVALID_IMAGE_URL');

    const sneaky = await request(app)
      .post(`/v1/vendor/restaurants/${mamaId}/items`)
      .set(bearer(vendor))
      .send({ categoryId, name: 'Sneaky Rice', priceKobo: 100_000, imageUrl: 'http://localhost:4000/media/../../etc/passwd' });
    expect(sneaky.status).toBe(400);

    const ok = await request(app).post(`/v1/vendor/restaurants/${mamaId}/items`).set(bearer(vendor)).send({ categoryId, name: 'Photo Rice', priceKobo: 100_000, imageUrl: url });
    expect(ok.status).toBe(201);
    expect(ok.body.imageUrl).toBe(url);

    const logo = await request(app).patch(`/v1/vendor/restaurants/${mamaId}`).set(bearer(vendor)).send({ logoUrl: 'https://evil.example/logo.png' });
    expect(logo.status).toBe(400);
  });
});

describe('verification documents', () => {
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << >>\n%%EOF\n');
  const sendDoc = (token: string, buf: Buffer, type?: string) => {
    const r = request(app).post(`/v1/vendor/restaurants/${mamaId}/documents`).set(bearer(token));
    if (type) r.field('type', type);
    return r.attach('file', buf, '../../CAC cert<script>.pdf');
  };

  it('stores documents privately, sanitises the name and never returns the storage key', async () => {
    expect((await sendDoc(vendor, pdf)).status).toBe(400); // type missing
    const res = await sendDoc(vendor, pdf, 'CAC_CERTIFICATE');
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ type: 'CAC_CERTIFICATE', mimeType: 'application/pdf', status: 'PENDING' });
    expect(res.body.originalName).not.toMatch(/[<>/\\]/);
    expect(JSON.stringify(res.body)).not.toMatch(/storageKey|verification\//);

    const list = await request(app).get(`/v1/vendor/restaurants/${mamaId}/documents`).set(bearer(vendor));
    expect(list.body.items).toHaveLength(1);
    expect((await request(app).get(`/v1/vendor/restaurants/${mamaId}/documents`).set(bearer(otherVendor))).status).toBe(404);

    const doc = await db.verificationDocument.findFirstOrThrow({ where: { restaurantId: mamaId } });
    // Not reachable through the public media path.
    expect((await request(app).get(`/media/${doc.storageKey}`)).status).toBe(404);

    const storage = harness.services.storage as LocalStorageDriver;
    const signed = new URL(await storage.signedPrivateUrl(doc.storageKey, 60));
    const ok = await request(app).get(`${signed.pathname}${signed.search}`);
    expect(ok.status).toBe(200);
    expect(ok.headers['content-disposition']).toBe('attachment');
    expect(ok.headers['cache-control']).toBe('private, no-store');
    const tampered = signed.search.replace(/sig=([0-9a-f])/, (_m, c: string) => `sig=${c === 'a' ? 'b' : 'a'}`);
    expect((await request(app).get(`${signed.pathname}${tampered}`)).status).toBe(404);
    const expired = new URL(await storage.signedPrivateUrl(doc.storageKey, -10));
    expect((await request(app).get(`${expired.pathname}${expired.search}`)).status).toBe(404);
  });

  it('rejects executables and other file types', async () => {
    const exe = Buffer.from('MZ\x90\x00 fake executable');
    const res = await sendDoc(vendor, exe, 'OTHER');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_DOCUMENT');
  });

  it('storage keys cannot escape their directory', () => {
    expect(() => assertSafeKey('../etc/passwd')).toThrow();
    expect(() => assertSafeKey('restaurants/x/../../y.webp')).toThrow();
    expect(() => assertSafeKey('Restaurants/UPPER.webp')).toThrow();
    expect(() => assertSafeKey('restaurants/abc/menu-item/1.webp')).not.toThrow();
  });
});
