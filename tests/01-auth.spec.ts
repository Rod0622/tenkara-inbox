import { test, expect } from '@playwright/test';
import { login } from './helpers/auth';

test.describe('Authentication', () => {
  test('login page loads', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(3000);
    const hasLogin = await page.locator('input[type="email"], input[name="email"]').isVisible().catch(() => false);
    const hasWorkspace = await page.getByText('MY WORKSPACE').isVisible().catch(() => false);
    expect(hasLogin || hasWorkspace).toBeTruthy();
  });

  test('can login with valid credentials', async ({ page }) => {
    await login(page);
    await expect(page.getByText('MY WORKSPACE')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Inbox' })).toBeVisible();
  });

  test('login fails with wrong password', async ({ page }) => {
    await page.goto('/');
    const hasLogin = await page.locator('input[type="email"]').isVisible().catch(() => false);
    if (!hasLogin) return;
    await page.fill('input[type="email"]', 'wrong@email.com');
    await page.fill('input[type="password"]', 'wrongpassword');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(2000);
    const stillOnLogin = await page.locator('input[type="password"]').isVisible().catch(() => false);
    expect(stillOnLogin).toBeTruthy();
  });

  test('sidebar shows user name', async ({ page }) => {
    await login(page);
    await expect(page.getByText('Rod').first()).toBeVisible();
  });
});