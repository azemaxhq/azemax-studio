import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Unit/integration tests only. Playwright E2E lives in tests/e2e and is
    // run via `npm run test:e2e` (it must never be picked up by vitest).
    include: ['tests/*.test.ts'],
    exclude: [
      'tests/e2e/**',
      'tests/_harness.ts',
      '**/node_modules/**',
    ],
    testTimeout: 30000,
    hookTimeout: 10000,
    // Fail loudly on leaked handles from server-style tests.
    teardownTimeout: 5000,
  },
});
