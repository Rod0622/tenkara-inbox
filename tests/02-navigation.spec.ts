import { test, expect } from '@playwright/test';
import { login, navigateTo } from './helpers/auth';

test.describe('Sidebar & Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('sidebar shows all workspace items', async ({ page }) => {
    await expect(page.locator('text=Inbox')).toBeVisible();
    await expect(page.locator('text=Tasks')).toBeVisible();
    await expect(page.locator('text=Drafts')).toBeVisible();
    await expect(page.locator('text=Sent')).toBeVisible();
  });

  test('sidebar shows team spaces / email accounts', async ({ page }) => {
    await expect(page.locator('text=TEAM SPACES')).toBeVisible();
    // Should show at least one email account
    const accounts = page.locator('text=Operations, text=Bobber Labs, text=Rove Essentials');
    await expect(accounts.first()).toBeVisible();
  });

  test('can navigate to Tasks view', async ({ page }) => {
    await page.click('text=Tasks');
    await expect(page.locator('text=My Tasks')).toBeVisible();
  });

  test('can navigate to Drafts view', async ({ page }) => {
    await page.click('text=Drafts');
    await expect(page.locator('text=Drafts').nth(1)).toBeVisible();
  });

  test('can navigate to Dashboard', async ({ page }) => {
    await page.click('a:has-text("Dashboard")');
    await page.waitForTimeout(1000);
    await expect(page.url()).toContain('/dashboard');
  });

  test('can navigate to Settings', async ({ page }) => {
    await page.click('a:has-text("Settings")');
    await page.waitForTimeout(1000);
    await expect(page.url()).toContain('/settings');
  });

  test('notification bell shows on T logo', async ({ page }) => {
    // The T logo acts as notification toggle
    const tLogo = page.locator('button:has-text("T")').first();
    await expect(tLogo).toBeVisible();
  });

  test('Kara AI rail is visible on right side', async ({ page }) => {
    // Thin right rail with sparkle icon
    const karaButton = page.locator('button[title="Ask Kara"]');
    await expect(karaButton).toBeVisible();
  });

  test('can expand email account to see folders', async ({ page }) => {
    // Click on an account name to expand
    await page.click('text=Operations');
    await page.waitForTimeout(500);
    // Should see Inbox, Sent, Drafts folders
    await expect(page.locator('text=Inbox').nth(1)).toBeVisible();
  });

  test('sync button works', async ({ page }) => {
    const syncButton = page.locator('button[title="Sync emails"]');
    await expect(syncButton).toBeVisible();
    await syncButton.click();
    // Should see spinning animation
    await page.waitForTimeout(500);
  });
});
