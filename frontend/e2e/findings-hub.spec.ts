import { test, expect } from '@playwright/test';

test.describe('/findings hub', () => {
  test('renders lead, timeline, and catalog sections', async ({ page }) => {
    await page.goto('/findings');
    // Lead has an H1
    await expect(page.locator('h1').first()).toBeVisible();
    // Timeline section heading
    await expect(page.getByText(/Recent updates/i)).toBeVisible();
    // Catalog header
    await expect(page.getByText(/All \d+ findings/)).toBeVisible();
  });

  test('clicking a catalog row navigates to the finding page', async ({ page }) => {
    await page.goto('/findings');
    const link = page.getByRole('link', { name: /Federally excluded NPIs billing Medicare Part B by HCPCS/i }).first();
    await link.click();
    await expect(page).toHaveURL(/\/findings\/excluded-billing-medicare-partb-by-hcpcs/);
  });

  test('clicking a timeline entry navigates correctly', async ({ page }) => {
    await page.goto('/findings');
    const article = page.getByRole('link', { name: /Eight years post-exclusion/i }).first();
    await article.click();
    await expect(page).toHaveURL(/\/articles\/eight-years-post-exclusion/);
  });

  test('lead CTA navigates to the finding page', async ({ page }) => {
    await page.goto('/findings');
    await page.getByRole('link', { name: 'Open finding →' }).click();
    await expect(page).toHaveURL(/\/findings\/excluded-billing-medicare-partb-by-hcpcs/);
  });
});

test.describe('/ homepage Latest strip', () => {
  test('strip renders below the map with the lead title and a View all link', async ({ page }) => {
    await page.goto('/');
    // The HomepageLatestStrip's "Latest" badge sits below the map. Scope to it
    // to avoid colliding with the LatestUpdates banner that also renders "Latest" above the navbar.
    const stripLatestBadge = page.getByText(/^Latest$/i).last();
    await expect(stripLatestBadge).toBeVisible();
    await expect(page.getByRole('link', { name: /View all updates/i })).toHaveAttribute('href', '/findings');
  });
});
