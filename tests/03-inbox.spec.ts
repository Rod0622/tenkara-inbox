import { test, expect } from '@playwright/test';
import { login } from './helpers/auth';

test.describe('Inbox & Conversations', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('inbox shows conversation list', async ({ page }) => {
    await page.waitForTimeout(2000);
    const conversations = page.locator('[class*="cursor-pointer"]');
    expect(await conversations.count()).toBeGreaterThan(0);
  });

  test('can click a conversation to view it', async ({ page }) => {
    await page.waitForTimeout(2000);
    const firstConvo = page.locator('[class*="cursor-pointer"]').first();
    if (await firstConvo.isVisible()) {
      await firstConvo.click();
      await page.waitForTimeout(1000);
      await expect(page.getByRole('button', { name: /Messages/ })).toBeVisible();
      await expect(page.getByRole('button', { name: /Notes/ })).toBeVisible();
    }
  });

  test('conversation detail shows tabs', async ({ page }) => {
    await page.waitForTimeout(2000);
    const firstConvo = page.locator('[class*="cursor-pointer"]').first();
    if (await firstConvo.isVisible()) {
      await firstConvo.click();
      await page.waitForTimeout(1000);
      await expect(page.getByRole('button', { name: /Messages/ })).toBeVisible();
      await expect(page.getByRole('button', { name: /Notes/ })).toBeVisible();
      // Tasks tab - use exact match to avoid sidebar Tasks button
      // Replace line 35 with:
      await expect(page.getByRole('button', { name: /^Tasks \d/ }).last()).toBeVisible();
      await expect(page.getByRole('button', { name: /Activity/ })).toBeVisible();
    }
  });

  test('reply editor opens', async ({ page }) => {
    await page.waitForTimeout(2000);
    const firstConvo = page.locator('[class*="cursor-pointer"]').first();
    if (await firstConvo.isVisible()) {
      await firstConvo.click();
      await page.waitForTimeout(1000);
      const replyButton = page.getByText('Write a reply...');
      if (await replyButton.isVisible()) {
        await replyButton.click();
        await page.waitForTimeout(500);
        await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeVisible();
      }
    }
  });

  test('search bar is visible', async ({ page }) => {
    await expect(page.locator('input[placeholder*="Search"]')).toBeVisible();
  });

  test('labels button visible', async ({ page }) => {
    await page.waitForTimeout(2000);
    const firstConvo = page.locator('[class*="cursor-pointer"]').first();
    if (await firstConvo.isVisible()) {
      await firstConvo.click();
      await page.waitForTimeout(1000);
      await expect(page.getByText('Labels').first()).toBeVisible();
    }
  });

  test('move to folder button visible', async ({ page }) => {
    await page.waitForTimeout(2000);
    const firstConvo = page.locator('[class*="cursor-pointer"]').first();
    if (await firstConvo.isVisible()) {
      await firstConvo.click();
      await page.waitForTimeout(1000);
      await expect(page.getByText('Move to').first()).toBeVisible();
    }
  });
});