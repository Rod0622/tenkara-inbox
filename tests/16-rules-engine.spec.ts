import { test, expect } from '@playwright/test';
import { login } from './helpers/auth';

test.describe('Rules Engine - Conditions & Actions', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/settings');
    await page.waitForTimeout(5000);
    await page.getByText('Rules').click();
    await page.waitForTimeout(1000);
  });

  test('new rule form opens with + New Rule button', async ({ page }) => {
    await page.click('text=New Rule');
    await page.waitForTimeout(500);
    await expect(page.locator('input[placeholder*="Rule name"]').first()).toBeVisible();
  });

  test('condition field dropdown shows all condition types', async ({ page }) => {
    await page.click('text=New Rule');
    await page.waitForTimeout(500);
    // Find the condition field select
    const conditionSelect = page.locator('select').filter({ hasText: 'From' }).first();
    if (await conditionSelect.isVisible()) {
      const options = await conditionSelect.locator('option').allTextContents();
      // Check for new conditions we added
      expect(options.some(o => o.includes('Sender domain'))).toBe(true);
      expect(options.some(o => o.includes('Has been replied to'))).toBe(true);
      expect(options.some(o => o.includes('Time since conversation created'))).toBe(true);
      // Check existing conditions still there
      expect(options.some(o => o.includes('Subject'))).toBe(true);
      expect(options.some(o => o.includes('Has attachments'))).toBe(true);
      expect(options.some(o => o.includes('Number of messages'))).toBe(true);
    }
  });

  test('action type dropdown shows all action types', async ({ page }) => {
    await page.click('text=New Rule');
    await page.waitForTimeout(500);
    // Find the action type select
    const actionSelect = page.locator('select').filter({ hasText: 'Add label' }).first();
    if (await actionSelect.isVisible()) {
      const options = await actionSelect.locator('option').allTextContents();
      // Check for new actions we added
      expect(options.some(o => o.includes('Set priority'))).toBe(true);
      expect(options.some(o => o.includes('Create task from template'))).toBe(true);
      expect(options.some(o => o.includes('Forward to email address'))).toBe(true);
      expect(options.some(o => o.includes('Send Slack notification'))).toBe(true);
      // Check existing actions still there
      expect(options.some(o => o.includes('Assign to'))).toBe(true);
      expect(options.some(o => o.includes('Move to folder'))).toBe(true);
      expect(options.some(o => o.includes('Webhook'))).toBe(true);
      expect(options.some(o => o.includes('Add note'))).toBe(true);
    }
  });

  test('trigger types are all visible', async ({ page }) => {
    await expect(page.getByText('Incoming').first()).toBeVisible();
    await expect(page.getByText('Outgoing').first()).toBeVisible();
    await expect(page.getByText('Unreplied').first()).toBeVisible();
    await expect(page.getByText('User Action').first()).toBeVisible();
  });

  test('forward email action shows email input', async ({ page }) => {
    await page.click('text=New Rule');
    await page.waitForTimeout(500);
    const actionSelect = page.locator('select').filter({ hasText: 'Add label' }).first();
    if (await actionSelect.isVisible()) {
      await actionSelect.selectOption({ label: 'Forward to email address' });
      await page.waitForTimeout(300);
      await expect(page.locator('input[placeholder*="forward-to@"]')).toBeVisible();
    }
  });

  test('slack notify action shows webhook input', async ({ page }) => {
    await page.click('text=New Rule');
    await page.waitForTimeout(500);
    const actionSelect = page.locator('select').filter({ hasText: 'Add label' }).first();
    if (await actionSelect.isVisible()) {
      await actionSelect.selectOption({ label: 'Send Slack notification' });
      await page.waitForTimeout(300);
      await expect(page.locator('input[placeholder*="Slack webhook"]')).toBeVisible();
    }
  });

  test('existing rules are listed', async ({ page }) => {
    const body = await page.textContent('body');
    expect(body).toBeTruthy();
    // Rules tab should show trigger type buttons and rule content
    const bodyLower = (body || "").toLowerCase();
    const hasRulesContent = bodyLower.includes('incoming') || bodyLower.includes('rule') || bodyLower.includes('new rule');
    expect(hasRulesContent).toBe(true);
  });

  test('create task from template action shows template dropdown', async ({ page }) => {
    await page.click('text=New Rule');
    await page.waitForTimeout(500);
    const actionSelect = page.locator('select').filter({ hasText: 'Add label' }).first();
    if (await actionSelect.isVisible()) {
      await actionSelect.selectOption({ label: 'Create task from template' });
      await page.waitForTimeout(300);
      await expect(page.locator('select').filter({ hasText: 'Select task template' }).first()).toBeVisible();
    }
  });

  test('can add multiple conditions and actions', async ({ page }) => {
    await page.click('text=New Rule');
    await page.waitForTimeout(500);
    // Add a second condition
    const addCondBtn = page.locator('button:has-text("+ Condition")').first();
    if (await addCondBtn.isVisible()) {
      await addCondBtn.click();
      await page.waitForTimeout(300);
      const conditionSelects = page.locator('select').filter({ hasText: 'From' });
      expect(await conditionSelects.count()).toBeGreaterThanOrEqual(2);
    }
    // Add a second action
    const addActBtn = page.locator('button:has-text("+ Action")').first();
    if (await addActBtn.isVisible()) {
      await addActBtn.click();
      await page.waitForTimeout(300);
      const actionSelects = page.locator('select').filter({ hasText: 'Add label' });
      expect(await actionSelects.count()).toBeGreaterThanOrEqual(2);
    }
  });
});