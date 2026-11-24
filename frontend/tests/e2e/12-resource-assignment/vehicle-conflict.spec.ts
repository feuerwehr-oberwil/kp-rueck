import { test, expect } from '../../fixtures/auth.fixture';
import {
  API_BASE,
  assignResource,
  assignmentsByEvent,
  cookieHeaderFor,
  deleteEvent,
  listVehicles,
  setupBoard,
  type BoardFixture,
  type TestVehicle,
} from '../../helpers/api.helper';

/**
 * A vehicle is one physical thing: putting the TLF on a second Einsatz asks.
 *
 * The number keys quick-assign the fleet to the SELECTED card. When the vehicle
 * already stands on another card of this Ereignis the board raises «TLF ist
 * schon im Einsatz» naming where it is («Bisher») and where it is going
 * («neu»), and the operator picks a card by hand (owner pick 2B, 24.11.2026 – never on two):
 * «Jetzt verschieben» takes it off the first card, «Danach vormerken» plans it for the second.
 * Once the first card lets it go, the second card's band says «DANACH · JETZT FREI» and
 * «Zuteilen» puts it there. Enter and Esc change nothing (owner pick #3, 23.11.2026).
 *
 * Pinned before the board page was split (2026-09-23): the quick-assign path
 * runs through the page's own conflict wrappers, not only the provider's.
 */

// Wide enough for the side panel: a click selects the card without a modal,
// and an open modal would swallow the number key.
test.use({ viewport: { width: 1920, height: 1080 } });

let board: BoardFixture;
let vehicle: TestVehicle;

test.beforeEach(async ({ authenticatedPage: page }) => {
  board = await setupBoard(page, 'Konflikt', { count: 2 });
  const cookieHeader = await cookieHeaderFor(page);
  const fleet = (await listVehicles(page.request, cookieHeader)).filter((v) => !v.out_of_service);
  // The number key is the vehicle's display order; keep to one digit.
  vehicle = fleet.find((v) => v.display_order >= 1 && v.display_order <= 9)!;
  expect(vehicle, 'the dev fleet needs a vehicle with display order 1–9').toBeTruthy();
  await assignResource(page.request, cookieHeader, board.incidents[0].id, 'vehicle', vehicle.id);
  await expect(card(page, 0)).toContainText(vehicle.name, { timeout: 20_000 });
});

test.afterEach(async ({ authenticatedPage: page }) => {
  // Deleting the Ereignis releases the vehicle for the next spec.
  await deleteEvent(page.request, await cookieHeaderFor(page), board.eventId);
});

function card(page: import('@playwright/test').Page, index: number) {
  return page.locator(`[data-incident-id="${board.incidents[index].id}"]`);
}

async function quickAssignToSecondCard(page: import('@playwright/test').Page) {
  await card(page, 1).click();
  await page.keyboard.press(String(vehicle.display_order));
  const prompt = page.getByRole('alertdialog', { name: `${vehicle.name} ist schon im Einsatz` });
  await expect(prompt).toBeVisible();
  await expect(prompt).toContainText('Bisher');
  await expect(prompt).toContainText(`${board.address} 1`);
  return prompt;
}

async function vehicleHolders(page: import('@playwright/test').Page): Promise<string[]> {
  const byIncident = await assignmentsByEvent(page.request, await cookieHeaderFor(page), board.eventId);
  return Object.entries(byIncident)
    .filter(([, rows]) => rows.some((row) => row.resource_type === 'vehicle' && row.resource_id === vehicle.id))
    .map(([incidentId]) => incidentId)
    .sort();
}

test('«Jetzt verschieben» moves the vehicle off the first card', async ({ authenticatedPage: page }) => {
  const prompt = await quickAssignToSecondCard(page);
  await prompt.getByRole('button', { name: 'Jetzt verschieben' }).click();
  await expect(prompt).toBeHidden();

  await expect(card(page, 1)).toContainText(vehicle.name);
  await expect(card(page, 0)).not.toContainText(vehicle.name);
  await expect.poll(() => vehicleHolders(page)).toEqual([board.incidents[1].id]);
});

test('«Danach vormerken» plans it; once free, «Zuteilen» puts it on the second card', async ({
  authenticatedPage: page,
}) => {
  const prompt = await quickAssignToSecondCard(page);
  await expect(prompt.getByRole('button', { name: /beiden/ })).toHaveCount(0);
  await prompt.getByRole('button', { name: 'Danach vormerken' }).click();
  await expect(prompt).toBeHidden();

  // Still only on the first card; the second one shows it «Danach».
  const band = card(page, 1).getByLabel(/Danach vorgemerkt/);
  await expect(band).toContainText('DANACH');
  await expect(band).toContainText(vehicle.name);
  expect(await vehicleHolders(page)).toEqual([board.incidents[0].id]);

  // The first card lets it go (by hand here; completion does the same).
  const cookieHeader = await cookieHeaderFor(page);
  const byIncident = await assignmentsByEvent(page.request, cookieHeader, board.eventId);
  const row = byIncident[board.incidents[0].id].find((r) => r.resource_id === vehicle.id)!;
  await page.request.post(`${API_BASE}/api/incidents/${board.incidents[0].id}/unassign/${row.id}`, {
    headers: { cookie: cookieHeader },
  });

  await expect(band).toContainText('DANACH · JETZT FREI');
  await band.getByRole('button', { name: 'Zuteilen' }).click();
  await expect.poll(() => vehicleHolders(page)).toEqual([board.incidents[1].id]);
  await expect(card(page, 1).getByLabel(/Danach vorgemerkt/)).toHaveCount(0);
});

test.describe('dismissing the question leaves everything where it was', () => {
  for (const key of ['Enter', 'Escape']) {
    test(`with ${key}`, async ({ authenticatedPage: page }) => {
      const prompt = await quickAssignToSecondCard(page);
      await page.keyboard.press(key);
      await expect(prompt).toBeHidden();

      await expect(card(page, 0)).toContainText(vehicle.name);
      await expect(card(page, 1)).not.toContainText(vehicle.name);
      expect(await vehicleHolders(page)).toEqual([board.incidents[0].id]);
    });
  }
});
