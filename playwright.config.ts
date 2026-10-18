import { defineConfig, devices } from '@playwright/test';

/**
 * Editor / landing E2E.
 *
 * The workspace is gated by Firebase Authentication (no bypass). Authenticated
 * editor specs skip unless a REAL verified test account and Firebase config are
 * provided via the environment (see tests/e2e/_auth.ts and
 * docs/AUTHENTICATION.md → "Authenticated E2E"). Firebase values are forwarded
 * to both servers below so a configured developer machine can run them.
 */
const firebaseClientEnv = {
  VITE_FIREBASE_API_KEY: process.env.VITE_FIREBASE_API_KEY || '',
  VITE_FIREBASE_AUTH_DOMAIN: process.env.VITE_FIREBASE_AUTH_DOMAIN || '',
  VITE_FIREBASE_PROJECT_ID: process.env.VITE_FIREBASE_PROJECT_ID || '',
  VITE_FIREBASE_STORAGE_BUCKET: process.env.VITE_FIREBASE_STORAGE_BUCKET || '',
  VITE_FIREBASE_MESSAGING_SENDER_ID: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
  VITE_FIREBASE_APP_ID: process.env.VITE_FIREBASE_APP_ID || '',
};

const firebaseAdminEnv = {
  FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID || '',
  FIREBASE_CLIENT_EMAIL: process.env.FIREBASE_CLIENT_EMAIL || '',
  FIREBASE_PRIVATE_KEY: process.env.FIREBASE_PRIVATE_KEY || '',
};

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: 'http://127.0.0.1:5177',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'node server/index.cjs',
      url: 'http://127.0.0.1:3001/api/health',
      reuseExistingServer: true,
      timeout: 15_000,
      env: { PORT: '3001', ...firebaseAdminEnv },
    },
    {
      command: 'npx vite --port 5177 --host 127.0.0.1 --strictPort',
      url: 'http://127.0.0.1:5177',
      reuseExistingServer: true,
      timeout: 30_000,
      env: { ...firebaseClientEnv },
    },
  ],
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
