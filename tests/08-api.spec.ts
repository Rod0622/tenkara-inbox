import { test, expect } from '@playwright/test';

test.describe('API Endpoints', () => {
  const baseUrl = process.env.PLAYWRIGHT_BASE_URL || 'https://tenkara-inbox-nine.vercel.app';

  test('sync cron endpoint responds', async ({ request }) => {
    const res = await request.get(`${baseUrl}/api/cron/sync`);
    expect(res.status()).toBeLessThan(500);
  });

  test('follow-up cron endpoint responds', async ({ request }) => {
    const res = await request.get(`${baseUrl}/api/cron/follow-up`, { timeout: 55000 });
    expect(res.status()).toBeLessThan(500);
  });

  test('rules API returns rules', async ({ request }) => {
    const res = await request.get(`${baseUrl}/api/rules`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toHaveProperty('rules');
    expect(Array.isArray(body.rules)).toBeTruthy();
  });

  test('forms API returns forms', async ({ request }) => {
    const res = await request.get(`${baseUrl}/api/forms`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toHaveProperty('forms');
  });

  test('drafts API returns drafts', async ({ request }) => {
    const res = await request.get(`${baseUrl}/api/drafts`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toHaveProperty('drafts');
  });

  test('search API works', async ({ request }) => {
    const res = await request.get(`${baseUrl}/api/search?q=test`);
    expect(res.ok()).toBeTruthy();
  });

  test('export API returns data', async ({ request }) => {
    const res = await request.get(`${baseUrl}/api/export?dataset=conversations`);
    expect(res.status()).toBeLessThan(500);
  });
});