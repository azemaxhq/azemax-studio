import { test, expect } from '@playwright/test';

test.describe('Azemax Landing Page E2E', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', msg => console.log('PAGE LOG:', msg.type(), msg.text()));
    page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
  });

  test('landing page loads, renders hero, and preserves dark planetary aesthetic', async ({ page }) => {
    await page.goto('/');

    // Page title and meta tags
    await expect(page).toHaveTitle(/Azemax — Build beyond limits/i);

    // Hero campaign headline
    const heroHeading = page.locator('h1');
    await expect(heroHeading).toContainText('Build');
    await expect(heroHeading).toContainText('beyond limits.');

    // Planet canvas presence
    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();

    // Eyebrow and badges
    await expect(page.locator('text=BEYOND THE EDITOR').first()).toBeVisible();
    await expect(page.locator('.az-hero-metadata')).toContainText('WRITE');
    await expect(page.locator('.az-hero-metadata')).toContainText('RUN');
    await expect(page.locator('.az-hero-metadata')).toContainText('UNDERSTAND');
    await expect(page.locator('.az-hero-metadata')).toContainText('IMPROVE');

    // Code panel removed from hero — assert it stays gone
    await expect(page.locator('.az-laptop-chassis')).toHaveCount(0);
  });

  test('interactive workspace modes switch seamlessly', async ({ page }) => {
    await page.goto('/');

    // Scroll to modes section
    await page.locator('#modes').scrollIntoViewIfNeeded();

    // Verify default Write tab
    const writeTab = page.locator('#tab-write');
    await expect(writeTab).toHaveAttribute('aria-selected', 'true');

    // Switch to Run tab
    const runTab = page.locator('#tab-run');
    await runTab.dispatchEvent('click');
    await expect(runTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('text=xterm.js PTY session')).toBeVisible();

    // Trigger execution simulation
    const executeBtn = page.locator('button:has-text("Execute Script")');
    await executeBtn.dispatchEvent('click');
    // Wait for execution logs to appear in terminal
    await expect(page.locator('text=Execution completed with exit code 0').or(page.locator('text=Running matrix benchmarks...'))).toBeVisible();

    // Switch to Understand tab
    const understandTab = page.locator('#tab-understand');
    await understandTab.dispatchEvent('click');
    await expect(understandTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('text=Azemax Explanation')).toBeVisible();

    // Switch to Improve tab
    const improveTab = page.locator('#tab-improve');
    await improveTab.dispatchEvent('click');
    await expect(improveTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('text=Refactor Report:')).toBeVisible();
  });

  test('primary CTA enters workspace at /app cleanly without breaking IDE', async ({ page }) => {
    await page.goto('/');

    const enterBtn = page.locator('#hero-primary-cta');
    await enterBtn.dispatchEvent('click');

    // URL changes to /app
    await expect(page).toHaveURL(/\/app/);

    // IDE should render successfully
    await expect(page.locator('body')).not.toContainText('Application Error');
  });

  test('responsive mobile layout at 390x844 without horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');

    // Check no horizontal scrolling
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);

    // Hero title is visible
    const heroHeading = page.locator('h1');
    await expect(heroHeading).toBeVisible();

    // Mobile menu toggle is available
    const menuButton = page.locator('button[aria-label="Open Menu"]');
    await expect(menuButton).toBeVisible();
  });
});
