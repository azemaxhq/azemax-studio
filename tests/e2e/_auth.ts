import { test, type Page } from '@playwright/test';

/**
 * Shared authentication helper for the editor E2E specs.
 *
 * The workspace is gated by Firebase Authentication — there is deliberately NO
 * development auth bypass. Editor specs therefore require a REAL, already
 * verified Firebase test account plus Firebase client configuration:
 *
 *   E2E_USER_EMAIL, E2E_USER_PASSWORD
 *   VITE_FIREBASE_API_KEY, VITE_FIREBASE_PROJECT_ID (and friends)
 *   FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY (backend)
 *
 * When they are absent the specs SKIP (they are never silently passed, and no
 * bypass is introduced). See docs/AUTHENTICATION.md → "Authenticated E2E".
 */
export function hasE2ECredentials(): boolean {
    return Boolean(
        process.env.E2E_USER_EMAIL &&
        process.env.E2E_USER_PASSWORD &&
        process.env.VITE_FIREBASE_API_KEY &&
        process.env.VITE_FIREBASE_PROJECT_ID,
    );
}

export async function signInForE2E(page: Page): Promise<void> {
    if (!hasE2ECredentials()) {
        test.skip(
            true,
            'Authenticated editor E2E requires E2E_USER_EMAIL, E2E_USER_PASSWORD and Firebase configuration (no auth bypass exists).',
        );
        return;
    }

    await page.goto('/login');

    // Already signed in (shared context): the auth router has sent us onward.
    if (!page.url().includes('/login')) return;

    await page.fill('#login-email', process.env.E2E_USER_EMAIL as string);
    await page.fill('#login-password', process.env.E2E_USER_PASSWORD as string);
    await page.getByRole('button', { name: 'Sign in' }).click();

    await page.waitForFunction(
        () => location.pathname.startsWith('/app') || document.body.innerText.includes('Verify your email'),
        undefined,
        { timeout: 30_000 },
    );

    if (!page.url().includes('/app')) {
        test.skip(true, 'The E2E Firebase account is not email-verified; the workspace stays locked by design.');
    }
}
