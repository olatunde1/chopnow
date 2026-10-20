// Metro watches the whole monorepo (Expo's default for workspaces). Keep it out of build output and
// test artifacts: thousands of generated files there made it re-hash and re-bundle constantly.
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
const root = path.resolve(__dirname, '../..');
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const SEP = String.raw`[\\/]`;
const ignored = [
  'tests/e2e/.build',
  'tests/e2e/test-results',
  'tests/e2e/playwright-report',
  'services/api/dist',
  'services/api/storage',
  'apps/vendor-web/dist',
  'apps/admin-web/dist',
  'apps/website/dist',
].map((dir) => new RegExp(`^${[...root.split(/[\\/]/), ...dir.split('/')].map(escape).join(SEP)}(${SEP}.*)?$`));

const existing = config.resolver.blockList;
config.resolver.blockList = [...(Array.isArray(existing) ? existing : existing ? [existing] : []), ...ignored];
module.exports = config;
