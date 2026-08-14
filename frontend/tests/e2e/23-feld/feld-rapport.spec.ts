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
  dismissOverlays,
  expectCardCount,
  generateFeldLink,
  pinLeader,
  selectEvent,
  setIncidentStatus,
  type TestIncident,
  type TestPersonnel,
} from '../../helpers/api.helper';

/**
 * `/feld` end to end — the walk plan 25 §14 asks for, plus the three things that
 * would break silently.
 *
 * The suite runs TWO browser contexts on purpose: the KP board is a logged-in
 * editor, the field surface is a phone with nothing but a token. Doing the field
 * half in the editor's own context would still pass while `/feld` quietly
 * depended on a session cookie — which is the one property of this page that
 * nothing else in the codebase enforces.
 *
 * What each test defends:
 *  1. the whole walk: pick a person → open a Schadenplatz → file a rapport →
 *     the chip appears on the KP's card.
 *  2. the EL briefing, **including on a completed incident**. That case was
 *     broken until `Incident.leader_personnel_id` existed: completing an
 *     incident releases every assignment and therefore erases `is_leader` from
 *     all of them, so the crew's own list said "kein EL erfasst" for exactly
 *     the incidents whose rapport was still outstanding.
 *  3. "Einsatz beendet" → the Abholung follow-up → the badge on the board, and
 *     that the badge SURVIVES the card being moved to `complete`. Completing a
 *     card auto-releases the crew while they are physically still at the
 *     address, so this chip is the only thing left saying they are there.
 *  4. KP parity (decision 28): an editor files the same rapport from the
 *     incident detail on an incident with no field contact at all — with no
 *     submit button, because the KP mount autosaves and files what it saves
 *     (§18.17) — and the provenance reads "(Funkmeldung)", never "(Feld)".
 *
 * Tagged @smoke (plan 15): the four tests arrange over REST and share one worker
 * login, so the whole file runs in ~15 s on a warm dev server — cheap enough for
 * the gate, and the feature it guards is a paper form the station is about to
 * stop filling in by hand. If it ever slows down, drop the tag rather than the
 * assertions.
 */

const SMOKE_TIMEOUT = 20_000;

interface FieldFixture {
  eventId: string;
  eventName: string;
  link: string;
  incidents: TestIncident[];
  personnel: TestPersonnel[];
}

/** Everything created here, torn down in afterEach — the dev DB is the user's board. */
const created: { events: string[]; personnel: string[] } = { events: [], personnel: [] };

/**
 * A training Ereignis with `incidents` Schadenplätze, a crew on each of them,
 * and the poster link.
 *
 * `leader` is pinned rather than left to the automatic resolver: pinning also
 * sets `Incident.leader_manual`, so nothing later in a test can re-derive the
 * role and move the name the assertions read.
 */
async function arrangeField(
  page: Page,
  prefix: string,
  options: { incidents?: number; withCrew?: boolean } = {},
): Promise<FieldFixture> {
  const cookieHeader = await cookieHeaderFor(page);
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const event = await createEvent(page.request, cookieHeader, `${prefix} ${stamp}`);
  created.events.push(event.id);

  const count = options.incidents ?? 1;
  const incidents: TestIncident[] = [];
  for (let i = 0; i < count; i += 1) {
    incidents.push(
      await createIncident(page.request, cookieHeader, event.id, {
        title: `${prefix} Schadenplatz ${i + 1} ${stamp}`,
        status: 'active',
        location_address: `${prefix}weg ${i + 1} ${stamp}, 4104 Oberwil`,
      }),
    );
  }

  const personnel: TestPersonnel[] = [];
  if (options.withCrew !== false) {
    // Two people so the EL briefing has somebody to name who is not the reader.
    const leader = await createPersonnel(page.request, cookieHeader, `Leiter Muster ${stamp}`, {
      role: 'Zugführer',
      roleSortOrder: 1,
    });
    const crew = await createPersonnel(page.request, cookieHeader, `Trupp Muster ${stamp}`, {
      role: 'Feuerwehrmann',
      roleSortOrder: 10,
    });
    personnel.push(leader, crew);
    created.personnel.push(leader.id, crew.id);

    for (const incident of incidents) {
      const leaderAssignment = await assignPersonnel(page.request, cookieHeader, incident.id, leader.id);
      await assignPersonnel(page.request, cookieHeader, incident.id, crew.id);
      await pinLeader(page.request, cookieHeader, incident.id, leaderAssignment.id);
    }
  }

  return {
    eventId: event.id,
    eventName: event.name,
    link: await generateFeldLink(page.request, cookieHeader, event.id),
    incidents,
    personnel,
  };
}

/** A phone: its own context, no session cookie, nothing but the link. */
async function fieldPhone(browser: Browser, link: string): Promise<{ page: Page; feld: FeldPage }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const feld = new FeldPage(page);
  await feld.open(link);
  return { page, feld };
}

/** Open the KP board on `fixture`'s Ereignis with its cards rendered and nothing over them. */
async function openBoard(page: Page, fixture: FieldFixture) {
  await selectEvent(page, '/', fixture.eventId);
  await expect(page.getByRole('heading', { name: fixture.eventName }).first()).toBeVisible({
    timeout: SMOKE_TIMEOUT,
  });
  await expectCardCount(page, fixture.incidents.length);
  await dismissOverlays(page);
}

/**
 * The kanban card of one incident.
 *
 * By street, not by title: the card's heading is `formatLocation(operation.location)`
 * (`components/kanban/draggable-operation.tsx`) and the title appears nowhere on it,
 * so a title filter matches nothing at all. `/feld` is the other way round — its
 * rows are the title — which is why the two sides are located differently here.
 */
function card(page: Page, incident: TestIncident) {
  return page.getByTestId('incident-card').filter({ hasText: street(incident) }).first();
}

/** The street part of an incident's address — what `formatLocation` leaves on the card. */
function street(incident: TestIncident): string {
  return (incident.location_address ?? '').split(',')[0];
}

test.describe('Schadenplatz-Rapport: das Feld und der KP', { tag: '@smoke' }, () => {
  test.afterEach(async ({ authenticatedPage }) => {
    const cookieHeader = await cookieHeaderFor(authenticatedPage);
    for (const id of created.events.splice(0)) {
      await deleteEvent(authenticatedPage.request, cookieHeader, id);
    }
    for (const id of created.personnel.splice(0)) {
      await deletePersonnel(authenticatedPage.request, cookieHeader, id);
    }
  });

  test('eine Crew füllt auf /feld einen Rapport aus — der KP sieht den Chip', async ({
    authenticatedPage,
    browser,
  }) => {
    const fixture = await arrangeField(authenticatedPage, 'Feldwalk');
    const [leader, crew] = fixture.personnel;
    const incident = fixture.incidents[0];

    // The KP is watching the board while the crew works — the chip has to
    // arrive on its own, not on a reload.
    await openBoard(authenticatedPage, fixture);
    await expect(card(authenticatedPage, incident)).toBeVisible();
    await expect(
      card(authenticatedPage, incident).locator('[title="Schadenplatz-Rapport erfasst"]'),
    ).toHaveCount(0);

    const { page: phone, feld } = await fieldPhone(browser, fixture.link);
    try {
      await expect(phone.getByText(fixture.eventName)).toBeVisible();

      await feld.pickPerson(crew.name);
      // The briefing is on the LIST, before the form is ever opened (decision 22).
      await expect(feld.leaderLine(leader.name).first()).toBeVisible();

      await feld.openAssignment(incident.title);
      await expect(feld.rapportStateChip('kein Rapport').first()).toBeVisible();

      await feld.fileRapport('Keller ausgepumpt, Wasser stand 20 cm.');
      await expect(feld.rapportStateChip('Rapport erfasst').first()).toBeVisible();
    } finally {
      await phone.context().close();
    }

    // …and the board catches up by itself: the rapport save broadcasts an
    // incident update (`crud/feld.py::_broadcast`).
    await expect(
      card(authenticatedPage, incident).locator('[title="Schadenplatz-Rapport erfasst"]'),
    ).toBeVisible({ timeout: SMOKE_TIMEOUT });
  });

  test('die EL-Briefing-Zeile steht auf der Liste — auch beim abgeschlossenen Einsatz', async ({
    authenticatedPage,
    browser,
  }) => {
    const fixture = await arrangeField(authenticatedPage, 'Feld-EL', { incidents: 2 });
    const [leader, crew] = fixture.personnel;
    const [running, finished] = fixture.incidents;

    // Completing an incident releases every assignment, which erases `is_leader`
    // from all of them. Only `Incident.leader_personnel_id` survives that — and
    // this is the incident whose rapport is still owed.
    const cookieHeader = await cookieHeaderFor(authenticatedPage);
    await setIncidentStatus(authenticatedPage.request, cookieHeader, finished.id, 'active', 'complete');

    const { page: phone, feld } = await fieldPhone(browser, fixture.link);
    try {
      await feld.pickPerson(crew.name);

      const runningRow = feld.assignmentRow(running.title);
      const finishedRow = feld.assignmentRow(finished.title);
      await expect(runningRow).toBeVisible({ timeout: SMOKE_TIMEOUT });
      await expect(finishedRow).toBeVisible();

      // Both rows name the EL. "kein EL erfasst" on the finished one is the
      // regression this test exists for.
      await expect(runningRow.getByText(`EL: ${leader.name}`)).toBeVisible();
      await expect(finishedRow.getByText(`EL: ${leader.name}`)).toBeVisible();
      await expect(finishedRow.getByText('kein EL erfasst')).toHaveCount(0);
      // The crew is off the finished Schadenplatz but can still file for it.
      await expect(finishedRow.getByText('Nicht mehr zugeteilt')).toBeVisible();

      // …and it is still there in the detail header, where the form opens.
      await feld.openAssignment(finished.title);
      await expect(feld.leaderLine(leader.name).first()).toBeVisible();
      // The field keeps its explicit "I am done" (§18.17) — a crew on a phone
      // needs a definite moment, and this is where draft-vs-filed earns it.
      await expect(feld.submitRapportButton).toBeVisible({ timeout: SMOKE_TIMEOUT });
    } finally {
      await phone.context().close();
    }
  });

  test('«Einsatz beendet» fragt nach der Abholung — und das Badge überlebt den Zug nach «Abgeschlossen»', async ({
    authenticatedPage,
    browser,
  }) => {
    const fixture = await arrangeField(authenticatedPage, 'Rueckfahrt');
    const [, crew] = fixture.personnel;
    const incident = fixture.incidents[0];

    await openBoard(authenticatedPage, fixture);

    const { page: phone, feld } = await fieldPhone(browser, fixture.link);
    try {
      await feld.pickPerson(crew.name);
      await feld.openAssignment(incident.title);

      // «Einsatz beendet» asks first (§18.18) — from the field the report
      // cannot be taken back — and the Abholung follow-up opens by itself
      // afterwards, only once the beendet-Meldung has actually landed
      // (components/feld/feld-actions.tsx).
      await feld.reportComplete();
      await feld.needPickupButton.click();

      // Standing state on the phone, so a crew does not ask twice.
      await expect(feld.pickupFollowupQuestion).toHaveCount(0, { timeout: SMOKE_TIMEOUT });
    } finally {
      await phone.context().close();
    }

    const incidentCard = card(authenticatedPage, incident);
    // `exact`: the badge span is the whole word, and a street called
    // "…abholungweg" would otherwise satisfy a substring match.
    await expect(incidentCard.getByText('Abholung', { exact: true })).toBeVisible({
      timeout: SMOKE_TIMEOUT,
    });

    // Now the operator closes the card. The crew is still standing in the rain.
    const cookieHeader = await cookieHeaderFor(authenticatedPage);
    await setIncidentStatus(authenticatedPage.request, cookieHeader, incident.id, 'active', 'complete');

    // "Abgeschlossen" starts collapsed to a narrow strip and renders no cards at
    // all (`components/kanban/droppable-column.tsx`), so the column has to be
    // opened before anything in it can be asserted on.
    const completeColumn = authenticatedPage.locator('[data-column="complete"]');
    await expect(completeColumn).toBeVisible();
    await completeColumn.click();

    const completedCard = completeColumn
      .getByTestId('incident-card')
      .filter({ hasText: street(incident) })
      .first();
    await expect(completedCard).toBeVisible({ timeout: SMOKE_TIMEOUT });
    await expect(completedCard.getByText('Abholung', { exact: true })).toBeVisible({
      timeout: SMOKE_TIMEOUT,
    });
  });

  test('der KP erfasst denselben Rapport per Funkmeldung — ohne jeden Feldkontakt', async ({
    authenticatedPage,
  }) => {
    // No crew at all: nobody could ever have opened `/feld` for this one.
    const fixture = await arrangeField(authenticatedPage, 'Funkrapport', { withCrew: false });
    const incident = fixture.incidents[0];

    await openBoard(authenticatedPage, fixture);
    await card(authenticatedPage, incident).click();

    const detail = authenticatedPage.locator('[data-testid="operation-detail-content"]').first();
    await expect(detail).toBeVisible({ timeout: SMOKE_TIMEOUT });

    // The rapport lives on the Rapport tab now — three tabs since the detail
    // absorbed Ressourcen into Übersicht — and it is permanently open there,
    // like the Reko-Berichte beside it. No accordion header to click.
    await detail.getByRole('tab', { name: /^Rapport/ }).click();
    // ONE line says it: the section's own state chip. The dashed «Noch kein
    // Rapport» box under it said the same thing twice and made the normal state
    // of most Schadenplätze read as a fault (§18.16 revisited).
    await expect(detail.getByText('kein Rapport', { exact: true })).toBeVisible();
    await expect(detail.getByText('Noch kein Rapport')).toHaveCount(0);

    // No submit button on this mount any more (§18.17): the board autosaves
    // everything else, and a KP rapport is filed from its first saved
    // keystroke. Typing IS the filing.
    await expect(detail.getByRole('button', { name: /Rapport abschliessen/ })).toHaveCount(0);
    await detail.getByPlaceholder('Lage, Tätigkeit, Material').fill('Baum auf Fahrbahn, per Funk gemeldet.');

    // Provenance is never faked: a KP write leaves the personnel columns NULL,
    // and that absence — not a guess — is what the line renders.
    await expect(detail.getByText(/\(Funkmeldung\)/)).toBeVisible({ timeout: SMOKE_TIMEOUT });
    await expect(detail.getByText(/\(Feld\)/)).toHaveCount(0);
    await expect(detail.getByText(/^Abgeschlossen /)).toBeVisible();
  });
});
