import { z } from 'zod';
import { DateTimeSchema, IdSchema, PageQuerySchema } from './common.js';

/** In-app notifications, push tokens and realtime tickets (Phase 10). */

export const NotificationSchema = z.object({
  id: IdSchema,
  type: z.string(),
  title: z.string(),
  body: z.string(),
  orderId: IdSchema.nullable(),
  data: z.record(z.string(), z.unknown()),
  readAt: DateTimeSchema.nullable(),
  createdAt: DateTimeSchema,
});
export const NotificationListSchema = z.object({
  items: z.array(NotificationSchema),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
  unreadCount: z.number().int(),
});
export const NotificationQuerySchema = PageQuerySchema.extend({ unread: z.enum(['true', 'false']).optional() });
export const MarkReadSchema = z
  .object({ ids: z.array(IdSchema).max(100).optional(), all: z.literal(true).optional() })
  .strict()
  .refine((v) => v.all || (v.ids?.length ?? 0) > 0, 'Send ids or all: true');
export const MarkReadResultSchema = z.object({ updated: z.number().int() });

export const PushTokenSchema = z
  .object({
    token: z.string().trim().max(200),
    platform: z.enum(['IOS', 'ANDROID', 'WEB']),
  })
  .strict();
export const RemovePushTokenSchema = z.object({ token: z.string().trim().max(200) }).strict();

export const RealtimeTicketSchema = z.object({ ticket: z.string(), expiresAt: DateTimeSchema, url: z.string() });
