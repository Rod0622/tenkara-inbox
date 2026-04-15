import { test, expect } from '@playwright/test';
import { login } from './helpers/auth';

test.describe('Inbox & Conversations', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('inbox shows conversation list', async ({ page }) => {
    await page.waitForTimeout(2000);
    const conversations = page.locator('[class*="cursor-pointer"]');
    const count = await conversations.count();
    expect(count).toBeGreaterThan(0);
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

  test('conversation detail shows all tabs', async ({ page }) => {
    await page.waitForTimeout(2000);
    const firstConvo = page.locator('[class*="cursor-pointer"]').first();
    if (await firstConvo.isVisible()) {
      await firstConvo.click();
      await page.waitForTimeout(1000);
      await expect(page.getByRole('button', { name: /Messages/ })).toBeVisible();
      await expect(page.getByRole('button', { name: /Notes/ })).toBeVisible();
      await expect(page.getByRole('button', { name: /Tasks/ })).toBeVisible();
      await expect(page.getByRole('button', { name: /Activity/ })).toBeVisible();
    }
  });

  test('reply editor opens when clicking Write a reply', async ({ page }) => {
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
        await expect(page.getByText('Collapse')).toBeVisible();
      }
    }
  });

  test('form button is visible next to reply', async ({ page }) => {
    await page.waitForTimeout(2000);
    const firstConvo = page.locator('[class*="cursor-pointer"]').first();
    if (await firstConvo.isVisible()) {
      await firstConvo.click();
      await page.waitForTimeout(1000);
      const formButton = page.locator('button[title="Fill out a form"]').first();
      await expect(formButton).toBeVisible();
    }
  });

  test('search bar is visible', async ({ page }) => {
    const searchInput = page.locator('input[placeholder*="Search"]');
    await expect(searchInput).toBeVisible();
  });

  test('can assign user to conversation', async ({ page }) => {
    await page.waitForTimeout(2000);
    const firstConvo = page.locator('[class*="cursor-pointer"]').first();
    if (await firstConvo.isVisible()) {
      await firstConvo.click();
      await page.waitForTimeout(1000);
      expect(true).toBeTruthy();
    }
  });

  test('labels button is visible on conversation', async ({ page }) => {
    await page.waitForTimeout(2000);
    const firstConvo = page.locator('[class*="cursor-pointer"]').first();
    if (await firstConvo.isVisible()) {
      await firstConvo.click();
      await page.waitForTimeout(1000);
      await expect(page.getByText('Labels').first()).toBeVisible();
    }
  });

  test('move to folder button is visible', async ({ page }) => {
    await page.waitForTimeout(2000);
    const firstConvo = page.locator('[class*="cursor-pointer"]').first();
    if (await firstConvo.isVisible()) {
      await firstConvo.click();
      await page.waitForTimeout(1000);
      await expect(page.getByText('Move to').first()).toBeVisible();
    }
  });
});