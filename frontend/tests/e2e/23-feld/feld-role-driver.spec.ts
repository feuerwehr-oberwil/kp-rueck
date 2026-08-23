import type { Browser, Page } from '@playwright/test';
import { test, expect } from '../../fixtures/auth.fixture';
import { FeldPage } from '../../pages/feld.page';
import {
  API_BASE,
  assignPersonnel,
  cookieHeaderFor,
  createEvent,
  createIncident,
  createPersonnel,
  deleteEvent,
  deletePersonnel,
  generateFeldLink,
  getFeldCode,
  setSpecialFunction,
  type TestIncident,
  type TestPersonnel,
} from '../../helpers/api.helper';

/**
 * `/feld` — der **Fahrer**, the case the old visibility rule could not see at all.
 *
 * A driver holds no personnel assignment anywhere: the *vehicle* is assigned to
 * the Schadenplatz, and `event_special_functions` says who drives it. Before plan
 * 26 that person did not exist for this page — not in the picker, not in a list —
 * so whoever actually stood at the address with the TLF had nothing to tap.
 *
 * One walk, three things that would each break silently:
 *  1. the driver is visible AT ALL, and the row says why: a tag naming the
 *     vehicle plus the plain sentence under it. A Schadenplatz nobody assigned
 *     you to is otherwise a mystery.
 *  2. the driver is offered NO Schadenplatz-Rapport and none of the three crew
 *     reports. `crud/feld/visibility.py` refuses those writes (`RAPPORT_SOURCES`
 *     / `WORK_SOURCES`), so rendering them would be buttons that answer 403.
 *     "Meldung" stays — noticing something is not a crew privilege.
 *  3. releasing the vehicle takes the row with it (decision 11). Crew rows
 *     survive their release, because the Rapport is filed after they leave; a
 *     driver owes nothing once the vehicle is off the place, so the opposite is
 *     correct here — and it is the one asymmetry in the union rule that a
 *     reader would otherwise call a bug.
 *
 * **Why one test and not three.** The Feld-Code exchange is rate limited to ten
 * unlocks per ten minutes *per IP* (`RateLimits.FELD_UNLOCK`), and every phone
 * context walks that door once. The whole `23-feld` directory runs from a single
 * address, so a spec file's real budget is roughly one unlock — a second one
 * here is a second file that cannot get in. The walk is arranged over REST and
 * asserted in the order a driver lives it, which costs exactly one.
 *
 * Two contexts, as everywhere in this directory: the board is a logged-in
 * editor, the field surface is a phone holding nothing but the poster link and
 * four digits.
 */

const SMOKE_TIMEOUT = 20_000;
/** "Meine Schadenplätze" refetches on a 10s poll (`FELD_POLL_MS`) — a REST change needs two of them. */
const POLL_TIMEOUT = 30_000;

interface DriverFixture {
  eventId: string;
  link: string;
  code: string;
  /** One Schadenplatz per claimed vehicle, in the same order. */
  incidents: TestIncident[];
  vehicles: ClaimedVehicle[];
  driver: TestPersonnel;
}

interface ClaimedVehicle {
  id: string;
  name: string;
  /** The assignment row, so the test can release the vehicle again. */
  assignmentId: string;
}

/** Everything created here, torn down in afterEach — the dev DB is the user's board. */
const created: { events: string[]; personnel: string[] } = { events: [], personnel: [] };

/**
 * Put SOME vehicle of the station fleet on `incidentId` and report which one.
 *
 * Not `firstVehicleId`: this spec needs the vehicle's NAME (the row prints it in
 * both the tag and the reason line), and a fleet vehicle can already be bound to
 * another incident — the user's own board, or a sibling spec in the next worker
 * — which `POST /assign` answers with a 409. So it walks the fleet until one
 * takes; `skip` holds the ones this test already claimed.
 */
async function claimVehicle(
  page: Page,
  cookieHeader: string,
  incidentId: string,
  skip: Set<string>,
): Promise<ClaimedVehicle> {
  const listed = await page.request.get(`${API_BASE}/api/vehicles/`, { headers: { cookie: cookieHeader } });
  expect(listed.ok(), await listed.text()).toBeTruthy();
  const fleet: { id: string; name: string }[] = await listed.json();
  expect(fleet.length, 'the dev fleet is empty — seed it first').toBeGreaterThan(0);

  for (const vehicle of fleet) {
    if (skip.has(vehicle.id)) continue;
    const response = await page.request.post(`${API_BASE}/api/incidents/${incidentId}/assign`, {
      headers: { 'Content-Type': 'application/json', cookie: cookieHeader },
      data: { resource_type: 'vehicle', resource_id: vehicle.id },
    });
    if (response.status() === 409) continue; // already out on another Schadenplatz
    expect(response.ok(), await response.text()).toBeTruthy();
    const { id } = await response.json();
    return { id: vehicle.id, name: vehicle.name, assignmentId: id };
  }
  throw new Error('every vehicle in the dev fleet is already assigned — nothing left to drive');
}

/**
 * `count` Schadenplätze, one vehicle on each, and one person who drives them all
 * — while holding NO personnel assignment anywhere, which is the whole point.
 */
async function arrangeDriver(page: Page, prefix: string, count: number): Promise<DriverFixture> {
  const cookieHeader = await cookieHeaderFor(page);
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const event = await createEvent(page.request, cookieHeader, `${prefix} ${stamp}`);
  created.events.push(event.id);

  const driver = await createPersonnel(page.request, cookieHeader, `Fahrer Muster ${stamp}`, {
    role: 'Fahrer',
    roleSortOrder: 5,
  });
  created.personnel.push(driver.id);

  const incidents: TestIncident[] = [];
  const vehicles: ClaimedVehicle[] = [];
  const claimed = new Set<string>();
  for (let i = 0; i < count; i += 1) {
    // The row's heading is the ADDRESS, never the title, so the unique token the
    // assertions locate on has to live in the street.
    const incident = await createIncident(page.request, cookieHeader, event.id, {
      status: 'active',
      location_address: `${prefix}weg ${i + 1} ${stamp}, 4104 Oberwil`,
    });
    const vehicle = await claimVehicle(page, cookieHeader, incident.id, claimed);
    claimed.add(vehicle.id);
    await setSpecialFunction(page.request, cookieHeader, event.id, driver.id, 'driver', vehicle.id);
    incidents.push(incident);
    vehicles.push(vehicle);
  }

  return {
    eventId: event.id,
    link: await generateFeldLink(page.request, cookieHeader, event.id),
    code: await getFeldCode(page.request, cookieHeader, event.id),
    incidents,
    vehicles,
    driver,
  };
}

/** A phone: its own context, no session cookie, nothing but the link and the code. */
async function fieldPhone(
  browser: Browser,
  link: string,
  code: string,
): Promise<{ page: Page; feld: FeldPage }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const feld = new FeldPage(page);
  await feld.open(link, code);
  return { page, feld };
}

/** The street part of the address — what a `/feld` row renders as its heading. */
function street(incident: TestIncident): string {
  return (incident.location_address ?? '').split(',')[0];
}

test.describe('/feld: der Fahrer', { tag: '@smoke' }, () => {
  test.afterEach(async ({ authenticatedPage }) => {
    const cookieHeader = await cookieHeaderFor(authenticatedPage);
    for (const id of created.events.splice(0)) {
      await deleteEvent(authenticatedPage.request, cookieHeader, id);
    }
    for (const id of created.personnel.splice(0)) {
      await deletePersonnel(authenticatedPage.request, cookieHeader, id);
    }
  });

  test('ein Fahrer sieht den Schadenplatz seines Fahrzeugs, schuldet keinen Rapport — und verschwindet mit dem Fahrzeug', async ({
    authenticatedPage,
    browser,
  }) => {
    // TWO Schadenplätze, one vehicle each, both driven by the same person. The
    // second one is not padding: at the end it is what proves the list actually
    // reloaded and dropped one row, rather than the page having gone blank.
    const fixture = await arrangeDriver(authenticatedPage, 'Fahrerwalk', 2);
    const [released, kept] = fixture.incidents;
    const [releasedVehicle] = fixture.vehicles;

    // A crew IS at work on the first one, so it genuinely owes a Rapport —
    // otherwise "no form for the driver" would be true for the boring reason
    // that nothing was ever disponiert, and would prove nothing.
    const cookieHeader = await cookieHeaderFor(authenticatedPage);
    const crew = await createPersonnel(authenticatedPage.request, cookieHeader, `Trupp Muster ${Date.now()}`);
    created.personnel.push(crew.id);
    await assignPersonnel(authenticatedPage.request, cookieHeader, released.id, crew.id);

    const { page: phone, feld } = await fieldPhone(browser, fixture.link, fixture.code);
    try {
      // ── 1. visible at all ────────────────────────────────────────────────
      // The picker is the first place the old rule failed: it listed the people
      // holding a personnel row, and this person holds none anywhere.
      await feld.pickPerson(fixture.driver.name);

      const releasedRow = feld.assignmentRow(street(released));
      const keptRow = feld.assignmentRow(street(kept));
      await expect(releasedRow).toBeVisible({ timeout: SMOKE_TIMEOUT });
      await expect(keptRow).toBeVisible();

      // The tag names the vehicle — "Als Fahrer" alone would leave the driver of
      // two vehicles guessing which one put the row here.
      await expect(releasedRow.getByText(`Als Fahrer · ${releasedVehicle.name}`)).toBeVisible();
      // …and nothing under it. The explanatory sentence Reko and Magazin rows
      // carry is deliberately absent here: the driver is standing at the
      // Schadenplatz and knows why, so "du bist nicht selbst zugeteilt" read as
      // a correction rather than an explanation. The tag is the whole message.
      await expect(releasedRow.getByText('nicht selbst zugeteilt')).toHaveCount(0);

      // ── 2. owes nothing, may still speak ─────────────────────────────────
      await feld.openAssignment(street(released));

      // No form and no state chip: the Rapport is the crew's homework, and the
      // server refuses this person's write (`RAPPORT_SOURCES`). Offering it
      // would be a form that 403s on submit — worse than not offering it.
      await expect(feld.submitRapportButton).toHaveCount(0);
      await expect(feld.kurzberichtField).toHaveCount(0);
      await expect(feld.rapportStateChip('kein Rapport')).toHaveCount(0);

      // Nor the three reports only the working crew may make (`WORK_SOURCES`):
      // a driver parked outside neither arrives at the job, nor ends it, nor
      // has anything of their own to be collected.
      await expect(feld.arrivedButton).toHaveCount(0);
      await expect(feld.completeButton).toHaveCount(0);
      await expect(feld.pickupButton).toHaveCount(0);

      // One button survives, deliberately: noticing something is not a crew
      // privilege, and the driver is standing right there.
      await expect(phone.getByRole('button', { name: 'Meldung an den KP', exact: true })).toBeVisible();

      // ── 3. the vehicle leaves, the row goes with it ──────────────────────
      await phone.getByRole('button', { name: 'Zurück' }).click();
      await expect(releasedRow).toBeVisible({ timeout: SMOKE_TIMEOUT });

      // The KP pulls the vehicle off that Schadenplatz while the phone is on
      // the list — the driver is on the way back and taps nothing.
      const response = await authenticatedPage.request.post(
        `${API_BASE}/api/incidents/${released.id}/unassign/${releasedVehicle.assignmentId}`,
        { headers: { cookie: cookieHeader } },
      );
      expect(response.ok(), await response.text()).toBeTruthy();

      // Gone, not greyed out as "Nicht mehr zugeteilt" — while the other
      // vehicle's row stays. That is the asymmetry decision 11 asks for: a
      // released CREW row survives because the Rapport is filed after they
      // leave, a driver owes nothing once the vehicle is off the place.
      await expect(releasedRow).toHaveCount(0, { timeout: POLL_TIMEOUT });
      await expect(keptRow).toBeVisible();
    } finally {
      await phone.context().close();
    }
  });
});
