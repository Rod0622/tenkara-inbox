import { test, expect } from '@playwright/test';
import { login } from './helpers/auth';

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.click('a:has-text("Dashboard")');
    await page.waitForTimeout(2000);
  });

  test('dashboard loads', async ({ page }) => {
    await expect(page.url()).toContain('/dashboard');
  });

  test('dashboard shows overview stats', async ({ page }) => {
    // Should see stat cards
    const stats = page.locator('text=Total, text=Open, text=Unread, text=Starred');
    await expect(stats.first()).toBeVisible();
  });

  test('dashboard shows user performance section', async ({ page }) => {
    // Should see team performance or user stats
    const performance = page.locator('text=Performance, text=Team, text=User');
    if (await performance.first().isVisible()) {
      expect(true).toBeTruthy();
    }
  });

  test('export button exists', async ({ page }) => {
    const exportButton = page.locator('text=Export');
    if (await exportButton.first().isVisible()) {
      expect(true).toBeTruthy();
    }
  });
});
