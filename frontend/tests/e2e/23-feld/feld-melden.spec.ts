import type { Browser, Page } from '@playwright/test';
import { test, expect } from '../../fixtures/auth.fixture';
import { FeldPage } from '../../pages/feld.page';
import {
  assignPersonnel,
  assignReko,
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
 * «Neue Meldung» — reporting a Schadenplatz from the field (plan 26, decision 14).
 *
 * Two behaviours here, and both are things the form got wrong the first time a
 * crew used it:
 *
 *  1. **«Wir übernehmen das gleich» has to actually hand you the job.** Saying
 *     yes and then finding the Schadenplatz sitting in *Eingegangen* with your
 *     own list unchanged is the worst of both: the KP reads it as an unhandled
 *     alarm while the crew is already driving to it. So the row appears on the
 *     reporter's own list, and it does not appear as `incoming`.
 *  2. **A Reko trupp is not offered the switch at all.** They were sent to look
 *     and report back — taking a Schadenplatz on is not theirs to say.
 *
 * The obvious third case — somebody who is reko AND on a working crew — is not
 * here, because `/feld` cannot see it: the event-wide `reko` function makes
 * every one of that person's per-incident rows read as reko, a collapse
 * `backend/app/crud/feld/visibility.py` takes deliberately and explains. Their
 * crew work is only distinguishable when it arrives through an **Auftrag**,
 * where the squad holds no personnel row at all. Pinning the collapsed case
 * here would pin a bug as a feature.
 *
 * Serial and arranged once for the same reason as the sibling files: the
 * Feld-Code door counts failures per (IP, Ereignis), and every trip through it
 * costs the whole suite a shared budget.
 */

const FIELD_TIMEOUT = 20_000;

/** The street part of the address — what both `/feld` list and detail render. */
function street(incident: TestIncident): string {
  return (incident.location_address ?? '').split(',')[0];
}

interface MeldenFixture {
  eventId: string;
  link: string;
  code: string;
  existing: TestIncident;
  /** On a crew — gets the switch, and takes the new Meldung onto the same route. */
  crew: TestPersonnel;
  /** Reko and nothing else — no switch. */
  rekoOnly: TestPersonnel;
  /** Reko *and* an ordinary crew row — reads as reko throughout, see above. */
  rekoAndCrew: TestPersonnel;
}

let fixture: MeldenFixture;
let kpPage: Page;

/** One Ereignis, one Schadenplatz already being worked, three people. */
async function arrangeMelden(page: Page): Promise<MeldenFixture> {
  const cookieHeader = await cookieHeaderFor(page);
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const event = await createEvent(page.request, cookieHeader, `Melden ${stamp}`);

  const existing = await createIncident(page.request, cookieHeader, event.id, {
    title: `Melden Schadenplatz ${stamp}`,
    status: 'active',
    location_address: `Meldeweg 1 ${stamp}, 4104 Oberwil`,
  });

  const crew = await createPersonnel(page.request, cookieHeader, `Melder Muster ${stamp}`);
  const rekoOnly = await createPersonnel(page.request, cookieHeader, `Späher Muster ${stamp}`);
  const rekoAndCrew = await createPersonnel(page.request, cookieHeader, `Doppel Muster ${stamp}`);

  // The reporter is working a Schadenplatz already — that is what turns «wir
  // übernehmen das gleich» into a second stop rather than a lone assignment.
  await assignPersonnel(page.request, cookieHeader, existing.id, crew.id);

  // Reko and nothing else.
  await setSpecialFunction(page.request, cookieHeader, event.id, rekoOnly.id, 'reko');
  await assignReko(page.request, cookieHeader, existing.id, rekoOnly.id);

  // Reko AND a working crew row — the case the rule must not catch.
  await setSpecialFunction(page.request, cookieHeader, event.id, rekoAndCrew.id, 'reko');
  await assignPersonnel(page.request, cookieHeader, existing.id, rekoAndCrew.id);

  const link = await generateFeldLink(page.request, cookieHeader, event.id);
  const code = await getFeldCode(page.request, cookieHeader, event.id);

  return { eventId: event.id, link, code, existing, crew, rekoOnly, rekoAndCrew };
}

test.describe.configure({ mode: 'serial' });

test.describe('/feld: eine neue Meldung', () => {
  test.beforeAll(async ({ browser, authCookies }) => {
    const kpContext = await browser.newContext();
    await kpContext.addCookies(authCookies);
    kpPage = await kpContext.newPage();
    fixture = await arrangeMelden(kpPage);
  });

  test.afterAll(async () => {
    const cookieHeader = await cookieHeaderFor(kpPage);
    await deleteEvent(kpPage.request, cookieHeader, fixture.eventId);
    for (const person of [fixture.crew, fixture.rekoOnly, fixture.rekoAndCrew]) {
      await deletePersonnel(kpPage.request, cookieHeader, person.id);
    }
  });

  /** A phone through the door, already identified as `person`. */
  async function phoneFor(browser: Browser, person: TestPersonnel): Promise<{ page: Page; feld: FeldPage }> {
    const context = await browser.newContext();
    const page = await context.newPage();
    const feld = new FeldPage(page);
    await feld.open(fixture.link, fixture.code);
    await feld.pickPerson(person.name);
    return { page, feld };
  }

  const meldenButton = (page: Page) => page.getByRole('button', { name: 'Melden', exact: true });
  const takeOverSwitch = (page: Page) => page.getByRole('switch');

  test('der Reko-Trupp bekommt den Übernahme-Schalter gar nicht erst', async ({ browser }) => {
    const { page } = await phoneFor(browser, fixture.rekoOnly);

    await meldenButton(page).click();
    // The form is open — the switch simply is not part of it.
    await expect(page.getByRole('heading', { name: 'Neue Meldung' })).toBeVisible({
      timeout: FIELD_TIMEOUT,
    });
    await expect(takeOverSwitch(page)).toHaveCount(0);
  });

  test('die arbeitende Crew bekommt ihn – der Schalter ist nicht generell weg', async ({
    browser,
  }) => {
    const { page } = await phoneFor(browser, fixture.crew);

    await meldenButton(page).click();
    await expect(page.getByRole('heading', { name: 'Neue Meldung' })).toBeVisible({
      timeout: FIELD_TIMEOUT,
    });
    await expect(takeOverSwitch(page)).toBeVisible();
  });

  test('«wir übernehmen das gleich» stellt die Meldung auf die eigene Liste – nicht nach Eingegangen', async ({
    browser,
  }) => {
    const { page, feld } = await phoneFor(browser, fixture.crew);

    await meldenButton(page).click();
    await expect(page.getByRole('heading', { name: 'Neue Meldung' })).toBeVisible({
      timeout: FIELD_TIMEOUT,
    });

    // The address field is the shared `LocationInput` — the same control the
    // phone desk gets on /alarm, so a crew can search or tap the map instead of
    // typing a street one-handed in the rain. Typing is what a test can do.
    const address = `Bahnhofstrasse 4 ${Date.now()}`;
    // `LocationInput` holds the typed query separately from the committed
    // address and only commits on Enter (freetext) or on picking a suggestion —
    // filling alone leaves the form empty, which is exactly what a crew sees if
    // they type and tap Melden. Enter is the freetext commit.
    const field = page.getByPlaceholder('Adresse eingeben oder suchen …');
    await field.fill(address);
    await field.press('Enter');
    await takeOverSwitch(page).click();

    // The form does not send: «Weiter» hands over to a review step, and only the
    // button THERE is «Meldung absetzen» — the same two-step shape the phone
    // desk's `/alarm` form has, for the same reason (a button that claims to
    // send is the fat-finger the step exists to catch).
    await page.getByRole('button', { name: 'Weiter' }).click();
    await expect(page.getByRole('heading', { name: 'Stimmt das so?' })).toBeVisible();
    await page.getByRole('button', { name: 'Meldung absetzen' }).click();

    // The whole point: it is on the reporter's own list straight away. Before
    // route-level assignments granted visibility this row never appeared, and
    // the crew was driving to a Schadenplatz their own phone denied.
    await expect(feld.assignmentRow(address)).toBeVisible({ timeout: FIELD_TIMEOUT });

    // …and the old Schadenplatz is still theirs. Taking one on is not leaving
    // the other — that was the reason for mirroring the crew onto the route
    // rather than moving it.
    await expect(feld.assignmentRow(street(fixture.existing))).toBeVisible();
  });
});
