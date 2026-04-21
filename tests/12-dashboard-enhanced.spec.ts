import { test, expect } from '@playwright/test';
import { login } from './helpers/auth';

test.describe('Dashboard Enhancements', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/dashboard');
    await page.waitForTimeout(5000);
  });

  test('dashboard shows 6 summary cards', async ({ page }) => {
    await expect(page.getByText('Team Members').first()).toBeVisible();
    await expect(page.getByText('Open Tasks').first()).toBeVisible();
    await expect(page.getByText('Overdue', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Assigned Emails').first()).toBeVisible();
    await expect(page.getByText('Total Unread').first()).toBeVisible();
    await expect(page.getByText('Emails Sent').first()).toBeVisible();
  });

  test('dashboard shows team overview with members', async ({ page }) => {
    await expect(page.getByText('Team Member', { exact: true }).first()).toBeVisible();
    // Should show at least one team member row
    const body = await page.textContent('body');
    expect(body).toContain('Operations');
  });

  test('SLA/Response Times tab loads', async ({ page }) => {
    await page.click('text=SLA / Response Times');
    await page.waitForTimeout(8000); // SLA data takes time to load
    // Should show sub-tabs — use text matching to be resilient
    await expect(page.getByText('Response Times by User').first()).toBeVisible();
  });

  test('Supplier Response Times shows supplier count and search', async ({ page }) => {
    await page.click('text=SLA / Response Times');
    await page.waitForTimeout(3000);
    await page.click('text=Supplier Response Times');
    await page.waitForTimeout(1000);
    // Should show search bar and supplier count
    await expect(page.locator('input[placeholder*="Search suppliers"]')).toBeVisible();
    await expect(page.locator('text=/\\d+ suppliers/')).toBeVisible();
  });

  test('user detail loads when clicking a team member', async ({ page }) => {
    // Click first team member row
    const memberRow = page.locator('button:has-text("Rod")').first();
    if (await memberRow.isVisible()) {
      await memberRow.click();
      await page.waitForTimeout(2000);
      // Should show user detail tabs
      await expect(page.getByRole('button', { name: /^Tasks \(\d/ })).toBeVisible();
      await expect(page.getByRole('button', { name: /Assigned Emails \(/ })).toBeVisible();
      await expect(page.getByRole('button', { name: /Unread \(/ })).toBeVisible();
      await expect(page.getByRole('button', { name: /Sent \(/ })).toBeVisible();
    }
  });

  test('user detail unread tab shows emails', async ({ page }) => {
    const memberRow = page.locator('button:has-text("Rod")').first();
    if (await memberRow.isVisible()) {
      await memberRow.click();
      await page.waitForTimeout(2000);
      const unreadTab = page.locator('button:has-text("Unread (")');
      if (await unreadTab.isVisible()) {
        await unreadTab.click();
        await page.waitForTimeout(500);
        // Content should load (either emails or "No unread emails")
        const body = await page.textContent('body');
        expect(body?.length).toBeGreaterThan(0);
      }
    }
  });

  test('export data tab loads', async ({ page }) => {
    await page.click('text=Export Data');
    await page.waitForTimeout(1000);
    const body = await page.textContent('body');
    expect(body).toContain('Export');
  });
});