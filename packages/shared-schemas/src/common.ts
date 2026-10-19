import { z } from 'zod';

export const IdSchema = z.uuid({ message: 'Invalid id' });

/** Integer kobo, never negative. */
export const KoboSchema = z.number().int().min(0).max(2_000_000_000);

export const LatitudeSchema = z.number().min(-90).max(90);
export const LongitudeSchema = z.number().min(-180).max(180);

/** Query-string coordinate (strings coerced to numbers). */
export const LatitudeQuery = z.coerce.number().min(-90).max(90);
export const LongitudeQuery = z.coerce.number().min(-180).max(180);

export const PageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type PageQuery = z.infer<typeof PageQuerySchema>;

export function paginated<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int(),
  });
}

export const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

export const OkResponseSchema = z.object({ ok: z.literal(true) });

/** Trimmed, length-bounded text; empty strings become undefined for optional fields. */
export const text = (max: number) => z.string().trim().max(max);
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? undefined : v))
    .optional();

/** ISO timestamp in responses. */
export const DateTimeSchema = z.iso.datetime();
