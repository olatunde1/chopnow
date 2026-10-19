import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';

/**
 * Password hashing with Node's built-in scrypt (no native add-on to compile).
 * Stored format: scrypt$<N>$<r>$<p>$<salt b64url>$<hash b64url>
 * Parameters are stored with the hash so they can be raised later; needsRehash() flags old hashes
 * for upgrade on next successful login.
 *
 * N=2^16, r=8, p=2 → ~64 MiB, comfortably above OWASP's scrypt minimums while keeping login
 * latency reasonable on a small server.
 */
const CURRENT = { N: 2 ** 16, r: 8, p: 2 } as const;
const KEY_LENGTH = 64;
const SALT_BYTES = 16;

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

function scrypt(password: string, salt: Buffer, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // maxmem must exceed 128 * N * r bytes.
    scryptCb(password.normalize('NFKC'), salt, KEY_LENGTH, { ...opts, maxmem: 256 * 1024 * 1024 }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await scrypt(password, salt, CURRENT);
  return ['scrypt', CURRENT.N, CURRENT.r, CURRENT.p, salt.toString('base64url'), key.toString('base64url')].join('$');
}

function parse(stored: string) {
  const [alg, n, r, p, salt, hash] = stored.split('$');
  if (alg !== 'scrypt' || !n || !r || !p || !salt || !hash) return null;
  return { N: Number(n), r: Number(r), p: Number(p), salt: Buffer.from(salt, 'base64url'), hash: Buffer.from(hash, 'base64url') };
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parse(stored);
  if (!parsed) return false;
  const key = await scrypt(password, parsed.salt, { N: parsed.N, r: parsed.r, p: parsed.p });
  return key.length === parsed.hash.length && timingSafeEqual(key, parsed.hash);
}

export function needsRehash(stored: string): boolean {
  const parsed = parse(stored);
  return !parsed || parsed.N < CURRENT.N || parsed.r !== CURRENT.r || parsed.p < CURRENT.p;
}

/**
 * A real hash of a random password, used to spend the same time verifying when the email does
 * not exist, so response timing does not reveal registered emails.
 */
let dummyHash: Promise<string> | undefined;
export function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(16).toString('hex'));
  return dummyHash;
}
