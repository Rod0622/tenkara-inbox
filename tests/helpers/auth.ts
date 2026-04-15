import { Page, expect } from '@playwright/test';

/**
 * Login helper — authenticates and waits for inbox to load
 */
export async function login(page: Page, email?: string, password?: string) {
  const userEmail = email || process.env.TEST_USER_EMAIL || 'rod@test.com';
  const userPassword = password || process.env.TEST_USER_PASSWORD || 'testpassword123';

  await page.goto('/');
  
  // If already logged in, skip
  const url = page.url();
  if (!url.includes('login') && !url.includes('signin')) {
    // Check if we see the inbox
    try {
      await page.waitForSelector('text=MY WORKSPACE', { timeout: 5000 });
      return; // Already logged in
    } catch {
      // Not logged in, continue
    }
  }

  // Fill login form
  await page.fill('input[type="email"], input[name="email"]', userEmail);
  await page.fill('input[type="password"], input[name="password"]', userPassword);
  await page.click('button[type="submit"], button:has-text("Sign in"), button:has-text("Login")');

  // Wait for inbox to load
  await page.waitForSelector('text=MY WORKSPACE', { timeout: 15000 });
}

/**
 * Navigate to a specific view
 */
export async function navigateTo(page: Page, view: 'inbox' | 'tasks' | 'drafts' | 'sent' | 'dashboard' | 'settings') {
  if (view === 'dashboard') {
    await page.click('a:has-text("Dashboard")');
  } else if (view === 'settings') {
    await page.click('a:has-text("Settings")');
  } else {
    await page.click(`text=${view.charAt(0).toUpperCase() + view.slice(1)}`);
  }
  await page.waitForTimeout(1000);
}

/**
 * Open a conversation by clicking on it in the list
 */
export async function openConversation(page: Page, subjectContains: string) {
  await page.click(`text=${subjectContains}`);
  await page.waitForTimeout(1000);
}

/**
 * Wait for sync to complete (check for sync spinner)
 */
export async function waitForSync(page: Page) {
  try {
    await page.waitForSelector('.animate-spin', { state: 'detached', timeout: 30000 });
  } catch {
    // Sync might have already completed
  }
}

/**
 * Click a settings tab
 */
export async function openSettingsTab(page: Page, tab: string) {
  await navigateTo(page, 'settings');
  await page.click(`text=${tab}`);
  await page.waitForTimeout(500);
}

/**
 * Get the count shown next to a sidebar item
 */
export async function getSidebarCount(page: Page, item: string): Promise<number> {
  const el = page.locator(`text=${item}`).locator('..').locator('span').last();
  const text = await el.textContent().catch(() => '0');
  return parseInt(text || '0') || 0;
}

/**
 * Check if a toast/notification appears
 */
export async function expectToast(page: Page, text: string) {
  await expect(page.locator(`text=${text}`)).toBeVisible({ timeout: 5000 });
}
