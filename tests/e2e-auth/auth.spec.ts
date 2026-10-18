import { test, expect } from '@playwright/test';

/**
 * Authentication surface E2E — FAIL-CLOSED behaviour.
 *
 * Firebase is not configured in this suite on purpose. The app must still gate
 * the workspace, validate input, and report honestly that sign-in is
 * unavailable — never fabricate a session or fall back to a guest identity.
 *
 * Live provider flows (real account creation, Google OAuth, verification email
 * delivery) require Firebase credentials and are documented as manual checks in
 * docs/AUTHENTICATION.md.
 */

const PASSWORD = 'CorrectHorseBattery9!';

test.describe('Auth — unauthenticated gate', () => {
    test('visiting the workspace without a session shows the sign-in pane', async ({ page }) => {
        await page.goto('/app');
        await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
    });

    test('there is no guest / anonymous affordance anywhere', async ({ page }) => {
        await page.goto('/app');
        await expect(page.getByRole('button', { name: /continue as guest/i })).toHaveCount(0);
        await expect(page.getByText(/continue as guest/i)).toHaveCount(0);
        await expect(page.getByText(/guest workspace/i)).toHaveCount(0);
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

    test('valid credentials fail closed with an honest configuration error', async ({ page }) => {
        await page.goto('/login');
        await page.fill('#login-email', 'someone@example.com');
        await page.fill('#login-password', PASSWORD);
        await page.getByRole('button', { name: 'Sign in' }).click();
        await expect(page.getByText(/Firebase Authentication is not configured/i)).toBeVisible();
        // Never enters the workspace without a verified provider identity.
        await expect(page).toHaveURL(/\/login/);
        await expect(page.getByTestId('editor-root')).toHaveCount(0);
    });

    test('Enter submits the login form and stays gated', async ({ page }) => {
        await page.goto('/login');
        await page.fill('#login-email', 'someone@example.com');
        await page.fill('#login-password', PASSWORD);
        await page.locator('#login-password').press('Enter');
        await expect(page.getByText(/Firebase Authentication is not configured/i)).toBeVisible();
        await expect(page).toHaveURL(/\/login/);
    });
});

test.describe('Auth — sign-up validation', () => {
    test('sign-up validates the password confirmation', async ({ page }) => {
        await page.goto('/signup');
        await page.fill('#signup-email', 'new.user@example.com');
        await page.fill('#signup-password', PASSWORD);
        await page.fill('#signup-confirm-password', 'SomethingElse123!');
        await page.check('#terms-checkbox');
        await page.getByRole('button', { name: 'Create account' }).click();
        await expect(page.getByText('Passwords do not match.')).toBeVisible();
    });

    test('sign-up requires accepting the terms', async ({ page }) => {
        await page.goto('/signup');
        await page.fill('#signup-email', 'new.user@example.com');
        await page.fill('#signup-password', PASSWORD);
        await page.fill('#signup-confirm-password', PASSWORD);
        await page.getByRole('button', { name: 'Create account' }).click();
        await expect(page.getByText(/Accept the Terms of Service/)).toBeVisible();
    });

    test('valid sign-up fails closed instead of fabricating an account', async ({ page }) => {
        await page.goto('/signup');
        await page.fill('#signup-name', 'E2E Tester');
        await page.fill('#signup-email', 'new.user@example.com');
        await page.fill('#signup-password', PASSWORD);
        await page.fill('#signup-confirm-password', PASSWORD);
        await page.check('#terms-checkbox');
        await page.getByRole('button', { name: 'Create account' }).click();
        await expect(page.getByText(/Firebase Authentication is not configured/i)).toBeVisible();
        await expect(page).toHaveURL(/\/signup/);
    });
});

test.describe('Auth — password recovery', () => {
    test('reports honestly when email reset is unavailable (no provider configured)', async ({ page }) => {
        await page.goto('/forgot-password');
        await page.fill('#reset-email', 'someone@example.com');
        await page.getByRole('button', { name: /Send password reset link/i }).click();
        await expect(page.getByText(/Firebase Authentication is not configured/i)).toBeVisible();
        // Must not claim the message was sent when it could not be.
        await expect(page.getByText(/Check your inbox/i)).toHaveCount(0);
    });

    test('rejects a malformed email before submitting', async ({ page }) => {
        await page.goto('/forgot-password');
        await page.fill('#reset-email', 'nope');
        await page.getByRole('button', { name: /Send password reset link/i }).click();
        await expect(page.getByText('Enter a valid email address.')).toBeVisible();
    });
});

test.describe('Auth — no session on the verification pane', () => {
    test('shows an honest ended-session state', async ({ page }) => {
        await page.goto('/verify-email');
        await expect(page.getByRole('heading', { name: 'Your session has ended' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Return to sign in' })).toBeVisible();
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
