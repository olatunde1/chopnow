/**
 * Builds the four web apps for the e2e run, each pointed at the e2e API on its own port.
 * Vendor/admin: vite build. Customer/rider: Expo web export (the same JS the phones run, on react-native-web).
 * Pass app names to rebuild only some: node build-apps.mjs customer rider
 */
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { url } from './ports.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const out = (name) => fileURLToPath(new URL(`./.build/${name}`, import.meta.url));
const apps = {
  vendor: { dir: 'apps/vendor-web', cmd: `npx vite build --outDir "${out('vendor')}" --emptyOutDir`, env: { VITE_API_BASE_URL: url('api') } },
  admin: { dir: 'apps/admin-web', cmd: `npx vite build --outDir "${out('admin')}" --emptyOutDir`, env: { VITE_API_BASE_URL: url('api') } },
  customer: { dir: 'apps/customer-mobile', cmd: `npx expo export --platform web --clear --output-dir "${out('customer')}"`, env: { EXPO_PUBLIC_API_BASE_URL: url('api') } },
  rider: { dir: 'apps/rider-mobile', cmd: `npx expo export --platform web --clear --output-dir "${out('rider')}"`, env: { EXPO_PUBLIC_API_BASE_URL: url('api') } },
};
const wanted = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(apps);
for (const name of wanted) {
  const a = apps[name];
  if (!a) throw new Error(`unknown app ${name}`);
  console.log(`\n▶ building ${name}`);
  execSync(a.cmd, { cwd: `${root}/${a.dir}`, env: { ...process.env, ...a.env, CI: '1' }, stdio: ['ignore', 'inherit', 'inherit'] });
}
