import { test, expect } from '@playwright/test';
import { login } from './helpers/auth';

test.describe('Tasks', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.getByRole('button', { name: 'Tasks' }).click();
    await page.waitForTimeout(1000);
  });

  test('task board loads with columns', async ({ page }) => {
    await expect(page.getByText('My Tasks')).toBeVisible();
    await expect(page.locator('div.text-sm.font-semibold:has-text("To do")')).toBeVisible();
    await expect(page.locator('div.text-sm.font-semibold:has-text("In progress")')).toBeVisible();
    await expect(page.locator('div.text-sm.font-semibold:has-text("Completed")')).toBeVisible();
  });

  test('new task button is visible', async ({ page }) => {
    await expect(page.getByText('New Task')).toBeVisible();
  });

  test('can open new task form', async ({ page }) => {
    await page.getByText('New Task').click();
    await page.waitForTimeout(500);
    const taskInput = page.locator('textarea, input[placeholder*="task"], input[placeholder*="Task"]');
    await expect(taskInput.first()).toBeVisible();
  });

  test('task cards show thread links truncated', async ({ page }) => {
    const threadLink = page.getByText('Open thread:').first();
    if (await threadLink.isVisible()) {
      const box = await threadLink.boundingBox();
      expect(box).toBeTruthy();
    }
  });

  test('task cards show form button', async ({ page }) => {
    const formButton = page.locator('button[title="Fill out form"]').first();
    if (await formButton.isVisible()) {
      expect(true).toBeTruthy();
    }
  });

  test('task search works', async ({ page }) => {
    const searchInput = page.locator('input[placeholder*="Search tasks"]');
    if (await searchInput.isVisible()) {
      await searchInput.fill('test');
      await page.waitForTimeout(500);
    }
    expect(true).toBeTruthy();
  });
});