import { defineConfig } from 'vitest/config';

// Integration tests: run against the real PostgreSQL database named in DATABASE_URL_TEST.
export default defineConfig({
  test: {
    include: ['test/integration/**/*.test.ts'],
    globalSetup: ['test/integration/global-setup.ts'],
    setupFiles: ['test/integration/load-env.ts'],
    // Tests share one database; run files one at a time.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
