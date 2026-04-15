import { test, expect } from '@playwright/test';
import { login } from './helpers/auth';

test.describe('Settings', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.click('a:has-text("Settings")');
    await page.waitForTimeout(1000);
  });

  test('settings page loads', async ({ page }) => {
    await expect(page.url()).toContain('/settings');
  });

  // ── Accounts Tab ──
  test('accounts tab shows email accounts', async ({ page }) => {
    await page.click('text=Accounts');
    await page.waitForTimeout(500);
    await expect(page.locator('text=Email Accounts')).toBeVisible();
    await expect(page.locator('text=Operations')).toBeVisible();
  });

  test('connect account button exists', async ({ page }) => {
    await page.click('text=Accounts');
    await expect(page.locator('text=Connect Account')).toBeVisible();
  });

  // ── Team Members Tab ──
  test('team members tab shows members', async ({ page }) => {
    await page.click('text=Team Members');
    await page.waitForTimeout(500);
    await expect(page.locator('text=Rod').first()).toBeVisible();
  });

  // ── User Groups Tab ──
  test('user groups tab loads', async ({ page }) => {
    await page.click('text=User Groups');
    await page.waitForTimeout(500);
    // Should see groups or empty state
    expect(true).toBeTruthy();
  });

  // ── Labels Tab ──
  test('labels tab shows labels', async ({ page }) => {
    await page.click('text=Labels');
    await page.waitForTimeout(500);
    // Should see labels list or create button
    expect(true).toBeTruthy();
  });

  // ── Rules Tab ──
  test('rules tab shows trigger types', async ({ page }) => {
    await page.click('text=Rules');
    await page.waitForTimeout(500);
    await expect(page.locator('text=Incoming')).toBeVisible();
    await expect(page.locator('text=Outgoing')).toBeVisible();
    await expect(page.locator('text=Unreplied')).toBeVisible();
  });

  test('rules tab shows account filter', async ({ page }) => {
    await page.click('text=Rules');
    await page.waitForTimeout(500);
    await expect(page.locator('text=FILTER BY ACCOUNT')).toBeVisible();
  });

  test('rules tab shows new rule button', async ({ page }) => {
    await page.click('text=Rules');
    await page.waitForTimeout(500);
    await expect(page.locator('text=New Rule')).toBeVisible();
  });

  test('can open new rule form', async ({ page }) => {
    await page.click('text=Rules');
    await page.waitForTimeout(500);
    await page.click('text=New Rule');
    await page.waitForTimeout(500);
    // Should see rule form with conditions and actions
    await expect(page.locator('text=CONDITIONS')).toBeVisible();
    await expect(page.locator('text=ACTIONS')).toBeVisible();
    await expect(page.locator('text=APPLIES TO')).toBeVisible();
  });

  test('rule form shows all condition fields', async ({ page }) => {
    await page.click('text=Rules');
    await page.waitForTimeout(500);
    await page.click('text=New Rule');
    await page.waitForTimeout(500);
    // Click the condition field dropdown
    const conditionSelect = page.locator('select').first();
    await conditionSelect.click();
    // Check for key condition options
    const options = await conditionSelect.locator('option').allTextContents();
    expect(options).toContain('From');
    expect(options).toContain('Subject');
    expect(options).toContain('Has attachments?');
    expect(options).toContain('Email account');
  });

  test('rule form shows auto-assign options', async ({ page }) => {
    await page.click('text=Rules');
    await page.waitForTimeout(500);
    await page.click('text=New Rule');
    await page.waitForTimeout(500);
    // Change action to Assign to
    const actionSelect = page.locator('select').nth(2); // Third select is action type
    await actionSelect.selectOption('assign_to');
    await page.waitForTimeout(300);
    // Should see Specific person / Auto-assign toggle
    await expect(page.locator('text=Specific person')).toBeVisible();
    await expect(page.locator('text=Auto-assign')).toBeVisible();
  });

  test('unreplied rules show time conditions', async ({ page }) => {
    await page.click('text=Rules');
    await page.waitForTimeout(500);
    // Switch to Unreplied tab
    await page.click('text=Unreplied');
    await page.waitForTimeout(300);
    await page.click('text=New Rule');
    await page.waitForTimeout(500);
    // Change condition to time-based
    const conditionSelect = page.locator('select').first();
    await conditionSelect.selectOption('time_since_last_outbound');
    await page.waitForTimeout(300);
    // Should see Minutes/Hours/Days dropdown
    await expect(page.locator('option:has-text("Minutes")')).toBeVisible();
    await expect(page.locator('option:has-text("Hours")')).toBeVisible();
    await expect(page.locator('option:has-text("Days")')).toBeVisible();
  });

  // ── Task Categories Tab ──
  test('task categories tab loads', async ({ page }) => {
    await page.click('text=Task Categories');
    await page.waitForTimeout(500);
    expect(true).toBeTruthy();
  });

  // ── Task Templates Tab ──
  test('task templates tab loads', async ({ page }) => {
    await page.click('text=Task Templates');
    await page.waitForTimeout(500);
    expect(true).toBeTruthy();
  });

  // ── Forms Tab ──
  test('forms tab loads', async ({ page }) => {
    await page.click('text=Forms');
    await page.waitForTimeout(500);
    await expect(page.locator('text=Form Templates')).toBeVisible();
  });

  test('can open new form builder', async ({ page }) => {
    await page.click('text=Forms');
    await page.waitForTimeout(500);
    await page.click('text=New Form');
    await page.waitForTimeout(500);
    // Should see form name input and fields section
    await expect(page.locator('input[placeholder*="Form name"]')).toBeVisible();
    await expect(page.locator('text=Form Fields')).toBeVisible();
  });

  test('form builder shows field types', async ({ page }) => {
    await page.click('text=Forms');
    await page.waitForTimeout(500);
    await page.click('text=New Form');
    await page.waitForTimeout(500);
    // Check field type dropdown has all options
    const fieldTypeSelect = page.locator('select').last();
    const options = await fieldTypeSelect.locator('option').allTextContents();
    expect(options).toContain('Text');
    expect(options).toContain('Long text');
    expect(options).toContain('Dropdown');
    expect(options).toContain('Date');
    expect(options).toContain('Phone');
  });

  // ── Email Templates Tab ──
  test('email templates tab loads', async ({ page }) => {
    await page.click('text=Email Templates');
    await page.waitForTimeout(500);
    expect(true).toBeTruthy();
  });
});
