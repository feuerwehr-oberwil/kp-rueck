import { test, expect } from '../../fixtures/auth.fixture';
import type { Page } from '@playwright/test';
import {
  cookieHeaderFor,
  createGroup,
  deleteEvent,
  getIncident,
  setIncidentStatus,
  setupBoard,
  type BoardFixture,
} from '../../helpers/api.helper';

/**
 * «An Auftrag verteilen» — a card becomes a stop on a route.
 *
 * From the card's context menu, through the route picker. An ordinary card goes
 * in at once and says so; a card that is already disponiert asks first, because
 * folding a dispatched Einsatz into a route has no undo — cancelling there
 * must leave it where it was.
 *
 * Pinned before the board page was split (2026-09-23): the picker, the
 * ask-first dialog and the distribute call all live in the page.
 */

test.use({ viewport: { width: 1920, height: 1080 } });

let board: BoardFixture;
let group: { id: string; name: string };

test.beforeEach(async ({ authenticatedPage: page }) => {
  board = await setupBoard(page, 'Verteilen', { count: 2 });
  group = await createGroup(page.request, await cookieHeaderFor(page), board.eventId, `Route ${Date.now()}`);
});

test.afterEach(async ({ authenticatedPage: page }) => {
  await deleteEvent(page.request, await cookieHeaderFor(page), board.eventId);
});

async function distribute(page: Page, incidentId: string) {
  await page.locator(`[data-incident-id="${incidentId}"]`).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'An Auftrag verteilen' }).click();
  const picker = page.getByRole('dialog', { name: 'An Auftrag verteilen' });
  await expect(picker).toBeVisible();
  await picker.getByRole('button', { name: new RegExp(group.name) }).click();
}

async function groupOf(page: Page, incidentId: string) {
  return (await getIncident(page.request, await cookieHeaderFor(page), incidentId)).group_id;
}

test('an ordinary card goes into the route at once', async ({ authenticatedPage: page }) => {
  const incidentId = board.incidents[0].id;
  await distribute(page, incidentId);
  await expect(page.getByText(`In Auftrag «${group.name}» verteilt`)).toBeVisible();
  await expect.poll(() => groupOf(page, incidentId)).toBe(group.id);
});

test('a disponierter card asks first; cancelling leaves it out', async ({ authenticatedPage: page }) => {
  const incidentId = board.incidents[1].id;
  await setIncidentStatus(page.request, await cookieHeaderFor(page), incidentId, 'incoming', 'enroute');
  await expect(page.locator(`[data-column="enroute"] [data-incident-id="${incidentId}"]`)).toBeAttached({
    timeout: 20_000,
  });

  await distribute(page, incidentId);
  const confirm = page.getByRole('alertdialog', { name: 'In Auftrag aufnehmen?' });
  await expect(confirm).toContainText('ist bereits disponiert');
  await confirm.getByRole('button', { name: 'Abbrechen' }).click();
  await expect(confirm).toBeHidden();
  expect(await groupOf(page, incidentId)).toBeNull();

  await distribute(page, incidentId);
  await page.getByRole('alertdialog', { name: 'In Auftrag aufnehmen?' }).getByRole('button', { name: 'Ja, aufnehmen' }).click();
  await expect(page.getByText(`In Auftrag «${group.name}» verteilt`)).toBeVisible();
  await expect.poll(() => groupOf(page, incidentId)).toBe(group.id);
});
