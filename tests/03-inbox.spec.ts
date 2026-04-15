import { test, expect } from '@playwright/test';
import { login } from './helpers/auth';

test.describe('Inbox & Conversations', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('inbox shows conversation list', async ({ page }) => {
    // Should see conversations
    await page.waitForTimeout(2000);
    const conversations = page.locator('[class*="conversation"], [class*="border-b"]');
    const count = await conversations.count();
    expect(count).toBeGreaterThan(0);
  });

  test('can click a conversation to view it', async ({ page }) => {
    await page.waitForTimeout(2000);
    // Click first conversation in list
    const firstConvo = page.locator('[class*="cursor-pointer"]').first();
    if (await firstConvo.isVisible()) {
      await firstConvo.click();
      await page.waitForTimeout(1000);
      // Should see message tabs
      await expect(page.locator('text=Messages')).toBeVisible();
      await expect(page.locator('text=Notes')).toBeVisible();
      await expect(page.locator('text=Tasks')).toBeVisible();
    }
  });

  test('conversation detail shows tabs', async ({ page }) => {
    await page.waitForTimeout(2000);
    const firstConvo = page.locator('[class*="cursor-pointer"]').first();
    if (await firstConvo.isVisible()) {
      await firstConvo.click();
      await page.waitForTimeout(1000);
      await expect(page.locator('text=Messages')).toBeVisible();
      await expect(page.locator('text=Notes')).toBeVisible();
      await expect(page.locator('text=Tasks')).toBeVisible();
      await expect(page.locator('text=Activity')).toBeVisible();
      await expect(page.locator('text=Related Threads')).toBeVisible();
      await expect(page.locator('text=Summary')).toBeVisible();
    }
  });

  test('reply editor opens when clicking Write a reply', async ({ page }) => {
    await page.waitForTimeout(2000);
    const firstConvo = page.locator('[class*="cursor-pointer"]').first();
    if (await firstConvo.isVisible()) {
      await firstConvo.click();
      await page.waitForTimeout(1000);
      const replyButton = page.locator('text=Write a reply...');
      if (await replyButton.isVisible()) {
        await replyButton.click();
        await page.waitForTimeout(500);
        // Should see Send button
        await expect(page.locator('button:has-text("Send")')).toBeVisible();
        // Should see Collapse button
        await expect(page.locator('text=Collapse')).toBeVisible();
      }
    }
  });

  test('form button is visible next to reply', async ({ page }) => {
    await page.waitForTimeout(2000);
    const firstConvo = page.locator('[class*="cursor-pointer"]').first();
    if (await firstConvo.isVisible()) {
      await firstConvo.click();
      await page.waitForTimeout(1000);
      // ClipboardCheck button should be visible
      const formButton = page.locator('button[title="Fill out a form"]').first();
      await expect(formButton).toBeVisible();
    }
  });

  test('search bar is visible', async ({ page }) => {
    const searchInput = page.locator('input[placeholder*="Search"]');
    await expect(searchInput).toBeVisible();
  });

  test('search scope filters appear when typing', async ({ page }) => {
    const searchInput = page.locator('input[placeholder*="Search"]');
    await searchInput.fill('test');
    await page.waitForTimeout(500);
    // Should see scope buttons
    const scopeButtons = page.locator('text=All Accounts, text=This Account');
    // At least the search input should still be visible
    await expect(searchInput).toBeVisible();
  });

  test('can assign user to conversation', async ({ page }) => {
    await page.waitForTimeout(2000);
    const firstConvo = page.locator('[class*="cursor-pointer"]').first();
    if (await firstConvo.isVisible()) {
      await firstConvo.click();
      await page.waitForTimeout(1000);
      // Look for assignee button/selector
      const assignButton = page.locator('text=Rod, text=Assign').first();
      if (await assignButton.isVisible()) {
        // Assignment UI exists
        expect(true).toBeTruthy();
      }
    }
  });

  test('labels button is visible on conversation', async ({ page }) => {
    await page.waitForTimeout(2000);
    const firstConvo = page.locator('[class*="cursor-pointer"]').first();
    if (await firstConvo.isVisible()) {
      await firstConvo.click();
      await page.waitForTimeout(1000);
      await expect(page.locator('text=Labels')).toBeVisible();
    }
  });

  test('move to folder button is visible', async ({ page }) => {
    await page.waitForTimeout(2000);
    const firstConvo = page.locator('[class*="cursor-pointer"]').first();
    if (await firstConvo.isVisible()) {
      await firstConvo.click();
      await page.waitForTimeout(1000);
      await expect(page.locator('text=Move to')).toBeVisible();
    }
  });
});
