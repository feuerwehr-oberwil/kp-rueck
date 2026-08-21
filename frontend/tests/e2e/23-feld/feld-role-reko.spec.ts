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
  pinLeader,
  setSpecialFunction,
  type TestIncident,
  type TestPersonnel,
} from '../../helpers/api.helper';

/**
 * `/feld` seen through the **reko** source (plan 26 §2.2).
 *
 * Four sources put a Schadenplatz on somebody's list — crew, reko, driver,
 * magazin — and reko is the one that disagrees with the page it lives on. A
 * Reko trupp was sent out to LOOK at a place and report back to the KP; it does
 * not work the Schadenplatz. So the row is a shortcut into the Reko form and
 * nothing else, and the server backs that up: `RAPPORT_SOURCES` and
 * `WORK_SOURCES` are both `('crew',)` in `backend/app/crud/feld/visibility.py`,
 * so a Rapport, «Einsatz beendet» and «Abholung» are refused for a reko holder
 * even when called directly. What this file defends is that the phone never
 * offers what the server would refuse.
 *
 * Both ways of becoming a Reko are covered, because they are two different
 * lines of code:
 *
 *  (a) the board's own path — `POST /reko/…/assign-reko`, which writes
 *      `purpose='reko'` on the assignment row. That column IS the signal.
 *  (b) the documented FALLBACK — the event-wide `reko` special function. Rows
 *      written before `purpose` existed (or by a path that forgets it) carry the
 *      default `'crew'` while the board still draws that person as the Reko.
 *      Without the fallback the field surface would lose that argument and hand
 *      a Reko trupp the working crew's page.
 *
 * Copy comes from `frontend/messages/de.json` under `feld.source.*` — the tag
 * («Reko-Auftrag»), the sentence that explains the row («Vom KP als Reko
 * zugeteilt») and the action it promises («Reko erfassen»).
 *
 * **Why this file is `serial` and arranges once.** The Feld-Code door is rate
 * limited at `FELD_UNLOCK = "10 per 10 minutes"` per IP
 * (`backend/app/middleware/rate_limit.py`) — a deliberately tight ceiling on
 * guessing four digits. A test file that walked the door per test would spend a
 * third of the whole suite's budget on its own, and a 429 arrives on the phone
 * as the same red «Falscher Code» box a wrong code does, so the failure reads
 * as a broken product rather than a spent budget. One Ereignis, one phone per
 * reader, and the bound token in the cookie carries the list back between
 * tests — three trips through the door for the file.
 */

const FIELD_TIMEOUT = 20_000;

interface RekoFixture {
  eventId: string;
  link: string;
  code: string;
  /** The Schadenplatz with a full crew, an EL, and a Reko via the board's path. */
  boardIncident: TestIncident;
  /** The Schadenplatz whose Reko holds nothing but the event-wide function. */
  fallbackIncident: TestIncident;
  leader: TestPersonnel;
  crew: TestPersonnel;
  /** (a) `purpose='reko'` — assigned through `assign-reko`. */
  rekoAssigned: TestPersonnel;
  /** (b) a plain crew row plus the event-wide reko function. */
  rekoByFunction: TestPersonnel;
}

/**
 * One Ereignis, two Schadenplätze, four people.
 *
 * `boardIncident` carries a pinned Einsatzleiter and a crew member on purpose:
 * the EL assertion is only worth anything if there IS an EL to name, so the
 * crew's row and the Reko's row can be compared against the same incident.
 */
async function arrangeReko(page: Page, prefix: string): Promise<RekoFixture> {
  const cookieHeader = await cookieHeaderFor(page);
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const event = await createEvent(page.request, cookieHeader, `${prefix} ${stamp}`);

  // `reko`, not `active`: this is the Schadenplatz a Reko trupp was sent to and
  // has not reported back on, which is the only state where a Reko auftrag is
  // still worth filing. Once the KP has disponiert (`enroute`/`active`/…), the
  // window is deliberately closed — the trupp's answer can no longer change the
  // decision, and the row says so instead of promising a form (§P2.6). That
  // case has its own suite, «wenn das Reko-Fenster zu ist».
  const boardIncident = await createIncident(page.request, cookieHeader, event.id, {
    title: `${prefix} Schadenplatz 1 ${stamp}`,
    status: 'reko',
    location_address: `${prefix}weg 1 ${stamp}, 4104 Oberwil`,
  });
  // Same reasoning as above — this one carries the fallback (function says Reko,
  // the assignment row does not), and it can only prove that while its window
  // is open.
  const fallbackIncident = await createIncident(page.request, cookieHeader, event.id, {
    title: `${prefix} Schadenplatz 2 ${stamp}`,
    status: 'reko',
    location_address: `${prefix}gasse 2 ${stamp}, 4104 Oberwil`,
  });

  const leader = await createPersonnel(page.request, cookieHeader, `Leiter Muster ${stamp}`, {
    role: 'Zugführer',
    roleSortOrder: 1,
  });
  const crew = await createPersonnel(page.request, cookieHeader, `Trupp Muster ${stamp}`, {
    role: 'Feuerwehrmann',
    roleSortOrder: 10,
  });
  const rekoAssigned = await createPersonnel(page.request, cookieHeader, `Reko Muster ${stamp}`, {
    role: 'Feuerwehrmann',
    roleSortOrder: 10,
  });
  const rekoByFunction = await createPersonnel(page.request, cookieHeader, `Späher Muster ${stamp}`, {
    role: 'Feuerwehrmann',
    roleSortOrder: 10,
  });

  // The working crew of Schadenplatz 1, with the EL pinned so nothing later can
  // re-derive the role and move the name the assertions read.
  const leaderAssignment = await assignPersonnel(page.request, cookieHeader, boardIncident.id, leader.id);
  await assignPersonnel(page.request, cookieHeader, boardIncident.id, crew.id);
  await pinLeader(page.request, cookieHeader, boardIncident.id, leaderAssignment.id);

  // (a) The board's path. The reko special function is what makes somebody
  // pickable as Reko on the board at all, so it is set first, exactly as the
  // KP would have it.
  await setSpecialFunction(page.request, cookieHeader, event.id, rekoAssigned.id, 'reko');
  await assignReko(page.request, cookieHeader, boardIncident.id, rekoAssigned.id);

  // (b) The fallback: the function says "Reko", the assignment row does not.
  // `assignPersonnel` is the pre-`purpose` shape and defaults to 'crew'.
  await setSpecialFunction(page.request, cookieHeader, event.id, rekoByFunction.id, 'reko');
  await assignPersonnel(page.request, cookieHeader, fallbackIncident.id, rekoByFunction.id);

  return {
    eventId: event.id,
    link: await generateFeldLink(page.request, cookieHeader, event.id),
    code: await getFeldCode(page.request, cookieHeader, event.id),
    boardIncident,
    fallbackIncident,
    leader,
    crew,
    rekoAssigned,
    rekoByFunction,
  };
}

/**
 * The street part of an incident's address.
 *
 * A `/feld` row is headed by the ADDRESS, not the title
 * (`address || assignment.incident_title` in `app/feld/page.tsx`), and the home
 * city is stripped off it for display — so the street is what a row can be
 * located by from the outside.
 */
function street(incident: TestIncident): string {
  return (incident.location_address ?? '').split(',')[0];
}

/** One row of "meine Schadenplätze", located the way a crew locates it: by street. */
function row(page: Page, incident: TestIncident) {
  return page.locator('button').filter({ hasText: street(incident) }).first();
}

// ---------------------------------------------------------------- the phones

/** Everything created here, torn down in afterAll — the dev DB is the user's board. */
let fixture: RekoFixture;
let kpPage: Page;
const phones = new Map<string, { page: Page; feld: FeldPage }>();

/**
 * The phone of one reader, on their list.
 *
 * First call walks the door and names the person; every call after that only
 * re-opens the poster link, because the *bound* token sits in a cookie and the
 * page restores from it (`TOKEN_COOKIE`, `app/feld/page.tsx`). That is both the
 * honest simulation — a crew does not re-type the code every time they unlock
 * the phone — and what keeps the file inside the unlock budget.
 */
async function phoneFor(browser: Browser, person: TestPersonnel) {
  const cached = phones.get(person.id);
  if (cached) {
    await cached.page.goto(fixture.link);
    await expect(cached.page.getByText(person.name).first()).toBeVisible({ timeout: FIELD_TIMEOUT });
    return cached;
  }
  const context = await browser.newContext();
  const page = await context.newPage();
  const feld = new FeldPage(page);
  await feld.open(fixture.link, fixture.code);
  await feld.pickPerson(person.name);
  const phone = { page, feld };
  phones.set(person.id, phone);
  return phone;
}

// `serial` because the phones and the Ereignis are shared: a test that fails
// mid-walk leaves the next one on an unknown view, and re-deriving that state
// costs another trip through the rate-limited door.
test.describe.configure({ mode: 'serial' });

test.describe('/feld als Reko-Trupp', () => {
  test.beforeAll(async ({ browser, authCookies }) => {
    const kpContext = await browser.newContext();
    await kpContext.addCookies(authCookies);
    kpPage = await kpContext.newPage();
    fixture = await arrangeReko(kpPage, 'Reko');
  });

  test.afterAll(async () => {
    for (const { page } of phones.values()) await page.context().close();
    phones.clear();
    const cookieHeader = await cookieHeaderFor(kpPage);
    await deleteEvent(kpPage.request, cookieHeader, fixture.eventId);
    for (const person of [fixture.leader, fixture.crew, fixture.rekoAssigned, fixture.rekoByFunction]) {
      await deletePersonnel(kpPage.request, cookieHeader, person.id);
    }
    await kpPage.context().close();
  });

  test('der Reko-Auftrag steht auf der Liste – als Reko angeschrieben, nicht als Einsatz', async ({
    browser,
  }) => {
    const { page: phone } = await phoneFor(browser, fixture.rekoAssigned);

    const rekoRow = row(phone, fixture.boardIncident);
    await expect(rekoRow).toBeVisible({ timeout: FIELD_TIMEOUT });

    // The tag, the sentence and the promise — `feld.source.reko`, `rekoReason`,
    // `rekoAction`. Three separate strings because they answer three separate
    // questions: what this is, why it is on MY list, and what tapping does.
    await expect(rekoRow.getByText('Reko-Auftrag', { exact: true })).toBeVisible();
    await expect(rekoRow.getByText('Vom KP als Reko zugeteilt')).toBeVisible();
    await expect(rekoRow.getByText('Reko erfassen', { exact: true })).toBeVisible();

    // No Rapport chip: the trupp does not owe a Schadenplatz-Rapport, and a
    // «kein Rapport» badge on their row would be a debt they cannot settle.
    await expect(rekoRow.getByText('kein Rapport', { exact: true })).toHaveCount(0);
    await expect(rekoRow.getByText('Rapport erfasst', { exact: true })).toHaveCount(0);
  });

  test('die Reko-Zeile nennt keinen Einsatzleiter – die Crew-Zeile daneben schon', async ({
    browser,
  }) => {
    const { page: phone } = await phoneFor(browser, fixture.rekoAssigned);
    const rekoRow = row(phone, fixture.boardIncident);
    await expect(rekoRow).toBeVisible({ timeout: FIELD_TIMEOUT });

    // The Einsatzleiter leads the crew that WORKS the Schadenplatz. A trupp
    // sent out to look at it reports back to the KP, so the line is absent
    // rather than empty — «kein EL erfasst» would read as a gap in the board.
    await expect(rekoRow.getByText('kein EL erfasst')).toHaveCount(0);
    await expect(rekoRow.getByText(/^EL: /)).toHaveCount(0);
    await expect(rekoRow.getByText('Du bist EL', { exact: false })).toHaveCount(0);

    // Same Schadenplatz, same pinned EL, a different reader. This half is what
    // stops the assertions above from passing on a fixture that simply has no
    // Einsatzleiter to name.
    const { page: crewPhone } = await phoneFor(browser, fixture.crew);
    const crewRow = row(crewPhone, fixture.boardIncident);
    await expect(crewRow).toBeVisible({ timeout: FIELD_TIMEOUT });
    await expect(crewRow.getByText(`EL: ${fixture.leader.name}`)).toBeVisible();
  });

  test('das Antippen öffnet das Reko-Formular – nicht die Schadenplatz-Seite', async ({ browser }) => {
    const { page: phone, feld } = await phoneFor(browser, fixture.rekoAssigned);
    await row(phone, fixture.boardIncident).click();

    // Tapping a reko row mints a short-lived form token and navigates OUT of
    // `/feld` (`openAssignment`, `app/feld/page.tsx`) — a real route change,
    // not a `viewMode` switch. `mint_reko_link` is gated on `SOURCE_REKO`, so
    // arriving here at all is the server agreeing about the role.
    await phone.waitForURL(/\/reko\?/, { timeout: FIELD_TIMEOUT });
    await expect(phone.getByText('Einsatz relevant?')).toBeVisible({ timeout: FIELD_TIMEOUT });
    await expect(phone.getByRole('button', { name: 'Reko-Bericht übermitteln' })).toBeVisible();

    // None of the crew's field actions, and no Rapport anywhere. The server
    // refuses all of them for a reko source; an offer that 403s in the rain is
    // worse than no offer.
    await expect(feld.arrivedButton).toHaveCount(0);
    await expect(feld.completeButton).toHaveCount(0);
    await expect(feld.pickupButton).toHaveCount(0);
    await expect(feld.submitRapportButton).toHaveCount(0);
    await expect(feld.kurzberichtField).toHaveCount(0);
    await expect(feld.title).toHaveCount(0);

    // …and it still has to feel like the same app: the identity bar rides along
    // on the `feld-person-name` cookie (path "/" for exactly this reason),
    // naming who is filing, over the subtitle «Reko erfassen».
    await expect(phone.getByText(fixture.rekoAssigned.name).first()).toBeVisible();
    await expect(phone.getByText('Reko erfassen', { exact: true }).first()).toBeVisible();
  });

  test('die ereignisweite Reko-Funktion trägt allein – auch ohne purpose auf der Zuteilung', async ({
    browser,
  }) => {
    const { page: phone, feld } = await phoneFor(browser, fixture.rekoByFunction);

    // The assignment row says `purpose='crew'`; only the event-wide function
    // says Reko. If the fallback in `visibility.py` ever goes, this row turns
    // into a crew page — Rapport, «Einsatz beendet», Abholung and all — for
    // somebody the board draws as the Reko.
    const fallbackRow = row(phone, fixture.fallbackIncident);
    await expect(fallbackRow).toBeVisible({ timeout: FIELD_TIMEOUT });
    await expect(fallbackRow.getByText('Reko-Auftrag', { exact: true })).toBeVisible();
    await expect(fallbackRow.getByText('Vom KP als Reko zugeteilt')).toBeVisible();
    await expect(fallbackRow.getByText('Reko erfassen', { exact: true })).toBeVisible();
    await expect(fallbackRow.getByText('kein EL erfasst')).toHaveCount(0);

    // And it behaves like one all the way through — the tap has to reach the
    // Reko form, which only a `SOURCE_REKO` holder is allowed to mint.
    await fallbackRow.click();
    await phone.waitForURL(/\/reko\?/, { timeout: FIELD_TIMEOUT });
    await expect(phone.getByText('Einsatz relevant?')).toBeVisible({ timeout: FIELD_TIMEOUT });
    await expect(feld.submitRapportButton).toHaveCount(0);
  });
});
