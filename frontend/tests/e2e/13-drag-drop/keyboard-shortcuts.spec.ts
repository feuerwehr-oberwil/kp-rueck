import { expect, test } from '../../fixtures/auth.fixture';
import { setupBoard } from '../../helpers/api.helper';

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

test.describe('Kanban shortcuts (live)', () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    // A live board keeps polling; readiness is the rendered board, never network silence.
    await setupBoard(authenticatedPage, 'KbShortcuts', { count: 0 });
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

test.describe('Command palette (live)', () => {
  // Arranged through `setupBoard` rather than by hand, for one reason: it dismisses
  // the Setup-Checkliste popover that opens itself on every newly selected event.
  // That popover is a Radix dismissable layer, and with it up the FIRST Escape
  // closes the popover — the palette stays open and only a second Escape closes it.
  // That is what made "Esc closes it" fail; nothing about the palette had changed.
  test.beforeEach(async ({ authenticatedPage }) => {
    await setupBoard(authenticatedPage, 'CmdPalette', { count: 0 });
  });

  test('Cmd+K opens the palette with shortcut hints, Esc closes it', async ({ authenticatedPage }) => {
    await authenticatedPage.keyboard.press('Meta+k');

    const input = authenticatedPage.getByPlaceholder('Befehl suchen …');
    await expect(input).toBeVisible({ timeout: 3000 });
    // Shortcut hints are folded into the palette entries
    await expect(
      authenticatedPage.getByRole('dialog').getByText('Neuer Einsatz'),
    ).toBeVisible();

    await authenticatedPage.keyboard.press('Escape');
    await expect(input).not.toBeVisible({ timeout: 3000 });
  });

  // Was "? no longer opens anything". `?` is now the second way into the command
  // palette — `useKanbanShortcuts` calls `openCommandPalette()` on it, and its own
  // vitest suite asserts exactly that ("'?' opens the command palette"). The old
  // E2E test asserted the opposite of the shipped, unit-tested intent: the separate
  // shortcuts-help dialog it was written against is gone, and the palette replaced it.
  test('? opens the command palette', async ({ authenticatedPage }) => {
    await authenticatedPage.keyboard.press('?');
    await expect(authenticatedPage.getByPlaceholder('Befehl suchen …')).toBeVisible({
      timeout: 3000,
    });
  });

  test('? inside the search field types instead of opening the palette', async ({
    authenticatedPage,
  }) => {
    const searchInput = authenticatedPage.locator('#search-input');
    await searchInput.click();
    await authenticatedPage.keyboard.press('?');

    await expect(authenticatedPage.getByPlaceholder('Befehl suchen …')).toHaveCount(0);
    await expect(searchInput).toHaveValue('?');
  });
});
