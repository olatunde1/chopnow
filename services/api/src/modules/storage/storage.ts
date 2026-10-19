import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/**
 * Object storage. Two areas:
 * - public:  food photos, logos, covers. Served by URL, cacheable.
 * - private: verification documents. Never public; only short-lived signed URLs for authorised staff.
 */
export interface StorageDriver {
  readonly publicBaseUrl: string;
  putPublic(key: string, body: Buffer, contentType: string): Promise<string>;
  putPrivate(key: string, body: Buffer, contentType: string): Promise<void>;
  signedPrivateUrl(key: string, ttlSeconds: number): Promise<string>;
}

const SAFE_KEY = /^[a-z0-9][a-z0-9/_.-]{3,200}$/;
export function assertSafeKey(key: string) {
  if (!SAFE_KEY.test(key) || key.includes('..') || key.includes('//')) throw new Error(`Unsafe storage key: ${key}`);
}

/**
 * Development driver: files on local disk. Public files are served by the API at /media.
 * Private files are served only through HMAC-signed, expiring URLs at /media-private.
 */
export class LocalStorageDriver implements StorageDriver {
  private readonly root: string;

  constructor(
    rootDir: string,
    readonly publicBaseUrl: string,
    private readonly privateBaseUrl: string,
    private readonly signingSecret: string,
  ) {
    this.root = resolve(rootDir);
  }

  /** Absolute path for a key, guaranteed to stay inside the area directory. */
  pathFor(area: 'public' | 'private', key: string) {
    assertSafeKey(key);
    const base = resolve(this.root, area);
    const full = resolve(base, key);
    if (!full.startsWith(base + sep)) throw new Error('Path traversal');
    return full;
  }

  get publicDir() {
    return resolve(this.root, 'public');
  }

  private async write(area: 'public' | 'private', key: string, body: Buffer) {
    const path = this.pathFor(area, key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body, { flag: 'wx' }); // never overwrite
  }

  async putPublic(key: string, body: Buffer): Promise<string> {
    await this.write('public', key, body);
    return `${this.publicBaseUrl}/${key}`;
  }

  async putPrivate(key: string, body: Buffer): Promise<void> {
    await this.write('private', key, body);
  }

  private sign(key: string, exp: number) {
    return createHmac('sha256', this.signingSecret).update(`${key}:${exp}`).digest('hex');
  }

  async signedPrivateUrl(key: string, ttlSeconds: number): Promise<string> {
    assertSafeKey(key);
    const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
    return `${this.privateBaseUrl}/${key}?exp=${exp}&sig=${this.sign(key, exp)}`;
  }

  /** Returns the file if the signature is valid and unexpired, else null. */
  async readPrivate(key: string, exp: number, sig: string): Promise<Buffer | null> {
    if (!Number.isInteger(exp) || exp < Date.now() / 1000 || !/^[0-9a-f]{64}$/.test(sig)) return null;
    const expected = Buffer.from(this.sign(key, exp), 'hex');
    if (!timingSafeEqual(expected, Buffer.from(sig, 'hex'))) return null;
    try {
      return await readFile(this.pathFor('private', key));
    } catch {
      return null;
    }
  }
}

/** S3-compatible driver (AWS S3, Cloudflare R2, Supabase Storage S3 API, MinIO). */
export class S3StorageDriver implements StorageDriver {
  private readonly client: S3Client;

  constructor(
    private readonly opts: { endpoint?: string; region: string; accessKeyId: string; secretAccessKey: string; publicBucket: string; privateBucket: string },
    readonly publicBaseUrl: string,
  ) {
    this.client = new S3Client({
      region: opts.region,
      endpoint: opts.endpoint || undefined,
      forcePathStyle: !!opts.endpoint,
      credentials: { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey },
    });
  }

  async putPublic(key: string, body: Buffer, contentType: string): Promise<string> {
    assertSafeKey(key);
    await this.client.send(new PutObjectCommand({ Bucket: this.opts.publicBucket, Key: key, Body: body, ContentType: contentType, CacheControl: 'public, max-age=31536000, immutable' }));
    return `${this.publicBaseUrl}/${key}`;
  }

  async putPrivate(key: string, body: Buffer, contentType: string): Promise<void> {
    assertSafeKey(key);
    await this.client.send(new PutObjectCommand({ Bucket: this.opts.privateBucket, Key: key, Body: body, ContentType: contentType, ServerSideEncryption: this.opts.endpoint ? undefined : 'AES256' }));
  }

  async signedPrivateUrl(key: string, ttlSeconds: number): Promise<string> {
    assertSafeKey(key);
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.opts.privateBucket, Key: key, ResponseContentDisposition: 'attachment' }), { expiresIn: ttlSeconds });
  }
}
