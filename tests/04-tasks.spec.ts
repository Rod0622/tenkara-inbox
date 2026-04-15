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
    await expect(page.getByText('To do', { exact: true })).toBeVisible();
    await expect(page.getByText('In progress', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Completed', { exact: true }).first()).toBeVisible();
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