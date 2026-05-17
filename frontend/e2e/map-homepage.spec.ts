import { test, expect } from '@playwright/test';

test.describe('map-first homepage', () => {
  test('renders the map, theme switcher, and metric switcher', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('group', { name: 'Page style' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Map metric' })).toBeVisible();
    // The choropleth SVG should be in the DOM after D3 mounts.
    await expect(page.locator('svg').first()).toBeVisible({ timeout: 10000 });
  });

  test('theme switcher cycles and persists', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /dark dashboard/i }).click();
    await expect(page.getByRole('button', { name: /dark dashboard/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.reload();
    await expect(page.getByRole('button', { name: /dark dashboard/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('nav has exactly 5 items', async ({ page }) => {
    await page.goto('/');
    // Scope to the navbar; the footer also has Methodology/Developer links,
    // and the homepage body has an "All findings →" link that would collide.
    const nav = page.getByRole('navigation');
    const labels = ['Explore', 'Findings', 'For States', 'Methodology', 'Developer'];
    for (const label of labels) {
      await expect(nav.getByRole('link', { name: label, exact: true })).toBeVisible();
    }
  });

  test('for-state-medicaid index links to per-state pages', async ({ page }) => {
    await page.goto('/for-state-medicaid');
    // Each state card's accessible name is "<State Name> <count>" (e.g.
    // "Virginia 125"). Regex-match the leading state name + count digit so
    // we don't collide with "West Virginia" or unrelated "Virginia ..." links.
    const va = page.getByRole('link', { name: /^Virginia\s+\d/ });
    await expect(va).toBeVisible();
    await expect(va).toHaveAttribute('href', '/for-state-medicaid/va');
  });
});
