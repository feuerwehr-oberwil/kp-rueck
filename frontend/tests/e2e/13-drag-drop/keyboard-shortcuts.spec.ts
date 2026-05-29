import { expect, test } from '../../fixtures/auth.fixture';

/**
 * Kanban keyboard shortcut E2E coverage.
 *
 * Locks in the keyboard handler we lifted out of page.tsx into
 * `useKanbanShortcuts` during the A2.6 refactor. The hook has 21
 * vitest cases of its own; this spec verifies the wiring end-to-end
 * through the live React app — login, event creation, kanban shell.
 *
 * Setup talks to the backend REST API directly to create an event +
 * incident and seed localStorage's `kp-rueck-selected-event` key,
 * skipping the events/main POMs (which have drifted from the live UI).
 */

const SELECTED_EVENT_KEY = 'kp-rueck-selected-event';

test.describe('Kanban shortcuts (live)', () => {
  let eventId: string;

  test.beforeEach(async ({ authenticatedPage, request }) => {
    // Create a test event via the API (auth cookie carries over from fixture).
    const cookies = await authenticatedPage.context().cookies();
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
    const apiBase = 'http://localhost:8000';

    const eventResp = await request.post(`${apiBase}/api/events/`, {
      headers: { 'Content-Type': 'application/json', cookie: cookieHeader },
      data: { name: `KbShortcuts ${Date.now()}`, training_flag: true },
    });
    expect(eventResp.ok()).toBeTruthy();
    const event = await eventResp.json();
    eventId = event.id;

    // Seed localStorage so the EventContext picks up the selection on mount.
    await authenticatedPage.goto('/');
    await authenticatedPage.evaluate(
      ([key, id]) => window.localStorage.setItem(key, id),
      [SELECTED_EVENT_KEY, eventId] as const,
    );
    await authenticatedPage.reload();
    await authenticatedPage.waitForLoadState('networkidle');
    // Give the kanban shell a beat to mount + register the keyboard handler.
    await authenticatedPage.waitForTimeout(800);
  });

  test('N opens the new-emergency modal', async ({ authenticatedPage }) => {
    await authenticatedPage.keyboard.press('n');
    await expect(
      authenticatedPage.locator('[role="dialog"]', { hasText: /neuer einsatz|neue meldung/i }),
    ).toBeVisible({ timeout: 3000 });
  });

  test('/ focuses the global search input', async ({ authenticatedPage }) => {
    const searchInput = authenticatedPage.locator('#search-input');
    await searchInput.waitFor({ state: 'visible', timeout: 5000 });
    await authenticatedPage.keyboard.press('/');
    await expect(searchInput).toBeFocused({ timeout: 2000 });
  });

  test('R triggers the refresh-status toast', async ({ authenticatedPage }) => {
    await authenticatedPage.keyboard.press('r');
    await expect(
      authenticatedPage.locator('text=/aktualisier/i').first(),
    ).toBeVisible({ timeout: 3000 });
  });

  test('Cmd+N does NOT open the new-emergency modal (lets browser keep its binding)', async ({
    authenticatedPage,
  }) => {
    await authenticatedPage.keyboard.press('Meta+n');
    await authenticatedPage.waitForTimeout(500);
    await expect(
      authenticatedPage.locator('[role="dialog"]', { hasText: /neuer einsatz|neue meldung/i }),
    ).toHaveCount(0);
  });
});
