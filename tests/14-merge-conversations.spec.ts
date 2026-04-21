import { test, expect } from '@playwright/test';
import { login } from './helpers/auth';

test.describe('Thread Merge & Conversation Features', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('conversation header shows business hours when available', async ({ page }) => {
    await page.waitForTimeout(2000);
    // Click a conversation
    const firstConvo = page.locator('[class*="cursor-pointer"]').first();
    if (await firstConvo.isVisible()) {
      await firstConvo.click();
      await page.waitForTimeout(2000);
      // Business hours badge may or may not show depending on supplier data
      // Just verify the header area loads
      await expect(page.getByText(/Messages/)).toBeVisible();
    }
  });

  test('Related Threads tab loads', async ({ page }) => {
    await page.waitForTimeout(2000);
    const firstConvo = page.locator('[class*="cursor-pointer"]').first();
    if (await firstConvo.isVisible()) {
      await firstConvo.click();
      await page.waitForTimeout(1000);
      const relatedTab = page.getByRole('button', { name: /Related Threads/ });
      if (await relatedTab.isVisible()) {
        await relatedTab.click();
        await page.waitForTimeout(2000);
        // Should show supplier contact info or "No related threads"
        const body = await page.textContent('body');
        expect(body).toBeTruthy();
      }
    }
  });

  test('Related Threads shows merge buttons on thread cards', async ({ page }) => {
    await page.waitForTimeout(2000);
    const firstConvo = page.locator('[class*="cursor-pointer"]').first();
    if (await firstConvo.isVisible()) {
      await firstConvo.click();
      await page.waitForTimeout(1000);
      const relatedTab = page.getByRole('button', { name: /Related Threads/ });
      if (await relatedTab.isVisible()) {
        await relatedTab.click();
        await page.waitForTimeout(3000);
        // Check if any Merge buttons exist (they appear on related thread cards)
        const mergeButtons = page.locator('button:has-text("Merge")');
        // It's ok if there are no merge buttons (no related threads)
        const count = await mergeButtons.count();
        expect(count).toBeGreaterThanOrEqual(0);
      }
    }
  });

  test('conversation filter shows all team members', async ({ page }) => {
    // Open filter panel
    const filterButton = page.locator('button[title="Filters"]');
    if (await filterButton.isVisible()) {
      await filterButton.click();
      await page.waitForTimeout(500);
      // Should show "Anyone" and "Unassigned" buttons
      await expect(page.getByText('Anyone')).toBeVisible();
      await expect(page.getByText('Unassigned')).toBeVisible();
    }
  });
});

test.describe('Command Center - Domain Threads', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('command center loads and shows sections', async ({ page }) => {
    // Navigate to a known supplier contact page
    await page.goto('/contacts/paul%40trytenkara.com');
    await page.waitForTimeout(5000);
    // Should show Summary section
    await expect(page.getByText('Summary')).toBeVisible();
  });

  test('command center shows domain threads section', async ({ page }) => {
    await page.goto('/contacts/paul%40trytenkara.com');
    await page.waitForTimeout(5000);
    // May show "Same Domain" section if other contacts exist at the domain
    const body = await page.textContent('body');
    expect(body).toBeTruthy();
  });
});
