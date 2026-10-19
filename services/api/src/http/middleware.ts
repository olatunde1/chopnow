import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { Prisma } from '../generated/prisma/client.js';
import { AppError, Errors } from '../lib/errors.js';
import type { AuthService } from '../modules/auth/auth.service.js';
import { reportError } from '../modules/monitoring/monitoring.js';

/**
 * Resolves `Authorization: Bearer <token>` to a principal. A missing token leaves the request
 * anonymous; an invalid or revoked token is rejected with 401 so clients know to refresh.
 */
const PASSWORD_CHANGE_ALLOWED: [string, string][] = [
  ['POST', '/v1/me/password'],
  ['GET', '/v1/me'],
];

export function authenticate(auth: AuthService): RequestHandler {
  return async (req, _res, next) => {
    const header = req.get('authorization');
    if (!header) {
      req.principal = null;
      return next();
    }
    const match = /^Bearer\s+([A-Za-z0-9._~+/=-]+)$/.exec(header);
    if (!match) return next(Errors.unauthenticated());
    const principal = await auth.authenticate(match[1]!);
    if (!principal) return next(Errors.unauthenticated());
    // A temporary password unlocks only the password change (and reading your own profile).
    if (principal.mustChangePassword && !PASSWORD_CHANGE_ALLOWED.some(([m, p]) => req.method === m && req.path === p) && !req.path.startsWith('/v1/auth/')) {
      return next(new AppError(403, 'PASSWORD_CHANGE_REQUIRED', 'Set a new password before continuing.'));
    }
    req.principal = principal;
    next();
  };
}

/**
 * Rate limiter that answers in the standard error shape. In-memory store: correct for one API instance.
 * `per: 'user'` counts per signed-in account (falling back to IP when anonymous): Nigerian mobile
 * networks put many customers behind one carrier IP, so per-IP limits on busy actions would block
 * real people. Route middleware runs after authentication, so req.principal is already set.
 */
export function limiter(opts: { windowMs: number; limit: number; name: string; per?: 'ip' | 'user' }): RequestHandler {
  return rateLimit({
    windowMs: opts.windowMs,
    limit: opts.limit,
    keyGenerator: (req) => (opts.per === 'user' && req.principal ? `u:${req.principal.userId}` : ipKeyGenerator(req.ip ?? '')),
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    identifier: opts.name,
    handler: (_req, res) => {
      res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests. Please wait a moment and try again.' } });
    },
  });
}

/**
 * Converts errors into safe JSON responses. Only AppError messages reach clients; anything
 * unexpected becomes a generic 500 and is logged with the request id.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  let appError: AppError | undefined;
  if (err instanceof AppError) appError = err;
  else if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    appError = Errors.conflict('CONFLICT', 'This conflicts with an existing record');
  } else if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
    appError = Errors.notFound();
  } else if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2028') {
    // No database connection came free in time: overload, not a bug in the request. Safe to retry
    // (writes are transactional and order/payment creation is idempotent).
    req.log?.warn({ err }, 'database busy');
    res.setHeader('Retry-After', '2');
    res.status(503).json({ error: { code: 'SERVER_BUSY', message: 'We’re very busy right now. Please try again in a moment.' } });
    return;
  } else if (err?.type === 'entity.parse.failed') {
    appError = new AppError(400, 'INVALID_JSON', 'The request body is not valid JSON');
  } else if (err?.type === 'entity.too.large') {
    appError = new AppError(413, 'PAYLOAD_TOO_LARGE', 'The request body is too large');
  } else if (err?.name === 'MulterError') {
    appError =
      err.code === 'LIMIT_FILE_SIZE'
        ? new AppError(413, 'FILE_TOO_LARGE', 'That file is too large.')
        : new AppError(400, 'INVALID_UPLOAD', 'Upload one file in the "file" field.');
  }

  if (appError) {
    if (appError.status >= 500) {
      req.log?.error({ err }, 'request failed');
      reportError(err, { requestId: String(req.id ?? ''), route: req.route?.path });
    }
    res.status(appError.status).json({
      error: { code: appError.code, message: appError.message, ...(appError.details !== undefined ? { details: appError.details } : {}) },
    });
    return;
  }

  req.log?.error({ err }, 'unhandled error');
  reportError(err, { requestId: String(req.id ?? ''), route: req.route?.path });
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' } });
};
