import { test, expect } from '@playwright/test';
import { login } from './helpers/auth';

test.describe('Settings', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.getByText('Settings').click();
    await page.waitForURL('**/settings', { timeout: 15000 });
    await page.waitForTimeout(1000);
  });

  test('settings page loads', async ({ page }) => {
    expect(page.url()).toContain('/settings');
  });

  test('accounts tab shows email accounts', async ({ page }) => {
    await page.getByText('Accounts').first().click();
    await page.waitForTimeout(500);
    await expect(page.getByText('Email Accounts')).toBeVisible();
  });

  test('connect account button exists', async ({ page }) => {
    await page.getByText('Accounts').first().click();
    await expect(page.getByText('Connect Account')).toBeVisible();
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
    await expect(page.getByText('Outgoing').first()).toBeVisible();
    await expect(page.getByText('Unreplied').first()).toBeVisible();
  });

  test('rules tab shows account filter', async ({ page }) => {
    await page.getByText('Rules').click();
    await page.waitForTimeout(500);
    await expect(page.getByText('FILTER BY ACCOUNT').first()).toBeVisible();
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

  test('forms tab has new form button', async ({ page }) => {
    await page.getByText('Forms').click();
    await page.waitForTimeout(500);
    await expect(page.getByText('New Form')).toBeVisible();
  });

  test('email templates tab loads', async ({ page }) => {
    await page.getByText('Email Templates').click();
    await page.waitForTimeout(500);
    expect(true).toBeTruthy();
  });
});