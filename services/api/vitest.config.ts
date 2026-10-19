import { defineConfig } from 'vitest/config';

// Unit tests: no database required.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['test/integration/**', 'node_modules/**'],
  },
});
