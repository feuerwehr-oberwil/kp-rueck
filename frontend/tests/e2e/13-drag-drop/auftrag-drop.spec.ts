import { test, expect } from '../../fixtures/auth.fixture';
import { DragDropHelper } from '../../helpers/drag-drop.helper';
import {
  cookieHeaderFor,
  createGroup,
  deleteEvent,
  getIncident,
  setupBoard,
  type BoardFixture,
} from '../../helpers/api.helper';

/**
 * A board card dragged onto an Auftrag while the Aufträge sheet is open becomes a stop.
 *
 * The sheet's backdrop absorbs the pointer so the dimmed board stays quiet; it lets the pointer
 * through only onto the card under it (lib/backdrop-hole.ts, owner pick A 26.11.2026). Before,
 * the press landed on the backdrop and the card could not be grabbed at all. The backend is the
 * assertion: the incident carries the Auftrag's id.
 */

test.use({ viewport: { width: 1920, height: 1080 } });

let board: BoardFixture;

test.beforeEach(async ({ authenticatedPage: page }) => {
  board = await setupBoard(page, 'Auftragsdrop');
});

test.afterEach(async ({ authenticatedPage: page }) => {
  await deleteEvent(page.request, await cookieHeaderFor(page), board.eventId);
});

test('a card dragged onto an Auftrag in the open sheet becomes its stop', async ({ authenticatedPage: page }) => {
  const cookieHeader = await cookieHeaderFor(page);
  const group = await createGroup(page.request, cookieHeader, board.eventId, 'Keller auspumpen');
  const incidentId = board.incidents[0].id;

  await page.locator('footer').getByRole('button', { name: 'Aufträge' }).first().click();
  const header = page
    .locator('[data-slot="sheet-content"] [role="button"][aria-label="Auftrag auf-/zuklappen"]')
    .filter({ hasText: group.name });
  await expect(header).toBeVisible({ timeout: 15_000 });

  // Point at the card first: the backdrop opens over it on the next animation frame.
  const card = page.locator(`[data-incident-id="${incidentId}"]`);
  const box = (await card.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));

  await new DragDropHelper(page).dragAndDrop(card, header);

  await expect.poll(async () => (await getIncident(page.request, cookieHeader, incidentId)).group_id).toBe(group.id);
  // the sheet is still open: pressing the card did not dismiss it
  await expect(header).toBeVisible();
});
