import { test, expect } from '@playwright/test';
import { login } from './helpers/auth';

test.describe('Authentication', () => {
  test('login page loads', async ({ page }) => {
    await page.goto('/');
    // Should see login form or inbox
    const hasLogin = await page.locator('input[type="email"], input[name="email"]').isVisible().catch(() => false);
    const hasInbox = await page.locator('text=MY WORKSPACE').isVisible().catch(() => false);
    expect(hasLogin || hasInbox).toBeTruthy();
  });

  test('can login with valid credentials', async ({ page }) => {
    await login(page);
    await expect(page.locator('text=MY WORKSPACE')).toBeVisible();
    await expect(page.locator('text=Inbox')).toBeVisible();
  });

  test('login fails with wrong password', async ({ page }) => {
    await page.goto('/');
    const hasLogin = await page.locator('input[type="email"]').isVisible().catch(() => false);
    if (!hasLogin) return; // Already logged in

    await page.fill('input[type="email"]', 'wrong@email.com');
    await page.fill('input[type="password"]', 'wrongpassword');
    await page.click('button[type="submit"]');
    
    // Should still be on login page or show error
    await page.waitForTimeout(2000);
    const stillOnLogin = await page.locator('input[type="password"]').isVisible().catch(() => false);
    expect(stillOnLogin).toBeTruthy();
  });

  test('sidebar shows user name', async ({ page }) => {
    await login(page);
    // User name should appear at bottom of sidebar
    await expect(page.locator('text=Rod').first()).toBeVisible();
  });
});
