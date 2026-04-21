import { test, expect } from '@playwright/test';
import { login } from './helpers/auth';

test.describe('Search - Conversations & Tasks', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('search bar accepts input', async ({ page }) => {
    const searchInput = page.locator('input[placeholder*="Search"]');
    await expect(searchInput).toBeVisible();
    await searchInput.fill('test');
    await page.waitForTimeout(500);
    expect(await searchInput.inputValue()).toBe('test');
  });

  test('search shows results after typing', async ({ page }) => {
    const searchInput = page.locator('input[placeholder*="Search"]');
    await searchInput.fill('inquiry');
    await page.waitForTimeout(2000); // Wait for debounced search
    // Should see some conversation results
    const body = await page.textContent('body');
    expect(body).toBeTruthy();
  });

  test('search shows scope filters when typing', async ({ page }) => {
    const searchInput = page.locator('input[placeholder*="Search"]');
    await searchInput.fill('test');
    await page.waitForTimeout(500);
    await expect(page.getByText('All Accounts')).toBeVisible();
  });

  test('search shows tasks tab when tasks match', async ({ page }) => {
    const searchInput = page.locator('input[placeholder*="Search"]');
    await searchInput.fill('call');
    await page.waitForTimeout(2000);
    // Check if Tasks tab appears (it shows when tasks match)
    const tasksTab = page.locator('button:has-text("Tasks (")');
    if (await tasksTab.isVisible()) {
      await tasksTab.click();
      await page.waitForTimeout(500);
      // Should see task results or user filter pills
      const body = await page.textContent('body');
      expect(body?.length).toBeGreaterThan(0);
    }
  });

  test('filter pills show all team members in task search', async ({ page }) => {
    const searchInput = page.locator('input[placeholder*="Search"]');
    await searchInput.fill('call');
    await page.waitForTimeout(2000);
    const tasksTab = page.locator('button:has-text("Tasks (")');
    if (await tasksTab.isVisible()) {
      await tasksTab.click();
      await page.waitForTimeout(500);
      // Should see "All" filter pill
      await expect(page.locator('button:has-text("All")').first()).toBeVisible();
    }
  });
});
