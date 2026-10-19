import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { Prisma } from '../src/generated/prisma/client.js';
import { errorHandler } from '../src/http/middleware.js';

/** An app whose only route throws `err`, so we see exactly what the error handler sends. */
function throwing(err: unknown) {
  const app = express();
  app.get('/boom', () => {
    throw err;
  });
  app.use(errorHandler);
  return app;
}
const prismaError = (code: string) => new Prisma.PrismaClientKnownRequestError('internal detail', { code, clientVersion: 'test' });

describe('error handler', () => {
  it('turns "no database connection in time" (P2028) into a retryable 503, not a 500', async () => {
    const res = await request(throwing(prismaError('P2028'))).get('/boom');
    expect(res.status).toBe(503);
    expect(res.headers['retry-after']).toBe('2');
    expect(res.body).toEqual({ error: { code: 'SERVER_BUSY', message: expect.stringMatching(/try again/) } });
    expect(JSON.stringify(res.body)).not.toContain('internal detail');
  });

  it('keeps unique-violation and not-found mappings', async () => {
    expect((await request(throwing(prismaError('P2002'))).get('/boom')).status).toBe(409);
    expect((await request(throwing(prismaError('P2025'))).get('/boom')).status).toBe(404);
  });

  it('hides unexpected errors behind a generic 500', async () => {
    const res = await request(throwing(new Error('secret stack detail'))).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(res.body)).not.toContain('secret');
  });
});
