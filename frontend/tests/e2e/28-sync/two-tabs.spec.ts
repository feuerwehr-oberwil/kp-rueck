import { test, expect } from '../../fixtures/auth.fixture';
import type { Page } from '@playwright/test';
import { cookieHeaderFor, deleteEvent, dismissOverlays, selectEvent, setupBoard } from '../../helpers/api.helper';

/**
 * Two boards on one Ereignis: what one of them changes, the other shows.
 *
 * The command post runs the board on more than one screen, and a status change
 * that only reached the screen it was made on would put two different
 * situations on the wall. Over the socket this is near-instant; the polling
 * fallback runs every ~5 s. Ten seconds is the promise either way.
 *
 * Pinned before the board and its provider were split (2026-09-23).
 */

test.use({ viewport: { width: 1920, height: 1080 } });

const SYNC_MS = 10_000;

test('a status change on one board reaches the other within ten seconds', async ({
  authenticatedPage: a,
  browser,
  authCookies,
}) => {
  // Two full boards plus their setup: well past the 30 s default.
  test.setTimeout(120_000);
  const board = await setupBoard(a, 'Zweischirm');
  const incidentId = board.incidents[0].id;
  const cardIn = (page: Page, column: string) =>
    page.locator(`[data-column="${column}"] [data-incident-id="${incidentId}"]`);

  const contextB = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  try {
    await contextB.addCookies(authCookies);
    const b = await contextB.newPage();
    await selectEvent(b, '/', board.eventId);
    await expect(cardIn(b, 'incoming')).toBeVisible({ timeout: 20_000 });
    await dismissOverlays(b);

    // A: select the card and move it one column on (the `.` key). A then asks
    // about the missing Reko person — that dialog is A's, not B's business.
    await a.locator(`[data-incident-id="${incidentId}"]`).click();
    await a.keyboard.press('.');
    await expect(cardIn(a, 'reko')).toBeAttached();

    await expect(cardIn(b, 'reko')).toBeAttached({ timeout: SYNC_MS });
    await expect(cardIn(b, 'incoming')).toHaveCount(0);

    // And back the other way: B moves it on, A follows.
    await b.keyboard.press('Escape');
    await b.locator(`[data-incident-id="${incidentId}"]`).click();
    await b.keyboard.press('.');
    await expect(cardIn(b, 'reko_done')).toBeAttached();
    await expect(cardIn(a, 'reko_done')).toBeAttached({ timeout: SYNC_MS });
  } finally {
    await contextB.close();
    await deleteEvent(a.request, await cookieHeaderFor(a), board.eventId);
  }
});
