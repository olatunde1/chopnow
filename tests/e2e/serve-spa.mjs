/**
 * Tiny static server for a built single-page app: unknown paths fall back to index.html.
 * The vendor and admin portals get the exact Content-Security-Policy production nginx sends
 * (read from deploy/nginx-spa.conf, pointed at the e2e API), so the journey proves the policy
 * doesn't break them. The customer and rider builds ship as native apps, not websites.
 */
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { url } from './ports.mjs';

const [name, port] = process.argv.slice(2);
const dir = fileURLToPath(new URL(`./.build/${name}`, import.meta.url));
if (!existsSync(join(dir, 'index.html'))) {
  console.error(`No build at ${dir}. Run: npm run build -w @chopnow/e2e`);
  process.exit(1);
}
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.map': 'application/json' };

function productionCsp() {
  const conf = readFileSync(new URL('../../deploy/nginx-spa.conf', import.meta.url), 'utf8');
  const policy = /location \/ \{[\s\S]*?Content-Security-Policy "([^"]+)"/.exec(conf)?.[1];
  if (!policy) throw new Error('CSP not found in deploy/nginx-spa.conf');
  return policy.replaceAll('__API_ORIGIN__', url('api')).replaceAll('__WS_ORIGIN__', url('api').replace(/^http/, 'ws'));
}
const csp = name === 'vendor' || name === 'admin' ? productionCsp() : null;

createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^[/\\]+/, '');
  let file = join(dir, path);
  if (!file.startsWith(dir) || !existsSync(file) || statSync(file).isDirectory()) file = join(dir, 'index.html');
  const type = TYPES[extname(file)] ?? 'application/octet-stream';
  res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store', ...(csp && type === 'text/html' ? { 'content-security-policy': csp } : {}) });
  createReadStream(file).pipe(res);
}).listen(Number(port), () => console.log(`${name} on http://localhost:${port}${csp ? ' (production CSP)' : ''}`));
