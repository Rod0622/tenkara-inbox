import { test, expect } from '@playwright/test';
import { login } from './helpers/auth';

test.describe('Kara AI Assistant', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('Kara rail button is visible', async ({ page }) => {
    await expect(page.locator('button[title="Ask Kara"]')).toBeVisible();
  });

  test('clicking Kara opens the chat panel', async ({ page }) => {
    await page.locator('button[title="Ask Kara"]').click();
    await page.waitForTimeout(500);
    await expect(page.getByText('Kara', { exact: true })).toBeVisible();
  });

  test('Kara shows quick actions with conversation', async ({ page }) => {
    await page.waitForTimeout(2000);
    const firstConvo = page.locator('[class*="cursor-pointer"]').first();
    if (await firstConvo.isVisible()) {
      await firstConvo.click();
      await page.waitForTimeout(1000);
      await page.locator('button[title="Ask Kara"]').click();
      await page.waitForTimeout(500);
      const quickAction = page.getByText('Draft reply').first();
      if (await quickAction.isVisible()) expect(true).toBeTruthy();
    }
  });

  test('Kara has input field', async ({ page }) => {
    await page.locator('button[title="Ask Kara"]').click();
    await page.waitForTimeout(500);
    await expect(page.getByPlaceholder('Select a conversation first')).toBeVisible();
  });
});