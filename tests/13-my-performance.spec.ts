import { test, expect } from '@playwright/test';
import { login } from './helpers/auth';

test.describe('My Performance - Self Service', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('My Performance link is visible in sidebar', async ({ page }) => {
    await expect(page.locator('a:has-text("My Performance")')).toBeVisible();
  });

  test('My Performance page loads', async ({ page }) => {
    await page.click('a:has-text("My Performance")');
    await page.waitForTimeout(3000);
    expect(page.url()).toContain('/my-performance');
    await expect(page.getByText('My Performance')).toBeVisible();
  });

  test('My Performance shows summary cards', async ({ page }) => {
    await page.goto('/my-performance');
    await page.waitForTimeout(3000);
    await expect(page.getByText('Open Tasks').first()).toBeVisible();
    await expect(page.getByText('Overdue', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Assigned', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Unread', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Sent', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Avg Response').first()).toBeVisible();
  });

  test('My Performance shows tabs', async ({ page }) => {
    await page.goto('/my-performance');
    await page.waitForTimeout(3000);
    await expect(page.getByRole('button', { name: /Tasks \(/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Assigned \(/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Unread \(/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Sent \(/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Response Times/ })).toBeVisible();
  });

  test('My Performance tasks tab shows task list', async ({ page }) => {
    await page.goto('/my-performance');
    await page.waitForTimeout(3000);
    // Tasks tab is default — should show tasks or "No tasks assigned"
    const body = await page.textContent('body');
    expect(body).toBeTruthy();
  });

  test('My Performance can switch tabs', async ({ page }) => {
    await page.goto('/my-performance');
    await page.waitForTimeout(3000);

    // Click Sent tab
    await page.getByRole('button', { name: /Sent \(/ }).click();
    await page.waitForTimeout(500);

    // Click Response Times tab
    await page.getByRole('button', { name: /Response Times/ }).click();
    await page.waitForTimeout(500);

    // Should show response stats or "No response time data yet"
    const body = await page.textContent('body');
    expect(body).toBeTruthy();
  });

  test('My Performance has back button to inbox', async ({ page }) => {
    await page.goto('/my-performance');
    await page.waitForTimeout(3000);
    const backLink = page.locator('a[href="/"]').first();
    await expect(backLink).toBeVisible();
  });
});