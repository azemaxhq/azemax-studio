import { test, expect } from '@playwright/test';

/**
 * Authentication surface E2E (hard login wall, local password provider).
 *
 * Exercises the real backend: real account creation, real sessions, real
 * cookies. Firebase-backed flows (Google OAuth, verification email delivery)
 * require live provider credentials and are covered manually — see
 * docs/AUTHENTICATION.md.
 */

let sharedEmail = '';

function uniqueEmail(): string {
    return `e2e.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@example.com`;
}

const PASSWORD = 'CorrectHorseBattery9!';

test.describe('Auth — unauthenticated hard wall', () => {
    test('visiting the workspace without a session shows the sign-in pane', async ({ page }) => {
        await page.goto('/app');
        await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
        // The login pane is the ONLY guest affordance (no competing links).
        await expect(page.getByRole('button', { name: 'Continue as guest' })).toHaveCount(1);
    });

    test('empty submit surfaces an inline error and focuses the field', async ({ page }) => {
        await page.goto('/login');
        await page.getByRole('button', { name: 'Sign in' }).click();
        await expect(page.getByText('Enter your email address.')).toBeVisible();
        await expect(page.locator('#login-email')).toBeFocused();
    });

    test('invalid email is rejected before any request', async ({ page }) => {
        await page.goto('/login');
        await page.fill('#login-email', 'not-an-email');
        await page.fill('#login-password', 'whatever1234');
        await page.getByRole('button', { name: 'Sign in' }).click();
        await expect(page.getByText('Enter a valid email address.')).toBeVisible();
    });

    test('no Google button is rendered when Firebase is not configured', async ({ page }) => {
        await page.goto('/login');
        await expect(page.getByRole('button', { name: /google/i })).toHaveCount(0);
    });
});

test.describe.serial('Auth — sign-up and sign-in lifecycle', () => {
    test('sign-up validates the password confirmation', async ({ page }) => {
        await page.goto('/signup');
        await page.fill('#signup-email', uniqueEmail());
        await page.fill('#signup-password', PASSWORD);
        await page.fill('#signup-confirm-password', 'SomethingElse123!');
        await page.check('#terms-checkbox');
        await page.getByRole('button', { name: 'Create account' }).click();
        await expect(page.getByText('Passwords do not match.')).toBeVisible();
    });

    test('sign-up requires accepting the terms', async ({ page }) => {
        await page.goto('/signup');
        await page.fill('#signup-email', uniqueEmail());
        await page.fill('#signup-password', PASSWORD);
        await page.fill('#signup-confirm-password', PASSWORD);
        await page.getByRole('button', { name: 'Create account' }).click();
        await expect(page.getByText(/Accept the Terms of Service/)).toBeVisible();
    });

    test('sign-up creates a real account and enters the workspace', async ({ page }) => {
        sharedEmail = uniqueEmail();
        await page.goto('/signup');
        await page.fill('#signup-name', 'E2E Tester');
        await page.fill('#signup-email', sharedEmail);
        await page.fill('#signup-password', PASSWORD);
        await page.fill('#signup-confirm-password', PASSWORD);
        await page.check('#terms-checkbox');
        await page.getByRole('button', { name: 'Create account' }).click();
        await expect(page).toHaveURL(/\/app/, { timeout: 25_000 });
    });

    test('session persists across a reload', async ({ page }) => {
        // Sign in fresh, then reload: the cookie session must survive.
        await page.goto('/login');
        await page.fill('#login-email', sharedEmail);
        await page.fill('#login-password', PASSWORD);
        await page.getByRole('button', { name: 'Sign in' }).click();
        await expect(page).toHaveURL(/\/app/, { timeout: 25_000 });

        await page.reload();
        await expect(page.getByRole('heading', { name: 'Welcome back' })).toHaveCount(0);
    });

    test('duplicate email is rejected with an actionable message', async ({ page }) => {
        await page.goto('/signup');
        await page.fill('#signup-email', sharedEmail);
        await page.fill('#signup-password', PASSWORD);
        await page.fill('#signup-confirm-password', PASSWORD);
        await page.check('#terms-checkbox');
        await page.getByRole('button', { name: 'Create account' }).click();
        await expect(page.getByText(/already exists/i)).toBeVisible();
    });

    test('wrong password is rejected without enumerating the account', async ({ page }) => {
        await page.goto('/login');
        await page.fill('#login-email', sharedEmail);
        await page.fill('#login-password', 'definitely-the-wrong-one');
        await page.getByRole('button', { name: 'Sign in' }).click();
        await expect(page.getByText(/Invalid email or password/i)).toBeVisible();
    });

    test('Enter submits the login form', async ({ page }) => {
        await page.goto('/login');
        await page.fill('#login-email', sharedEmail);
        await page.fill('#login-password', PASSWORD);
        await page.locator('#login-password').press('Enter');
        await expect(page).toHaveURL(/\/app/, { timeout: 25_000 });
    });
});

test.describe('Auth — password recovery', () => {
    test('reports honestly when email reset is unavailable (no provider configured)', async ({ page }) => {
        await page.goto('/forgot-password');
        await page.fill('#reset-email', 'someone@example.com');
        await page.getByRole('button', { name: /Send password reset link/i }).click();
        await expect(page.getByText(/Password reset is unavailable/i)).toBeVisible();
    });

    test('rejects a malformed email before submitting', async ({ page }) => {
        await page.goto('/forgot-password');
        await page.fill('#reset-email', 'nope');
        await page.getByRole('button', { name: /Send password reset link/i }).click();
        await expect(page.getByText('Enter a valid email address.')).toBeVisible();
    });
});

test.describe('Auth — responsive composition', () => {
    test('desktop (1440×900): brand panel and editor preview are present', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto('/login');
        await expect(page.locator('aside')).toBeVisible();
        await expect(page.locator('aside').getByText('Build beyond limits.').first()).toBeVisible();
        await expect(page.getByText('workspace.ts')).toBeVisible();
        // No fabricated runtime status on the preview.
        await expect(page.getByText(/Production Environment/i)).toHaveCount(0);
    });

    test('mobile (390×844): single column, no horizontal scroll, action visible', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto('/login');
        await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
        await expect(page.locator('aside')).toBeHidden();

        const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth - window.innerWidth,
        );
        expect(overflow).toBeLessThanOrEqual(1);

        await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
    });

    test('tablet (768×1024): form stays on one column without horizontal scroll', async ({ page }) => {
        await page.setViewportSize({ width: 768, height: 1024 });
        await page.goto('/signup');
        await expect(page.getByRole('heading', { name: 'Create your Azemax account' })).toBeVisible();
        const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth - window.innerWidth,
        );
        expect(overflow).toBeLessThanOrEqual(1);
    });
});
