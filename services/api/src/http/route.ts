import type { NextFunction, Request, RequestHandler, Response, Router } from 'express';
import { z } from 'zod';
import { hasPermission, type Permission } from '@chopnow/shared-schemas';
import { Errors } from '../lib/errors.js';
import type { RequestContext } from '../modules/audit/audit.js';
import type { Principal } from '../modules/auth/auth.service.js';

/**
 * Who may call a route:
 * - 'public'        anyone (principal is null)
 * - 'optional'      anyone; principal is set when a valid token is sent (e.g. to mark favourites)
 * - 'authenticated' any signed-in user
 * - a Permission    signed-in user whose CURRENT role (from the database) grants it
 * Ownership of the specific record is always checked again in the service layer.
 */
export type Access = 'public' | 'optional' | 'authenticated' | Permission;

export interface HandlerContext<B, Q, P> {
  body: B;
  query: Q;
  params: P;
  principal: Principal | null;
  /** The signed-in caller; throws 401 if there is none. */
  me(): Principal;
  requestContext: RequestContext;
  req: Request;
  res: Response;
}

export interface RouteSpec<B = unknown, Q = unknown, P = unknown> {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  /** Express path, e.g. /v1/restaurants/:slug */
  path: string;
  summary: string;
  tag: string;
  access: Access;
  body?: z.ZodType<B>;
  query?: z.ZodType<Q>;
  params?: z.ZodType<P>;
  /** Output is parsed through this schema: unknown fields are stripped, so internal columns never leak. */
  response: z.ZodType;
  status?: number;
  /** Extra middleware such as a stricter rate limiter. */
  middleware?: RequestHandler[];
  handler: (ctx: HandlerContext<B, Q, P>) => Promise<unknown>;
}

export function defineRoute<B = undefined, Q = undefined, P = undefined>(spec: RouteSpec<B, Q, P>): RouteSpec {
  return spec as unknown as RouteSpec;
}

declare module 'express-serve-static-core' {
  interface Request {
    principal?: Principal | null;
    /** Exact request bytes, kept for webhook signature verification. */
    rawBody?: Buffer;
  }
}

function parsePart<T>(schema: z.ZodType<T> | undefined, value: unknown, where: string): T {
  if (!schema) return undefined as T;
  const r = schema.safeParse(value ?? {});
  if (!r.success) {
    throw Errors.validation(r.error.issues.map((i) => ({ in: where, path: i.path.join('.'), message: i.message })));
  }
  return r.data;
}

function checkAccess(access: Access, principal: Principal | null | undefined): void {
  if (access === 'public' || access === 'optional') return;
  if (!principal) throw Errors.unauthenticated();
  if (access === 'authenticated') return;
  if (!hasPermission(principal.role, access)) throw Errors.forbidden();
}

export function mountRoutes(router: Router, routes: readonly RouteSpec[]): void {
  for (const spec of routes) {
    const handler = async (req: Request, res: Response, _next: NextFunction) => {
      const principal = req.principal ?? null;
      checkAccess(spec.access, principal);
      const ctx: HandlerContext<unknown, unknown, unknown> = {
        params: parsePart(spec.params, req.params, 'params'),
        query: parsePart(spec.query, req.query, 'query'),
        body: parsePart(spec.body, req.body, 'body'),
        principal,
        me: () => {
          if (!principal) throw Errors.unauthenticated();
          return principal;
        },
        requestContext: { ipAddress: req.ip, userAgent: req.get('user-agent'), requestId: String(req.id ?? '') },
        req,
        res,
      };
      const result = await spec.handler(ctx);
      // JSON round-trip turns Dates into ISO strings before the response schema strips unknown fields.
      const output = spec.response.parse(JSON.parse(JSON.stringify(result ?? null)));
      res.status(spec.status ?? 200).json(output);
    };
    router[spec.method](spec.path, ...(spec.middleware ?? []), handler);
  }
}

// ───────── OpenAPI 3.1 ─────────

const toSchema = (s: z.ZodType, io: 'input' | 'output') =>
  z.toJSONSchema(s, { io, unrepresentable: 'any', target: 'draft-2020-12' }) as Record<string, unknown>;

function parameters(schema: z.ZodType | undefined, location: 'query' | 'path') {
  if (!schema) return [];
  const json = toSchema(schema, 'input') as { properties?: Record<string, unknown>; required?: string[] };
  return Object.entries(json.properties ?? {}).map(([name, s]) => ({
    name,
    in: location,
    required: location === 'path' || (json.required ?? []).includes(name),
    schema: s,
  }));
}

export function buildOpenApi(routes: readonly RouteSpec[], info: { version: string }) {
  const paths: Record<string, Record<string, unknown>> = {};
  const errorResponse = { $ref: '#/components/schemas/Error' };
  for (const r of routes) {
    const path = r.path.replace(/:(\w+)/g, '{$1}');
    const secured = r.access !== 'public';
    paths[path] ??= {};
    paths[path][r.method] = {
      summary: r.summary,
      tags: [r.tag],
      ...(secured ? { security: r.access === 'optional' ? [{}, { bearerAuth: [] }] : [{ bearerAuth: [] }] } : {}),
      ...(r.access !== 'public' && r.access !== 'optional' && r.access !== 'authenticated'
        ? { 'x-required-permission': r.access }
        : {}),
      parameters: [...parameters(r.params, 'path'), ...parameters(r.query, 'query')],
      ...(r.body ? { requestBody: { required: true, content: { 'application/json': { schema: toSchema(r.body, 'input') } } } } : {}),
      responses: {
        [String(r.status ?? 200)]: { description: 'Success', content: { 'application/json': { schema: toSchema(r.response, 'output') } } },
        400: { description: 'Validation failed', content: { 'application/json': { schema: errorResponse } } },
        ...(secured && r.access !== 'optional' ? { 401: { description: 'Not signed in', content: { 'application/json': { schema: errorResponse } } } } : {}),
        ...(secured && r.access !== 'optional' && r.access !== 'authenticated'
          ? { 403: { description: 'Missing permission', content: { 'application/json': { schema: errorResponse } } } }
          : {}),
      },
    };
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'ChopNow API',
      version: info.version,
      description: 'Amounts are integer kobo (NGN minor units). Errors use { error: { code, message, details? } }.',
    },
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      schemas: {
        Error: {
          type: 'object',
          required: ['error'],
          properties: {
            error: {
              type: 'object',
              required: ['code', 'message'],
              properties: { code: { type: 'string' }, message: { type: 'string' }, details: {} },
            },
          },
        },
      },
    },
    paths,
  };
}
