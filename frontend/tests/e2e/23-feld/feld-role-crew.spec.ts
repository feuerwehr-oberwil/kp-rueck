import type { Browser, Page } from '@playwright/test';
import { test, expect } from '../../fixtures/auth.fixture';
import { FeldPage } from '../../pages/feld.page';
import {
  assignPersonnel,
  cookieHeaderFor,
  createEvent,
  createIncident,
  createPersonnel,
  deleteEvent,
  deletePersonnel,
  generateFeldLink,
  getFeldCode,
  type TestIncident,
  type TestIncidentStatus,
  type TestPersonnel,
} from '../../helpers/api.helper';

/**
 * `/feld`, the **crew** source — the one row that owes a Schadenplatz-Rapport.
 *
 * Since plan 26 a person reaches a Schadenplatz through one of four sources
 * (crew · reko · driver · magazin), and the source decides what the page offers.
 * The sibling specs prove the three exceptions are cut down correctly; this file
 * proves the rule is still whole, which is the half that a "hide it for role X"
 * change breaks silently: nothing about a driver's page failing tells you that
 * the crew lost its Abholung button at the same time.
 *
 * What the two tests defend:
 *  1. the whole crew page: the row is on the list and carries NO source tag —
 *     the absence *is* the statement "this one is mine", so it is asserted as an
 *     absence, exactly as `SourceLabel` implements it — then all FOUR actions
 *     (Angekommen · Einsatz beendet · Abholung · Meldung; the other three
 *     sources get Meldung alone, and the server answers 403 to the rest), and
 *     the Rapport form itself, the paper this surface replaces.
 *  2. a Schadenplatz that was never dispatched: one sentence saying why there is
 *     no Rapport, instead of an empty form landing on the Restliste as work
 *     somebody has to check (§18.27).
 *
 * Two contexts, like the rapport spec: the arrangement runs as a logged-in
 * editor over REST, the field half in a fresh context holding nothing but the
 * poster link and the four digits. A crew page that quietly needed a session
 * cookie would still pass in the editor's own context.
 *
 * **One walk per test rather than one assertion per test, on purpose.** The
 * Feld-Code door is rate limited to 10 unlocks per 10 minutes PER IP
 * (`RateLimits.FELD_UNLOCK`), and every spec in this directory spends from the
 * same budget — the same reason `auth.fixture` logs in once per worker. Four
 * small tests here would be four unlocks and would push the neighbours over the
 * edge, so the crew page is walked whole, twice.
 */

const FIELD_TIMEOUT = 20_000;

/** The one sentence a never-dispatched Schadenplatz shows instead of the form. */
const NOT_DISPATCHED = 'Ein Rapport wird erst erfasst, wenn der Schadenplatz disponiert wurde.';

interface CrewFixture {
  link: string;
  code: string;
  incident: TestIncident;
  /** The street part of the address — what the list row shows as its heading. */
  street: string;
  crew: TestPersonnel;
}

/** Everything created here, torn down in afterEach — the dev DB is the user's board. */
const created: { events: string[]; personnel: string[] } = { events: [], personnel: [] };

/**
 * One Ereignis, one Schadenplatz, one firefighter assigned to it — the plainest
 * possible `crew` row.
 *
 * `assignPersonnel` is the board's own path and is what gives the assignment
 * `purpose='crew'`. There is deliberately no special function anywhere in this
 * fixture: "no special function" is what the crew source means.
 */
async function arrangeCrew(
  page: Page,
  prefix: string,
  status: TestIncidentStatus,
): Promise<CrewFixture> {
  const cookieHeader = await cookieHeaderFor(page);
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const event = await createEvent(page.request, cookieHeader, `${prefix} ${stamp}`);
  created.events.push(event.id);

  // Rows are located by STREET, not by title: the list row's heading is the
  // formatted address (`app/feld/page.tsx`) and the incident title appears
  // nowhere on it — the board's cards are the same way round.
  const street = `${prefix}weg ${stamp}`;
  const incident = await createIncident(page.request, cookieHeader, event.id, {
    title: `${prefix} Schadenplatz ${stamp}`,
    status,
    location_address: `${street}, 4104 Oberwil`,
  });

  const crew = await createPersonnel(page.request, cookieHeader, `Trupp Muster ${stamp}`);
  created.personnel.push(crew.id);
  await assignPersonnel(page.request, cookieHeader, incident.id, crew.id);

  return {
    link: await generateFeldLink(page.request, cookieHeader, event.id),
    code: await getFeldCode(page.request, cookieHeader, event.id),
    incident,
    street,
    crew,
  };
}

/** A phone: its own context, no session cookie, nothing but the link and the code. */
async function fieldPhone(
  browser: Browser,
  fixture: CrewFixture,
): Promise<{ page: Page; feld: FeldPage }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const feld = new FeldPage(page);
  await feld.open(fixture.link, fixture.code);
  await feld.pickPerson(fixture.crew.name);
  return { page, feld };
}

test.describe('/feld — die eigene Zuteilung (crew)', () => {
  test.afterEach(async ({ authenticatedPage }) => {
    const cookieHeader = await cookieHeaderFor(authenticatedPage);
    for (const id of created.events.splice(0)) {
      await deleteEvent(authenticatedPage.request, cookieHeader, id);
    }
    for (const id of created.personnel.splice(0)) {
      await deletePersonnel(authenticatedPage.request, cookieHeader, id);
    }
  });

  test('die eigene Zuteilung: ohne Marke auf der Liste, mit allen vier Meldungen und dem Rapport', async ({
    authenticatedPage,
    browser,
  }) => {
    const fixture = await arrangeCrew(authenticatedPage, 'Crewwalk', 'active');

    const { page: phone, feld } = await fieldPhone(browser, fixture);
    try {
      const row = feld.assignmentRow(fixture.street);
      await expect(row).toBeVisible({ timeout: FIELD_TIMEOUT });

      // An own assignment is the RULE and is deliberately unlabelled — only the
      // exceptions get a tag. A well-meant "Zugeteilt" chip here would put the
      // same word on every row of a single-role person's list, which is how a
      // tag stops meaning anything.
      await expect(row.getByText('Als Fahrer', { exact: false })).toHaveCount(0);
      await expect(row.getByText('Reko-Auftrag')).toHaveCount(0);
      await expect(row.getByText('Magazin')).toHaveCount(0);
      // …and no explanation sentence either: there is nothing to explain.
      await expect(row.getByText('du bist nicht selbst zugeteilt', { exact: false })).toHaveCount(0);
      await expect(row.getByText('Vom KP als Reko zugeteilt')).toHaveCount(0);

      // The rapport state is on the LIST already: what is still owed has to be
      // readable before anything is opened (bucket 2 of the feed), and only a
      // crew row carries this chip at all.
      await expect(row.getByText('kein Rapport', { exact: true })).toBeVisible();

      await feld.openAssignment(fixture.street);

      // The three crew-only actions. `FeldActions` renders them behind
      // `source === 'crew'` because the server refuses them from the other
      // sources — so this is the only page on which all four exist, and a
      // missing one leaves a crew at an address with no way to say so.
      await expect(feld.arrivedButton).toBeVisible({ timeout: FIELD_TIMEOUT });
      await expect(feld.completeButton).toBeVisible();
      // The Abholung link waits for «Einsatz beendet» — asking to be fetched
      // from an address the crew is still working was the odd affordance.
      await expect(feld.pickupButton).toHaveCount(0);
      // …and the fourth, which everybody gets: noticing something is not a crew
      // privilege. Asserted here to prove the grid is four wide, not three.
      await expect(phone.getByRole('button', { name: 'Meldung an den KP', exact: true })).toBeVisible();

      // The Rapport itself — the Schadenplatz is dispatched, so it is owed. The
      // fold block and the field's own "I am done": the `/feld` mount is the
      // ONLY one carrying that button since §18.17, so its presence is what says
      // the crew got the real form rather than the KP's autosaving one.
      await feld.openRapportSection('Kurzbericht');
      await expect(feld.kurzberichtField).toBeVisible();
      await expect(feld.submitRapportButton).toBeVisible();
      await expect(phone.getByText(NOT_DISPATCHED)).toHaveCount(0);
    } finally {
      await phone.context().close();
    }
  });

  test('auf dem nie disponierten Schadenplatz erklärt ein Satz, warum kein Rapport da ist', async ({
    authenticatedPage,
    browser,
  }) => {
    // Created in «Eingehend» and never moved, so `has_been_dispatched` stays
    // false. Nobody was ever sent here, so there is nothing to report on — and
    // the crew reads why rather than filling an empty rapport. The sentence is
    // the mitigation for a missing form; without it the absence is a bug report.
    const fixture = await arrangeCrew(authenticatedPage, 'Crewwartend', 'incoming');

    const { page: phone, feld } = await fieldPhone(browser, fixture);
    try {
      const row = feld.assignmentRow(fixture.street);
      await expect(row).toBeVisible({ timeout: FIELD_TIMEOUT });
      // No chip on the row either: "kein Rapport" would read as a to-do the
      // crew cannot do.
      await expect(row.getByText('kein Rapport', { exact: true })).toHaveCount(0);

      await feld.openAssignment(fixture.street);
      await expect(phone.getByText(NOT_DISPATCHED)).toBeVisible({ timeout: FIELD_TIMEOUT });

      // No form at all — not a folded one, not a disabled one.
      await expect(feld.kurzberichtField).toHaveCount(0);
      await expect(feld.submitRapportButton).toHaveCount(0);
    } finally {
      await phone.context().close();
    }
  });
});
