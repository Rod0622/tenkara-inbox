import { test, expect } from '@playwright/test';
import { login } from './helpers/auth';

test.describe('Settings', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/settings');
    await page.waitForTimeout(5000);
  });

  test('settings page loads', async ({ page }) => {
    expect(page.url()).toContain('/settings');
  });

  test('accounts tab shows email accounts', async ({ page }) => {
    await page.getByText('Accounts').first().click();
    await page.waitForTimeout(500);
    await expect(page.getByText('Email Accounts')).toBeVisible();
  });

  test('team members tab shows members', async ({ page }) => {
    await page.getByText('Team Members').click();
    await page.waitForTimeout(500);
    await expect(page.getByText('Rod').first()).toBeVisible();
  });

  test('rules tab shows trigger types', async ({ page }) => {
    await page.getByText('Rules').click();
    await page.waitForTimeout(500);
    await expect(page.getByText('Incoming').first()).toBeVisible();
  });

  test('rules tab shows new rule button', async ({ page }) => {
    await page.getByText('Rules').click();
    await page.waitForTimeout(500);
    await expect(page.getByText('New Rule')).toBeVisible();
  });

  test('forms tab loads', async ({ page }) => {
    await page.getByText('Forms').click();
    await page.waitForTimeout(500);
    await expect(page.getByText('Form Templates')).toBeVisible();
  });
});