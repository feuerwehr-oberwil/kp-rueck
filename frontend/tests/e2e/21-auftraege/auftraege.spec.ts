import { test, expect, type Page } from '../../fixtures/auth.fixture';

/**
 * Aufträge (multi-stop routing) E2E coverage.
 *
 * An Auftrag (`incident_group`) is an ordered checklist over real incidents
 * ("stops"). "Auf alle übernehmen" (copy-squad) copies the first stop's active
 * assignments to every sibling stop; the set of copied resource kinds is derived
 * from the Auftrag's mode (`squad` = vehicle + crew + material, `vehicle_only`
 * = the vehicle only / Pendeldienst).
 *
 * Everything drag-related is seeded through the backend REST API (pragmatic-dnd
 * drag is flaky under Playwright, and the existing specs seed the same way — see
 * 13-drag-drop / 18-intake). The UI is exercised for the parts that matter: the
 * board Auftrag chip, and the "Auf alle übernehmen" flow in the Aufträge sheet.
 * Assignments are asserted against API state (the stable signal).
 */

const BACKEND = 'http://localhost:8000';
const SELECTED_EVENT_KEY = 'kp-rueck-selected-event';

type Api = Page['request'];

async function createEvent(api: Api, name: string): Promise<string> {
  const res = await api.post(`${BACKEND}/api/events/`, {
    data: { name, training_flag: true, auto_attach_divera: false },
  });
  expect(res.ok(), `create event: ${res.status()}`).toBeTruthy();
  return (await res.json()).id as string;
}

async function createIncident(api: Api, eventId: string, title: string): Promise<string> {
  const res = await api.post(`${BACKEND}/api/incidents/`, {
    data: {
      event_id: eventId,
      title,
      type: 'brandbekaempfung',
      priority: 'medium',
      status: 'eingegangen',
      location_address: `${title} — Teststrasse 1, 4410 Liestal`,
    },
  });
  expect(res.ok(), `create incident: ${res.status()}`).toBeTruthy();
  return (await res.json()).id as string;
}

async function createVehicle(api: Api, name: string): Promise<string> {
  const res = await api.post(`${BACKEND}/api/vehicles/`, {
    data: { name, type: 'TLF', display_order: 0, status: 'available', radio_call_sign: name },
  });
  expect(res.ok(), `create vehicle: ${res.status()}`).toBeTruthy();
  return (await res.json()).id as string;
}

async function createPersonnel(api: Api, name: string): Promise<string> {
  const res = await api.post(`${BACKEND}/api/personnel/`, {
    data: { name, role: 'Feuerwehrmann', availability: 'available' },
  });
  expect(res.ok(), `create personnel: ${res.status()}`).toBeTruthy();
  return (await res.json()).id as string;
}

async function createGroup(
  api: Api,
  eventId: string,
  name: string,
  mode: 'squad' | 'vehicle_only',
): Promise<string> {
  const res = await api.post(`${BACKEND}/api/incident-groups/`, {
    data: { event_id: eventId, name, mode, color: '#ef4444' },
  });
  expect(res.ok(), `create group: ${res.status()}`).toBeTruthy();
  return (await res.json()).id as string;
}

async function addStops(api: Api, groupId: string, incidentIds: string[]): Promise<void> {
  const res = await api.post(`${BACKEND}/api/incident-groups/${groupId}/stops`, {
    data: { incident_ids: incidentIds },
  });
  expect(res.ok(), `add stops: ${res.status()}`).toBeTruthy();
}

async function assign(
  api: Api,
  incidentId: string,
  resourceType: 'vehicle' | 'personnel' | 'material',
  resourceId: string,
): Promise<void> {
  const res = await api.post(`${BACKEND}/api/incidents/${incidentId}/assign`, {
    data: { resource_type: resourceType, resource_id: resourceId },
  });
  expect(res.ok(), `assign ${resourceType}: ${res.status()}`).toBeTruthy();
}

async function resourceIds(
  api: Api,
  incidentId: string,
  resourceType: 'vehicle' | 'personnel' | 'material',
): Promise<string[]> {
  const res = await api.get(`${BACKEND}/api/incidents/${incidentId}/assignments`);
  expect(res.ok(), `get assignments: ${res.status()}`).toBeTruthy();
  const assignments: { resource_type: string; resource_id: string }[] = await res.json();
  return assignments.filter((a) => a.resource_type === resourceType).map((a) => a.resource_id);
}

/** Seed the selected-event key and reload so the Event/Groups contexts hydrate. */
async function selectEventInUI(page: Page, eventId: string): Promise<void> {
  await page.goto('/');
  await page.evaluate(
    ([key, id]) => window.localStorage.setItem(key, id),
    [SELECTED_EVENT_KEY, eventId] as const,
  );
  await page.reload();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(800);
}

test.describe('Aufträge — copy-squad ("Auf alle übernehmen")', () => {
  const createdEventIds: string[] = [];
  const createdVehicleIds: string[] = [];
  const createdPersonnelIds: string[] = [];

  test.afterAll(async ({ request }) => {
    // Events must be archived before they can be deleted; deletion then
    // cascades their incidents + groups. Resources are global, deleted separately.
    for (const id of createdEventIds) {
      await request.post(`${BACKEND}/api/events/${id}/archive`).catch(() => undefined);
      await request.delete(`${BACKEND}/api/events/${id}`).catch(() => undefined);
    }
    for (const id of createdVehicleIds) {
      await request.delete(`${BACKEND}/api/vehicles/${id}`).catch(() => undefined);
    }
    for (const id of createdPersonnelIds) {
      await request.delete(`${BACKEND}/api/personnel/${id}`).catch(() => undefined);
    }
  });

  test('squad route copies the vehicle to every sibling stop', async ({ authenticatedPage }) => {
    const api = authenticatedPage.request;
    const stamp = Date.now();

    // --- Seed via API: event + 3 incidents + a squad Auftrag with 3 stops. ---
    const eventId = await createEvent(api, `Auftrag Squad ${stamp}`);
    createdEventIds.push(eventId);

    const groupName = `Route Squad ${stamp}`;
    const stop1 = await createIncident(api, eventId, `Stop A ${stamp}`);
    const stop2 = await createIncident(api, eventId, `Stop B ${stamp}`);
    const stop3 = await createIncident(api, eventId, `Stop C ${stamp}`);

    const groupId = await createGroup(api, eventId, groupName, 'squad');
    await addStops(api, groupId, [stop1, stop2, stop3]);

    // Vehicle + person on the source stop only.
    const vehicleId = await createVehicle(api, `TLF-Sq-${stamp}`);
    const personId = await createPersonnel(api, `Fw Squad ${stamp}`);
    createdVehicleIds.push(vehicleId);
    createdPersonnelIds.push(personId);
    await assign(api, stop1, 'vehicle', vehicleId);
    await assign(api, stop1, 'personnel', personId);

    // Pre-condition: siblings start empty.
    expect(await resourceIds(api, stop2, 'vehicle')).toEqual([]);
    expect(await resourceIds(api, stop3, 'vehicle')).toEqual([]);

    // --- UI: select the event, confirm the board chip renders on each stop. ---
    await selectEventInUI(authenticatedPage, eventId);

    const cardsWithChip = authenticatedPage.locator('[data-testid="incident-card"]', {
      hasText: groupName,
    });
    await expect(cardsWithChip).toHaveCount(3);

    // --- UI: open the Aufträge sheet, expand the route, run "Auf alle übernehmen". ---
    await authenticatedPage.getByRole('button', { name: 'Aufträge' }).click();

    await authenticatedPage
      .getByRole('button', { name: 'Auftrag auf-/zuklappen' })
      .click();

    const copyButton = authenticatedPage.getByRole('button', { name: 'Auf alle übernehmen' });
    await expect(copyButton).toBeEnabled();
    await copyButton.click();

    // Squad mode pre-checks all three kinds; confirm the copy.
    await authenticatedPage.getByRole('button', { name: 'Übernehmen', exact: true }).click();

    await expect(
      authenticatedPage.locator('[data-sonner-toast]').filter({ hasText: 'übernommen' }),
    ).toBeVisible({ timeout: 5000 });

    // --- Assert on API state: both siblings now carry the source vehicle + person. ---
    await expect
      .poll(() => resourceIds(api, stop2, 'vehicle'), { timeout: 5000 })
      .toEqual([vehicleId]);
    await expect
      .poll(() => resourceIds(api, stop3, 'vehicle'), { timeout: 5000 })
      .toEqual([vehicleId]);
    expect(await resourceIds(api, stop2, 'personnel')).toEqual([personId]);
    expect(await resourceIds(api, stop3, 'personnel')).toEqual([personId]);
  });

  test('vehicle_only shuttle copies the vehicle but not the person', async ({ authenticatedPage }) => {
    const api = authenticatedPage.request;
    const stamp = Date.now();

    // --- Seed via API: event + 2 incidents + a vehicle_only Auftrag with 2 stops. ---
    const eventId = await createEvent(api, `Auftrag Shuttle ${stamp}`);
    createdEventIds.push(eventId);

    const groupName = `Route Shuttle ${stamp}`;
    const stop1 = await createIncident(api, eventId, `Pendel A ${stamp}`);
    const stop2 = await createIncident(api, eventId, `Pendel B ${stamp}`);

    const groupId = await createGroup(api, eventId, groupName, 'vehicle_only');
    await addStops(api, groupId, [stop1, stop2]);

    const vehicleId = await createVehicle(api, `TLF-Pd-${stamp}`);
    const personId = await createPersonnel(api, `Fw Pendel ${stamp}`);
    createdVehicleIds.push(vehicleId);
    createdPersonnelIds.push(personId);
    await assign(api, stop1, 'vehicle', vehicleId);
    await assign(api, stop1, 'personnel', personId);

    // --- UI: select event, open the sheet, copy-to-all (vehicle_only default). ---
    await selectEventInUI(authenticatedPage, eventId);

    await authenticatedPage.getByRole('button', { name: 'Aufträge' }).click();
    await authenticatedPage.getByRole('button', { name: 'Auftrag auf-/zuklappen' }).click();

    const copyButton = authenticatedPage.getByRole('button', { name: 'Auf alle übernehmen' });
    await expect(copyButton).toBeEnabled();
    await copyButton.click();
    // In vehicle_only mode the picker pre-checks the vehicle only.
    await authenticatedPage.getByRole('button', { name: 'Übernehmen', exact: true }).click();

    await expect(
      authenticatedPage.locator('[data-sonner-toast]').filter({ hasText: 'übernommen' }),
    ).toBeVisible({ timeout: 5000 });

    // --- Assert: the sibling gets the vehicle, but NOT the person. ---
    await expect
      .poll(() => resourceIds(api, stop2, 'vehicle'), { timeout: 5000 })
      .toEqual([vehicleId]);
    expect(await resourceIds(api, stop2, 'personnel')).toEqual([]);
  });
});
