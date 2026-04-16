import { test, expect } from '@playwright/test';
import { login } from './helpers/auth';

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/dashboard');
    await page.waitForTimeout(5000);
  });

  test('dashboard loads', async ({ page }) => {
    expect(page.url()).toContain('/dashboard');
  });

  test('dashboard shows content', async ({ page }) => {
    const body = await page.textContent('body');
    expect(body?.length).toBeGreaterThan(100);
  });
});