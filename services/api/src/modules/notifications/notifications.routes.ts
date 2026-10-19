import type { RequestHandler } from 'express';
import {
  MarkReadResultSchema,
  MarkReadSchema,
  NotificationListSchema,
  NotificationQuerySchema,
  OkResponseSchema,
  PushTokenSchema,
  RealtimeTicketSchema,
  RemovePushTokenSchema,
} from '@chopnow/shared-schemas';
import type { Db } from '../../db/client.js';
import { defineRoute } from '../../http/route.js';
import { REALTIME_PATH } from '../realtime/server.js';
import { signTicket } from '../realtime/ticket.js';
import type { NotificationsService } from './notifications.service.js';

export function notificationRoutes(deps: { notifications: NotificationsService; ticketLimiter?: RequestHandler; db: Db; ticketSecret: string; publicApiUrl: string; now: () => Date }) {
  const { notifications } = deps;
  const tag = 'Notifications';
  const wsUrl = `${deps.publicApiUrl.replace(/^http/, 'ws').replace(/\/+$/, '')}${REALTIME_PATH}`;
  return [
    defineRoute({
      method: 'get', path: '/v1/me/notifications', summary: 'My notifications, newest first, with the unread count', tag, access: 'authenticated',
      query: NotificationQuerySchema, response: NotificationListSchema,
      handler: ({ me, query }) => notifications.list(me(), query.page, query.pageSize, query.unread === 'true'),
    }),
    defineRoute({
      method: 'post', path: '/v1/me/notifications/read', summary: 'Mark some (ids) or all of my notifications as read', tag, access: 'authenticated',
      body: MarkReadSchema, response: MarkReadResultSchema,
      handler: ({ me, body }) => notifications.markRead(me(), body),
    }),
    defineRoute({
      method: 'put', path: '/v1/me/push-tokens', summary: 'Register this device’s Expo push token (moves to me if another account used it)', tag, access: 'authenticated',
      body: PushTokenSchema, response: OkResponseSchema,
      handler: ({ me, body }) => notifications.registerToken(me(), body.token, body.platform),
    }),
    defineRoute({
      method: 'post', path: '/v1/me/push-tokens/remove', summary: 'Stop push notifications to this device (e.g. on sign-out)', tag, access: 'authenticated',
      body: RemovePushTokenSchema, response: OkResponseSchema,
      handler: ({ me, body }) => notifications.removeToken(me(), body.token),
    }),
    defineRoute({
      method: 'post', path: '/v1/realtime/ticket', summary: 'A 30-second ticket for opening the realtime WebSocket', tag: 'Realtime', access: 'authenticated',
      response: RealtimeTicketSchema, middleware: deps.ticketLimiter ? [deps.ticketLimiter] : [],
      handler: async ({ me }) => {
        const user = await deps.db.user.findUniqueOrThrow({ where: { id: me().userId }, select: { id: true, tokenVersion: true } });
        const { ticket, expiresAt } = signTicket(deps.ticketSecret, { userId: user.id, tokenVersion: user.tokenVersion }, deps.now());
        return { ticket, expiresAt, url: wsUrl };
      },
    }),
  ];
}
