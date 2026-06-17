import { test, expect, Browser } from '@playwright/test';

/**
 * Demo Sandbox Tests
 *
 * Each demo-editor login creates a personal sandbox event so simultaneous
 * demo visitors don't fight over the same board.
 *
 * Requires the backend to run with DEMO_MODE=true — the whole suite is
 * skipped when /api/demo/status reports demo: false.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

let demoMode = false;

test.beforeAll(async ({ request }) => {
  try {
    const response = await request.get(`${API_URL}/api/demo/status`);
    const body = await response.json();
    demoMode = body?.demo === true;
  } catch {
    demoMode = false;
  }
});

test.beforeEach(() => {
  test.skip(!demoMode, 'Backend is not running in demo mode (DEMO_MODE=true required)');
});

async function demoEditorLogin(browser: Browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/login');
  await page.getByRole('button', { name: /Als Editor einloggen/i }).click();
  await page.waitForURL('/');
  return { context, page };
}

test.describe('Demo Sandbox', () => {
  test('demo-editor login lands on a populated board', async ({ browser }) => {
    const { context, page } = await demoEditorLogin(browser);

    // No event-selection empty state — a board with cards is visible
    await expect(page.getByText(/Kein Ereignis ausgewählt/i)).not.toBeVisible();
    const cards = page.locator('[data-incident-id]');
    await expect(cards.first()).toBeVisible({ timeout: 15_000 });

    // The selected event is a personal sandbox
    await expect(page.getByText(/Demo-Lage #/i).first()).toBeVisible();

    await context.close();
  });

  test('two visitors get independent sandboxes', async ({ browser }) => {
    const first = await demoEditorLogin(browser);
    const second = await demoEditorLogin(browser);

    const firstName = await first.page.getByText(/Demo-Lage #[0-9a-f]{4}/i).first().textContent();
    const secondName = await second.page.getByText(/Demo-Lage #[0-9a-f]{4}/i).first().textContent();

    expect(firstName).toBeTruthy();
    expect(secondName).toBeTruthy();
    expect(firstName).not.toEqual(secondName);

    await first.context.close();
    await second.context.close();
  });
});
