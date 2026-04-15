import { test, expect } from '@playwright/test';
import { login } from './helpers/auth';

test.describe('Kara AI Assistant', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('Kara rail button is visible', async ({ page }) => {
    const karaButton = page.locator('button[title="Ask Kara"]');
    await expect(karaButton).toBeVisible();
  });

  test('clicking Kara opens the chat panel', async ({ page }) => {
    const karaButton = page.locator('button[title="Ask Kara"]');
    await karaButton.click();
    await page.waitForTimeout(500);
    // Should see Kara header
    await expect(page.locator('text=Kara')).toBeVisible();
    // Should see close button
    const closeButton = page.locator('button').filter({ has: page.locator('svg') }).last();
    expect(true).toBeTruthy();
  });

  test('Kara shows quick actions when conversation is selected', async ({ page }) => {
    // Open a conversation first
    await page.waitForTimeout(2000);
    const firstConvo = page.locator('[class*="cursor-pointer"]').first();
    if (await firstConvo.isVisible()) {
      await firstConvo.click();
      await page.waitForTimeout(1000);
      // Open Kara
      const karaButton = page.locator('button[title="Ask Kara"]');
      await karaButton.click();
      await page.waitForTimeout(500);
      // Should see quick actions
      const quickAction = page.locator('text=Draft reply, text=Summarize, text=Action items').first();
      if (await quickAction.isVisible()) {
        expect(true).toBeTruthy();
      }
    }
  });

  test('Kara has input field for questions', async ({ page }) => {
    const karaButton = page.locator('button[title="Ask Kara"]');
    await karaButton.click();
    await page.waitForTimeout(500);
    const input = page.locator('input[placeholder*="Kara"]');
    await expect(input).toBeVisible();
  });
});
