import { test, expect } from '../../fixtures/auth.fixture';
import { DragDropHelper } from '../../helpers/drag-drop.helper';
import {
  cookieHeaderFor,
  deleteEvent,
  getIncident,
  setupBoard,
  type BoardFixture,
} from '../../helpers/api.helper';

/**
 * Dragging a card into another column is a status change, and it has to stick.
 *
 * The board applies the move optimistically, so a card that "moved" on screen
 * proves nothing on its own — the reload is the assertion. Into «Einsatz» on
 * purpose: of the columns a card can be dragged into, it is the one the status
 * workflow raises no follow-up dialog for, so the drop is the whole story.
 *
 * Pinned before the board page was split (2026-09-23): the drop callbacks are
 * wired in the page.
 */

test.use({ viewport: { width: 1920, height: 1080 } });

// Fold every column between «Eingegangen» and «Einsatz», so source and target
// are both on screen: a pointer drag cannot scroll the board to reach a column.
const FOLDED = ['reko', 'reko_done', 'enroute', 'returning', 'complete'];

let board: BoardFixture;

test.beforeEach(async ({ authenticatedPage: page }) => {
  await page.addInitScript((folded) => {
    window.localStorage.setItem('kp-board-columns-collapsed', JSON.stringify(folded));
  }, FOLDED);
  board = await setupBoard(page, 'Spaltenwechsel');
});

test.afterEach(async ({ authenticatedPage: page }) => {
  await deleteEvent(page.request, await cookieHeaderFor(page), board.eventId);
});

test('a card dragged into «Einsatz» is still there after a reload', async ({ authenticatedPage: page }) => {
  const incidentId = board.incidents[0].id;
  const cardIn = (column: string) => page.locator(`[data-column="${column}"] [data-incident-id="${incidentId}"]`);

  await expect(cardIn('incoming')).toBeVisible();
  await new DragDropHelper(page).dragAndDrop(
    page.locator(`[data-incident-id="${incidentId}"]`),
    page.locator('[data-column="active"]'),
  );
  await expect(cardIn('active')).toBeVisible();

  // Persisted, not just painted.
  const cookieHeader = await cookieHeaderFor(page);
  await expect.poll(async () => (await getIncident(page.request, cookieHeader, incidentId)).status).toBe('active');

  await page.reload();
  await expect(cardIn('active')).toBeVisible({ timeout: 20_000 });
  await expect(cardIn('incoming')).toHaveCount(0);
});
