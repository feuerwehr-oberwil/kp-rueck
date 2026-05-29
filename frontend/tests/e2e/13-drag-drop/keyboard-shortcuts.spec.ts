import { expect, test } from '../../fixtures/auth.fixture';
import { EventsPage } from '../../pages/events.page';
import { MainPage } from '../../pages/main.page';

/**
 * Kanban keyboard shortcut E2E coverage.
 *
 * Locks in the keyboard handler we lifted out of page.tsx into
 * `useKanbanShortcuts` during the A2.6 refactor. The hook has 21
 * unit tests of its own; this spec verifies the wiring end-to-end
 * through the live React app, the operations context, and the
 * backend assignment API.
 */

let eventsPage: EventsPage;
let mainPage: MainPage;

test.describe('Kanban shortcuts — hovered-operation paths', () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    eventsPage = new EventsPage(authenticatedPage);
    mainPage = new MainPage(authenticatedPage);

    const eventName = `KbShortcuts ${Date.now()}`;
    await eventsPage.goto();
    await eventsPage.createEvent(eventName);
    await eventsPage.goto();
    await eventsPage.selectEvent(eventName);
    await expect(authenticatedPage).toHaveURL('/');
    await authenticatedPage.waitForTimeout(800);

    await mainPage.createQuickIncident(`Bahnhof ${Date.now()}`);
    await authenticatedPage.waitForTimeout(500);
  });

  test('Shift+3 sets the hovered incident to high priority', async ({ authenticatedPage }) => {
    const card = authenticatedPage.locator('[data-testid="incident-card"]').first();
    await card.hover();
    await authenticatedPage.waitForTimeout(100);

    await authenticatedPage.keyboard.press('Shift+3');
    await authenticatedPage.waitForTimeout(400);

    // The high-priority pulse animation is keyed off the priority — the card
    // gains the `priority-high-pulse` class as soon as the update lands.
    await expect(card).toHaveClass(/priority-high-pulse/, { timeout: 2000 });
  });

  test('Shift+1 returns priority to low', async ({ authenticatedPage }) => {
    const card = authenticatedPage.locator('[data-testid="incident-card"]').first();
    await card.hover();
    await authenticatedPage.waitForTimeout(100);
    await authenticatedPage.keyboard.press('Shift+3');
    await authenticatedPage.waitForTimeout(300);
    await expect(card).toHaveClass(/priority-high-pulse/, { timeout: 2000 });

    await card.hover();
    await authenticatedPage.keyboard.press('Shift+1');
    await authenticatedPage.waitForTimeout(400);
    await expect(card).not.toHaveClass(/priority-high-pulse/, { timeout: 2000 });
  });

  test("'>' advances the hovered incident to the next status column", async ({ authenticatedPage }) => {
    const card = authenticatedPage.locator('[data-testid="incident-card"]').first();
    const cardId = await card.getAttribute('data-incident-id');
    expect(cardId).not.toBeNull();

    // Incident starts in "Eingegangen" column (first column).
    const eingegangenColumn = authenticatedPage.locator('[data-column="eingegangen"]');
    await expect(eingegangenColumn.locator(`[data-incident-id="${cardId}"]`)).toBeVisible();

    await card.hover();
    await authenticatedPage.waitForTimeout(100);
    await authenticatedPage.keyboard.press('.');
    await authenticatedPage.waitForTimeout(500);

    // After '>' (or '.') the card should leave Eingegangen and land in the
    // next column. We don't care which column specifically, only that the
    // card moved out of where it started.
    await expect(eingegangenColumn.locator(`[data-incident-id="${cardId}"]`)).toHaveCount(0, {
      timeout: 2000,
    });
  });
});

test.describe('Kanban shortcuts — standalone keys', () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    eventsPage = new EventsPage(authenticatedPage);
    mainPage = new MainPage(authenticatedPage);

    const eventName = `KbStandalone ${Date.now()}`;
    await eventsPage.goto();
    await eventsPage.createEvent(eventName);
    await eventsPage.goto();
    await eventsPage.selectEvent(eventName);
    await expect(authenticatedPage).toHaveURL('/');
    await authenticatedPage.waitForTimeout(800);
  });

  test('N opens the new-emergency modal', async ({ authenticatedPage }) => {
    await authenticatedPage.keyboard.press('n');
    await expect(
      authenticatedPage.locator('[role="dialog"]', { hasText: /neuer einsatz|neue meldung/i }),
    ).toBeVisible({ timeout: 2000 });
  });

  test('/ focuses the global search input', async ({ authenticatedPage }) => {
    await authenticatedPage.keyboard.press('/');
    const focusedId = await authenticatedPage.evaluate(() => document.activeElement?.id);
    expect(focusedId).toBe('search-input');
  });

  test('R triggers a refresh and shows the success toast', async ({ authenticatedPage }) => {
    await authenticatedPage.keyboard.press('r');
    // Either the loading toast or the success toast briefly appears.
    const toast = authenticatedPage.locator('text=/aktualisier/i').first();
    await expect(toast).toBeVisible({ timeout: 3000 });
  });

  test('Cmd+N does NOT open the new-emergency modal (lets browser handle it)', async ({
    authenticatedPage,
  }) => {
    await authenticatedPage.keyboard.press('Meta+n');
    await authenticatedPage.waitForTimeout(500);
    await expect(
      authenticatedPage.locator('[role="dialog"]', { hasText: /neuer einsatz|neue meldung/i }),
    ).toHaveCount(0);
  });
});
