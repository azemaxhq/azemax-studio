import { defineConfig, devices } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Dedicated Playwright config for the AUTHENTICATION surface.
 *
 * This suite runs the app in its FAIL-CLOSED state: Firebase is intentionally
 * NOT configured on either side. That is the state every deployment must
 * handle safely, so the tests assert:
 *
 *   - the workspace is gated (no guest/anonymous entry exists);
 *   - the auth panes render and validate input client-side;
 *   - Google sign-in is hidden (no provider configured);
 *   - submitting credentials reports an honest "not configured" error instead
 *     of fabricating a session.
 *
 * An isolated backend (temp DB, dedicated ports) is used so a developer's own
 * stack is never touched. Live Firebase flows (real sign-in, Google OAuth,
 * verification-email delivery) cannot run without provider credentials and are
 * documented as manual checks in docs/AUTHENTICATION.md.
 *
 * Run with: npm run test:e2e:auth
 */
const DATA_DIR = path.join(os.tmpdir(), 'azemax-e2e-auth');
fs.rmSync(DATA_DIR, { recursive: true, force: true });
fs.mkdirSync(DATA_DIR, { recursive: true });

export default defineConfig({
    testDir: 'tests/e2e-auth',
    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 1 : 0,
    workers: 1,
    reporter: [['list']],
    timeout: 60_000,
    expect: { timeout: 10_000 },
    use: {
        baseURL: 'http://127.0.0.1:5178',
        trace: 'off',
        screenshot: 'only-on-failure',
    },
    webServer: [
        {
            // Dedicated port so a developer's own dev server on 3001 is never
            // disturbed. No Firebase Admin credentials on purpose (fail closed).
            command: 'node server/index.cjs',
            url: 'http://127.0.0.1:3101/api/health',
            reuseExistingServer: false,
            timeout: 30_000,
            env: {
                PORT: '3101',
                NODE_ENV: 'development',
                DATA_DIR,
                DATABASE_PATH: path.join(DATA_DIR, 'e2e.db'),
                CORS_ORIGIN: 'http://127.0.0.1:5178,http://localhost:5178',
                FIREBASE_PROJECT_ID: '',
                FIREBASE_CLIENT_EMAIL: '',
                FIREBASE_PRIVATE_KEY: '',
            },
        },
        {
            command: 'npx vite --port 5178 --host 127.0.0.1 --strictPort',
            url: 'http://127.0.0.1:5178',
            reuseExistingServer: false,
            timeout: 60_000,
            env: {
                VITE_API_URL: 'http://127.0.0.1:3101/api',
                VITE_WS_URL: 'ws://127.0.0.1:3101',
                // Force the unconfigured state regardless of a developer's .env.
                VITE_FIREBASE_API_KEY: '',
                VITE_FIREBASE_AUTH_DOMAIN: '',
                VITE_FIREBASE_PROJECT_ID: '',
                VITE_FIREBASE_APP_ID: '',
            },
        },
    ],
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],
});
