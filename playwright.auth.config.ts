import { defineConfig, devices } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Dedicated Playwright config for the AUTHENTICATION surface.
 *
 * The default `playwright.config.ts` runs the app in public-beta mode with the
 * server-side auth bypass (DISABLE_AUTH=true), which makes the sign-in panes
 * unreachable. This config instead boots an isolated stack:
 *
 *   - backend: DISABLE_AUTH=false, PUBLIC_BETA=false (hard login wall),
 *     ALLOW_SIGNUP=true, against a throwaway temp database — never the dev DB;
 *   - frontend: VITE_PUBLIC_BETA=false, so the workspace is gated and the
 *     /login, /signup, /forgot-password panes render.
 *
 * Firebase is intentionally NOT configured here, so these tests exercise the
 * real local password provider end to end (real accounts, real sessions,
 * cookies) — the same code path the app falls back to when Firebase keys are
 * absent. Provider-specific flows (Google, verification email delivery) cannot
 * be automated without live Firebase credentials and are documented as manual.
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
            // A dedicated port so a developer's own dev server on 3001 is never
            // disturbed (and never reused — it runs in bypass mode).
            command: 'node server/index.cjs',
            url: 'http://127.0.0.1:3101/api/health',
            reuseExistingServer: false,
            timeout: 30_000,
            env: {
                PORT: '3101',
                NODE_ENV: 'development',
                DISABLE_AUTH: 'false',
                PUBLIC_BETA: 'false',
                ALLOW_SIGNUP: 'true',
                AUTH_SECRET: 'e2e-auth-secret-0123456789abcdef0123456789',
                DATA_DIR,
                DATABASE_PATH: path.join(DATA_DIR, 'e2e.db'),
                CORS_ORIGIN: 'http://127.0.0.1:5178,http://localhost:5178',
            },
        },
        {
            command: 'npx vite --port 5178 --host 127.0.0.1 --strictPort',
            url: 'http://127.0.0.1:5178',
            reuseExistingServer: false,
            timeout: 60_000,
            env: {
                VITE_PUBLIC_BETA: 'false',
                VITE_API_URL: 'http://127.0.0.1:3101/api',
                VITE_WS_URL: 'ws://127.0.0.1:3101',
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
