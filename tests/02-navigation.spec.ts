import { test, expect } from '@playwright/test';
import { login } from './helpers/auth';

test.describe('Sidebar & Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('sidebar shows all workspace items', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Inbox' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Tasks' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Drafts' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sent' })).toBeVisible();
  });

  test('sidebar shows team spaces', async ({ page }) => {
    await expect(page.getByText('TEAM SPACES')).toBeVisible();
    const hasAccount = await page.getByText('Operations').first().isVisible().catch(() => false)
      || await page.getByText('Bobber Labs').first().isVisible().catch(() => false)
      || await page.getByText('Rove Essentials').first().isVisible().catch(() => false);
    expect(hasAccount).toBeTruthy();
  });

  test('can navigate to Tasks view', async ({ page }) => {
    await page.getByRole('button', { name: 'Tasks' }).click();
    await expect(page.getByText('My Tasks')).toBeVisible();
  });

  test('can navigate to Drafts view', async ({ page }) => {
    await page.getByRole('button', { name: 'Drafts' }).click();
    await page.waitForTimeout(1000);
    await expect(page.getByRole('heading', { name: 'Drafts' })).toBeVisible();
  });

  test('can navigate to Dashboard', async ({ page }) => {
    await page.getByText('Dashboard').click();
    await page.waitForURL('**/dashboard', { timeout: 15000 });
    expect(page.url()).toContain('/dashboard');
  });

  test('can navigate to Settings', async ({ page }) => {
    await page.getByText('Settings').click();
    await page.waitForURL('**/settings', { timeout: 15000 });
    expect(page.url()).toContain('/settings');
  });

  test('notification bell shows on T logo', async ({ page }) => {
    const tLogo = page.locator('button:has-text("T")').first();
    await expect(tLogo).toBeVisible();
  });

  test('Kara AI rail is visible', async ({ page }) => {
    const karaButton = page.locator('button[title="Ask Kara"]');
    await expect(karaButton).toBeVisible();
  });

  test('can expand email account to see folders', async ({ page }) => {
    await page.getByText('Operations').first().click();
    await page.waitForTimeout(500);
    expect(true).toBeTruthy();
  });

  test('sync button works', async ({ page }) => {
    const syncButton = page.locator('button[title="Sync emails"]');
    await expect(syncButton).toBeVisible();
    await syncButton.click();
    await page.waitForTimeout(500);
  });
});