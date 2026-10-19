import type { IncomingMessage, Server } from 'node:http';
import type { Logger } from 'pino';
import { WebSocketServer, type WebSocket } from 'ws';
import type { Db } from '../../db/client.js';
import type { Connection, RealtimeHub } from './hub.js';
import { verifyTicket } from './ticket.js';

export const REALTIME_PATH = '/v1/realtime';
const PING_MS = 25_000;
const REVALIDATE_MS = 5 * 60_000;

/**
 * WebSocket endpoint at /v1/realtime?ticket=… . Server → client only (clients refetch over REST).
 * The ticket is checked, then the user is re-read from the database (active, same token version,
 * no pending password change); browsers must come from an allowed origin. Every 5 minutes each
 * connection is re-validated so suspensions close sockets; dead connections are dropped by ping.
 */
export function attachRealtime(server: Server, deps: { db: Db; hub: RealtimeHub; secret: string; allowedOrigins: string[]; now?: () => Date; logger?: Logger }) {
  const now = deps.now ?? (() => new Date());
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 });

  const reject = (socket: { write(s: string): void; destroy(): void }, code: number, text: string) => {
    socket.write(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\n\r\n`);
    socket.destroy();
  };

  server.on('upgrade', async (req: IncomingMessage, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== REALTIME_PATH) return reject(socket, 404, 'Not Found');
    const origin = req.headers.origin;
    if (origin && !deps.allowedOrigins.includes(origin)) return reject(socket, 403, 'Forbidden');
    const claims = verifyTicket(deps.secret, url.searchParams.get('ticket') ?? '', now());
    if (!claims) return reject(socket, 401, 'Unauthorized');
    const user = await deps.db.user.findUnique({ where: { id: claims.userId }, select: { id: true, role: true, status: true, tokenVersion: true, mustChangePassword: true } }).catch(() => null);
    if (!user || user.status !== 'ACTIVE' || user.tokenVersion !== claims.tokenVersion || user.mustChangePassword) return reject(socket, 401, 'Unauthorized');

    wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
      const conn: Connection = { userId: user.id, role: user.role, send: (d) => ws.readyState === ws.OPEN && ws.send(d) };
      deps.hub.add(conn);
      let alive = true;
      ws.on('pong', () => {
        alive = true;
      });
      ws.on('message', () => {
        // Clients don't send commands; ignore anything else (pings are handled by the protocol).
      });
      const ping = setInterval(() => {
        if (!alive) return ws.terminate();
        alive = false;
        ws.ping();
      }, PING_MS);
      const revalidate = setInterval(async () => {
        const u = await deps.db.user.findUnique({ where: { id: user.id }, select: { status: true, tokenVersion: true } }).catch(() => null);
        if (!u || u.status !== 'ACTIVE' || u.tokenVersion !== user.tokenVersion) ws.close(4001, 'session ended');
      }, REVALIDATE_MS);
      ws.on('close', () => {
        clearInterval(ping);
        clearInterval(revalidate);
        deps.hub.remove(conn);
      });
      ws.send(JSON.stringify({ type: 'hello' }));
    });
  });

  return {
    close: () =>
      new Promise<void>((resolve) => {
        for (const c of wss.clients) c.close(1001, 'server shutting down');
        wss.close(() => resolve());
      }),
  };
}
