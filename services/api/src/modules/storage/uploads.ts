import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { AppError } from '../../lib/errors.js';
import type { StorageDriver } from './storage.js';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_EDGE = 1600;

/** Sniffs the real file type from its first bytes; the client's filename and Content-Type are ignored. */
export function sniffType(buf: Buffer): 'jpeg' | 'png' | 'webp' | 'pdf' | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  return null;
}

const badImage = (message: string) => new AppError(400, 'INVALID_IMAGE', message);

/**
 * Validates and re-encodes a photo before storing it. Re-encoding through sharp:
 * - rejects anything that is not really a JPEG/PNG/WebP image (polyglot and spoofed files),
 * - strips EXIF/GPS and other metadata,
 * - normalises orientation, bounds the size, and outputs WebP.
 */
export async function storeImage(storage: StorageDriver, buf: Buffer, keyPrefix: string) {
  if (buf.length > MAX_IMAGE_BYTES) throw badImage('Images must be 5 MB or smaller.');
  const type = sniffType(buf);
  if (type !== 'jpeg' && type !== 'png' && type !== 'webp') throw badImage('Upload a JPG, PNG or WebP photo.');
  let meta;
  try {
    meta = await sharp(buf, { failOn: 'error', limitInputPixels: 40_000_000 }).metadata();
  } catch {
    throw badImage('This image file is damaged or unreadable.');
  }
  if (!meta.width || !meta.height || meta.width < 200 || meta.height < 200) throw badImage('Photos must be at least 200 × 200 pixels.');

  const { data, info } = await sharp(buf, { failOn: 'error', limitInputPixels: 40_000_000 })
    .rotate()
    .resize({ width: MAX_IMAGE_EDGE, height: MAX_IMAGE_EDGE, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer({ resolveWithObject: true });
  const key = `${keyPrefix}/${randomUUID()}.webp`;
  const url = await storage.putPublic(key, data, 'image/webp');
  return { url, width: info.width, height: info.height, bytes: data.length };
}

const DOC_TYPES = { pdf: 'application/pdf', jpeg: 'image/jpeg', png: 'image/png' } as const;

/** Stores a verification document privately after checking its real type and size. */
export async function storeDocument(storage: StorageDriver, buf: Buffer, keyPrefix: string) {
  if (buf.length > MAX_DOCUMENT_BYTES) throw new AppError(400, 'INVALID_DOCUMENT', 'Documents must be 10 MB or smaller.');
  const type = sniffType(buf);
  if (type !== 'pdf' && type !== 'jpeg' && type !== 'png') throw new AppError(400, 'INVALID_DOCUMENT', 'Upload a PDF, JPG or PNG file.');
  const ext = type === 'jpeg' ? 'jpg' : type;
  const key = `${keyPrefix}/${randomUUID()}.${ext}`;
  await storage.putPrivate(key, buf, DOC_TYPES[type]);
  return { key, mimeType: DOC_TYPES[type], sizeBytes: buf.length };
}

/** Only images hosted by ChopNow may be referenced from menus and profiles (no hot-linking). */
export function assertOwnMediaUrl(url: string | null | undefined, publicBaseUrl: string) {
  if (url === null || url === undefined) return;
  if (!url.startsWith(`${publicBaseUrl}/`) || url.includes('..')) {
    throw new AppError(400, 'INVALID_IMAGE_URL', 'Upload the photo through ChopNow first, then use the returned URL.');
  }
}
