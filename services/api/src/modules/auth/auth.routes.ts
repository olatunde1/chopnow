import type { CookieOptions, Request, RequestHandler, Response } from 'express';
import { z } from 'zod';
import {
  AuthResponseSchema,
  ChangePasswordRequestSchema,
  LoginRequestSchema,
  OkResponseSchema,
  RegisterRequestSchema,
} from '@chopnow/shared-schemas';
import { defineRoute } from '../../http/route.js';
import { Errors } from '../../lib/errors.js';
import type { AuthResult, AuthService } from './auth.service.js';

/**
 * Two session styles:
 * - Mobile apps: the refresh token is returned in the body and kept in the OS keychain.
 * - Web portals: send `X-ChopNow-Client: web`. The refresh token is set as an httpOnly,
 *   SameSite=Strict cookie scoped to /v1/auth and is NOT returned in the body, so page scripts
 *   (and any XSS) can never read it. The custom header also forces a CORS preflight, so other
 *   sites cannot trigger refresh/logout with the cookie.
 */
export const REFRESH_COOKIE = 'chopnow_rt';
const isWeb = (req: Request) => req.get('X-ChopNow-Client') === 'web';

const RefreshBodySchema = z.object({ refreshToken: z.string().min(20).max(200).optional() }).strict();

export function authRoutes(auth: AuthService, authLimiter: RequestHandler, opts: { secureCookies: boolean; refreshTokenTtlDays: number }) {
  const cookieOptions: CookieOptions = {
    httpOnly: true,
    sameSite: 'strict',
    secure: opts.secureCookies,
    path: '/v1/auth',
    maxAge: opts.refreshTokenTtlDays * 86_400_000,
  };

  /** For web clients, move the refresh token from the body into the cookie. */
  const deliver = (req: Request, res: Response, result: AuthResult): AuthResult => {
    if (!isWeb(req)) return result;
    res.cookie(REFRESH_COOKIE, result.refreshToken, cookieOptions);
    return { ...result, refreshToken: '' };
  };
  const clearCookie = (res: Response) => res.clearCookie(REFRESH_COOKIE, { ...cookieOptions, maxAge: undefined });
  const refreshTokenFrom = (req: Request, body: { refreshToken?: string }) => body.refreshToken ?? (isWeb(req) ? (req.cookies?.[REFRESH_COOKIE] as string | undefined) : undefined);

  return [
    defineRoute({
      method: 'post',
      path: '/v1/auth/register',
      summary: 'Create a customer, vendor or rider account',
      tag: 'Auth',
      access: 'public',
      body: RegisterRequestSchema,
      response: AuthResponseSchema,
      status: 201,
      middleware: [authLimiter],
      handler: async ({ req, res, requestContext }) => deliver(req, res, await auth.register(req.body, requestContext)),
    }),
    defineRoute({
      method: 'post',
      path: '/v1/auth/login',
      summary: 'Sign in with email and password',
      tag: 'Auth',
      access: 'public',
      body: LoginRequestSchema,
      response: AuthResponseSchema,
      middleware: [authLimiter],
      handler: async ({ req, res, requestContext }) => deliver(req, res, await auth.login(req.body, requestContext)),
    }),
    defineRoute({
      method: 'post',
      path: '/v1/auth/refresh',
      summary: 'Exchange a refresh token (body, or the web cookie) for a new token pair (rotation)',
      tag: 'Auth',
      access: 'public',
      body: RefreshBodySchema,
      response: AuthResponseSchema,
      middleware: [authLimiter],
      handler: async ({ req, res, body, requestContext }) => {
        const refreshToken = refreshTokenFrom(req, body);
        if (!refreshToken) throw Errors.unauthenticated();
        try {
          return deliver(req, res, await auth.refresh({ refreshToken }, requestContext));
        } catch (err) {
          if (isWeb(req)) clearCookie(res);
          throw err;
        }
      },
    }),
    defineRoute({
      method: 'post',
      path: '/v1/auth/logout',
      summary: 'Sign out this device (revokes the refresh token)',
      tag: 'Auth',
      access: 'public',
      body: RefreshBodySchema,
      response: OkResponseSchema,
      handler: async ({ req, res, body }) => {
        const refreshToken = refreshTokenFrom(req, body);
        if (refreshToken) await auth.logout({ refreshToken });
        if (isWeb(req)) clearCookie(res);
        return { ok: true };
      },
    }),
    defineRoute({
      method: 'post',
      path: '/v1/auth/logout-all',
      summary: 'Sign out of every device',
      tag: 'Auth',
      access: 'authenticated',
      response: OkResponseSchema,
      handler: async ({ me, req, res, requestContext }) => {
        const p = me();
        await auth.logoutAll(p.userId, p, requestContext);
        if (isWeb(req)) clearCookie(res);
        return { ok: true };
      },
    }),
    defineRoute({
      method: 'post',
      path: '/v1/me/password',
      summary: 'Change password (signs out other devices)',
      tag: 'Account',
      access: 'authenticated',
      body: ChangePasswordRequestSchema,
      response: AuthResponseSchema,
      middleware: [authLimiter],
      handler: async ({ me, req, res, requestContext }) => deliver(req, res, await auth.changePassword(me(), req.body, requestContext)),
    }),
  ];
}
