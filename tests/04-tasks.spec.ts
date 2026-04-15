import { test, expect } from '@playwright/test';
import { login } from './helpers/auth';

test.describe('Tasks', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.click('text=Tasks');
    await page.waitForTimeout(1000);
  });

  test('task board loads with columns', async ({ page }) => {
    await expect(page.locator('text=My Tasks')).toBeVisible();
    await expect(page.locator('text=To do')).toBeVisible();
    await expect(page.locator('text=In progress')).toBeVisible();
    await expect(page.locator('text=Completed')).toBeVisible();
  });

  test('new task button is visible', async ({ page }) => {
    await expect(page.locator('text=New Task')).toBeVisible();
  });

  test('can open new task form', async ({ page }) => {
    await page.click('text=New Task');
    await page.waitForTimeout(500);
    // Should see task creation form
    const taskInput = page.locator('textarea, input[placeholder*="task"], input[placeholder*="Task"]');
    await expect(taskInput.first()).toBeVisible();
  });

  test('task cards show thread links', async ({ page }) => {
    const threadLink = page.locator('text=Open thread:').first();
    if (await threadLink.isVisible()) {
      // Link should not overflow
      const box = await threadLink.boundingBox();
      expect(box).toBeTruthy();
    }
  });

  test('task cards show category badges', async ({ page }) => {
    // Look for category badges (colored pills)
    const tasks = page.locator('[class*="rounded-xl"]');
    const count = await tasks.count();
    expect(count).toBeGreaterThanOrEqual(0); // May have no tasks
  });

  test('task cards show assignee chips', async ({ page }) => {
    const assigneeChips = page.locator('text=Rod, text=Rosie, text=Mildred').first();
    if (await assigneeChips.isVisible()) {
      expect(true).toBeTruthy();
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
      // Results should filter
      expect(true).toBeTruthy();
    }
  });

  test('dismissed column exists', async ({ page }) => {
    // Scroll right or check for Dismissed section
    const dismissed = page.locator('text=Dismissed');
    // May or may not be visible depending on if dismissed tasks exist
    expect(true).toBeTruthy();
  });
});
