import { test, expect } from '../../fixtures/auth.fixture';
import {
  assignPersonnel,
  assignResource,
  assignmentsByEvent,
  checkInForEvent,
  cookieHeaderFor,
  createPersonnel,
  deleteEvent,
  deletePersonnel,
  listVehicles,
  setupBoard,
  type BoardFixture,
  type TestPersonnel,
} from '../../helpers/api.helper';

/**
 * «Ressourcen übertragen» — a whole crew and its vehicle move to another card.
 *
 * There is no undo, so the dialog picks the target and a second question names
 * both incidents and counts what moves before anything happens. Afterwards the
 * source carries nothing and the target carries all of it.
 *
 * Pinned before the board page was split (2026-09-23): the page loads the
 * targets and runs the transfer.
 */

test.use({ viewport: { width: 1920, height: 1080 } });

let board: BoardFixture;
let person: TestPersonnel;
let vehicleId: string;

test.beforeEach(async ({ authenticatedPage: page }) => {
  board = await setupBoard(page, 'Uebertrag', { count: 2 });
  const cookieHeader = await cookieHeaderFor(page);
  person = await createPersonnel(page.request, cookieHeader, `Transfer ${Date.now()}`);
  await checkInForEvent(page.request, cookieHeader, person.id, board.eventId);
  await assignPersonnel(page.request, cookieHeader, board.incidents[0].id, person.id);
  const vehicle = (await listVehicles(page.request, cookieHeader)).find((v) => !v.out_of_service)!;
  vehicleId = vehicle.id;
  await assignResource(page.request, cookieHeader, board.incidents[0].id, 'vehicle', vehicleId);
  await expect(page.locator(`[data-incident-id="${board.incidents[0].id}"]`)).toContainText(vehicle.name, {
    timeout: 20_000,
  });
});

test.afterEach(async ({ authenticatedPage: page }) => {
  const cookieHeader = await cookieHeaderFor(page);
  await deleteEvent(page.request, cookieHeader, board.eventId);
  await deletePersonnel(page.request, cookieHeader, person.id);
});

test('moves every assignment to the chosen card, after saying what moves', async ({ authenticatedPage: page }) => {
  const [source, target] = board.incidents;
  await page.locator(`[data-incident-id="${source.id}"]`).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Ressourcen übertragen' }).click();

  const dialog = page.getByRole('dialog', { name: 'Ressourcen übertragen' });
  await expect(dialog).toBeVisible();
  // The source is never offered as its own target.
  await expect(dialog.getByRole('button', { name: new RegExp(`${board.address} 1`) })).toHaveCount(0);
  await dialog.getByRole('button', { name: new RegExp(`${board.address} 2`) }).click();
  await dialog.getByRole('button', { name: 'Übertragen' }).click();

  const confirm = page.getByRole('alertdialog', { name: 'Ressourcen wirklich übertragen?' });
  await expect(confirm).toContainText('Es werden verschoben: 1 Personal, 1 Fahrzeuge, 0 Material.');
  await confirm.getByRole('button', { name: 'Übertragen' }).click();

  await expect(page.getByText('Ressourcen übertragen').last()).toBeVisible();
  await expect
    .poll(async () => {
      const byIncident = await assignmentsByEvent(page.request, await cookieHeaderFor(page), board.eventId);
      return {
        source: (byIncident[source.id] ?? []).length,
        target: (byIncident[target.id] ?? []).map((a) => a.resource_id).sort(),
      };
    })
    .toEqual({ source: 0, target: [person.id, vehicleId].sort() });
  await expect(page.locator(`[data-incident-id="${source.id}"]`)).not.toContainText(person.name);
});

test('cancelling the question moves nothing', async ({ authenticatedPage: page }) => {
  const [source] = board.incidents;
  await page.locator(`[data-incident-id="${source.id}"]`).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Ressourcen übertragen' }).click();
  const dialog = page.getByRole('dialog', { name: 'Ressourcen übertragen' });
  await dialog.getByRole('button', { name: new RegExp(`${board.address} 2`) }).click();
  await dialog.getByRole('button', { name: 'Übertragen' }).click();
  const confirm = page.getByRole('alertdialog', { name: 'Ressourcen wirklich übertragen?' });
  await confirm.getByRole('button', { name: 'Abbrechen' }).click();
  await expect(confirm).toBeHidden();

  const byIncident = await assignmentsByEvent(page.request, await cookieHeaderFor(page), board.eventId);
  expect((byIncident[source.id] ?? []).map((a) => a.resource_id).sort()).toEqual([person.id, vehicleId].sort());
});
