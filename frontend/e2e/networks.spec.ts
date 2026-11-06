import { test, expect, type Page } from '@playwright/test';

// The map renders only after hydration, so 51+ interactive state paths means
// the client is live and clicks will reach React handlers.
async function hydrated(page: Page) {
  await expect
    .poll(async () => page.locator('svg path[role="button"]').count(), { timeout: 60_000 })
    .toBeGreaterThanOrEqual(51);
}

test.describe('/networks', () => {
  test.setTimeout(90_000);

  test('loads with the default use case selected', async ({ page }) => {
    await page.goto('/networks');
    await expect(page.getByRole('heading', { level: 1, name: 'Health data networks' })).toBeVisible();
    await expect(page.getByRole('button', { name: "Get a patient's records for treatment" })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('a chip click changes the URL', async ({ page }) => {
    await page.goto('/networks');
    await hydrated(page);
    await page.getByRole('button', { name: 'Report to public health' }).click();
    await expect(page).toHaveURL(/\?use=public-health$/);
    await expect(page.getByRole('button', { name: 'Report to public health' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('the map renders every state and opens a panel for Pennsylvania', async ({ page }) => {
    await page.goto('/networks');
    await hydrated(page);
    await page.getByRole('button', { name: /^Pennsylvania:/ }).click();
    await expect(page.getByTestId('state-panel').getByRole('heading', { name: 'Pennsylvania' })).toBeVisible();
  });

  test('has no horizontal scroll at 375px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto('/networks');
    await hydrated(page);
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width).toBeLessThanOrEqual(375);
  });
});
