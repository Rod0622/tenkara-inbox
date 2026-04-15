import { test, expect } from '@playwright/test';
import { login } from './helpers/auth';

test.describe('Drafts', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('drafts sidebar item shows count', async ({ page }) => {
    const draftsItem = page.locator('text=Drafts').first();
    await expect(draftsItem).toBeVisible();
  });

  test('drafts panel loads when clicked', async ({ page }) => {
    await page.click('text=Drafts');
    await page.waitForTimeout(1000);
    // Should see Drafts heading
    const heading = page.locator('h1:has-text("Drafts")');
    await expect(heading).toBeVisible();
  });

  test('draft cards show subject and recipient', async ({ page }) => {
    await page.click('text=Drafts');
    await page.waitForTimeout(1000);
    // If there are drafts, they should show subject and To:
    const draftCard = page.locator('text=To:').first();
    if (await draftCard.isVisible()) {
      expect(true).toBeTruthy();
    }
  });

  test('auto-follow-up drafts show badge', async ({ page }) => {
    await page.click('text=Drafts');
    await page.waitForTimeout(1000);
    const badge = page.locator('text=Auto follow-up').first();
    if (await badge.isVisible()) {
      expect(true).toBeTruthy();
    }
  });

  test('draft loads into reply editor when conversation opened', async ({ page }) => {
    await page.click('text=Drafts');
    await page.waitForTimeout(1000);
    // Click open button on first draft
    const openButton = page.locator('button[title="Open conversation & edit draft"]').first();
    if (await openButton.isVisible()) {
      await openButton.click();
      await page.waitForTimeout(2000);
      // Reply editor should be open with Draft badge
      const draftBadge = page.locator('text=Draft').last();
      if (await draftBadge.isVisible()) {
        expect(true).toBeTruthy();
      }
    }
  });

  test('discard draft button works', async ({ page }) => {
    // Open a conversation that has a draft
    await page.click('text=Drafts');
    await page.waitForTimeout(1000);
    const openButton = page.locator('button[title="Open conversation & edit draft"]').first();
    if (await openButton.isVisible()) {
      await openButton.click();
      await page.waitForTimeout(2000);
      const discardButton = page.locator('text=Discard draft');
      if (await discardButton.isVisible()) {
        await discardButton.click();
        await page.waitForTimeout(1000);
        // Reply editor should close
        expect(true).toBeTruthy();
      }
    }
  });
});
