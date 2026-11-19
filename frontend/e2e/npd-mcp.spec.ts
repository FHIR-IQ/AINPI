import { test, expect } from '@playwright/test';

// Loads the page only. Never submits the form: with a real database URL in
// the environment a submission would write a production row.
test.describe('/npd-mcp', () => {
  test.setTimeout(90_000);

  test('renders the heading and the sign-up form', async ({ page }) => {
    await page.goto('/npd-mcp');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Open-source MCP tools for the National Provider Directory' }),
    ).toBeVisible();
    await expect(page.locator('#join form')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign up' })).toBeVisible();
  });

  test('has no horizontal scroll at 375px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto('/npd-mcp');
    await expect(page.locator('#join form')).toBeVisible();
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width).toBeLessThanOrEqual(375);
  });
});
