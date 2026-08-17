import type { Browser, Page } from '@playwright/test';
import { test, expect } from '../../fixtures/auth.fixture';
import { FeldPage } from '../../pages/feld.page';
import {
  assignPersonnel,
  assignResource,
  cookieHeaderFor,
  createEvent,
  createIncident,
  createPersonnel,
  deleteEvent,
  deletePersonnel,
  firstMaterialId,
  generateFeldLink,
  getFeldCode,
  setSpecialFunction,
  type TestIncident,
  type TestPersonnel,
} from '../../helpers/api.helper';

/**
 * `/feld` — the door (plan 26) and the Magazin role.
 *
 * The sibling spec walks a crew through a Rapport; this one asks the two
 * questions that walk cannot: **who gets in**, and **who else is allowed to
 * look**.
 *
 * The door is the whole of decision 13. Before plan 26 the poster link WAS the
 * credential: whoever photographed the QR on the wall — or was forwarded it in
 * a chat months later — opened somebody's live Ereignis. Now the link only buys
 * the right to be asked for four digits, and naming yourself binds the device to
 * that person. Every assertion below about "nothing is visible yet" is that
 * property, and nothing else in the suite enforces it: a regression here does
 * not break a single feature, it just quietly opens the page again.
 *
 * The Magazin role is the far end of the visibility union (`crud/feld/
 * visibility.py`). A Magazinwart is assigned to nothing, drives nothing and was
 * sent nowhere — the ONLY reason they see a Schadenplatz is that a piece of
 * their material is still standing on it. That makes them the case where "the
 * page shows what is yours" and "the page offers what is yours to do" come
 * apart: they must see the address, and must not be handed a crew's Rapport or
 * the three reports the server would answer with a 403.
 *
 * What each test defends:
 *  1. the link alone opens NOTHING — not the picker, not a Schadenplatz.
 *  2. a wrong code is a red line and nothing else: no picker, and deliberately
 *     no toast (a typo is the expected answer here, not a fault to report).
 *  3. the right code reveals the picker, picking a name reveals that person's
 *     list — and "Nicht ich" asks first, then lands back on the code screen.
 *  4. a Magazin person assigned to nothing at all still sees the Schadenplatz
 *     their material is on, read-only.
 *
 * **Three unlocks in the whole file, and that is a budget, not a coincidence.**
 * `POST /api/feld/unlock` is rate limited to `10 per 10 minutes` PER CLIENT IP
 * (`RateLimits.FELD_UNLOCK`), and every spec on this machine is one IP — so the
 * walk-in-and-out-again half of the door (test 3) is one test rather than two.
 * Split it and this file plus its siblings can exhaust the ceiling and fail with
 * a 429 that looks exactly like a broken door.
 */

const FELD_TIMEOUT = 20_000;

interface DoorFixture {
  eventName: string;
  link: string;
  code: string;
  incident: TestIncident;
  crew: TestPersonnel | null;
  magazin: TestPersonnel | null;
}

/** Everything created here, torn down in afterEach — the dev DB is the user's board. */
const created: { events: string[]; personnel: string[] } = { events: [], personnel: [] };

/**
 * One training Ereignis, one Schadenplatz, the poster link and its code.
 *
 * `crew` puts a normal assigned firefighter in the picker (what the door tests
 * need somebody to be). `magazin` instead creates a person with the Magazin
 * function and NO assignment anywhere, and hangs a piece of material on the
 * Schadenplatz — the only thread that can pull them into the list.
 */
async function arrangeField(
  page: Page,
  prefix: string,
  options: { crew?: boolean; magazin?: boolean } = {},
): Promise<DoorFixture> {
  const cookieHeader = await cookieHeaderFor(page);
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const event = await createEvent(page.request, cookieHeader, `${prefix} ${stamp}`);
  created.events.push(event.id);

  const incident = await createIncident(page.request, cookieHeader, event.id, {
    title: `${prefix} Schadenplatz ${stamp}`,
    status: 'active',
    location_address: `${prefix}weg ${stamp}, 4104 Oberwil`,
  });

  let crew: TestPersonnel | null = null;
  if (options.crew !== false) {
    crew = await createPersonnel(page.request, cookieHeader, `Trupp Muster ${stamp}`, {
      role: 'Feuerwehrmann',
    });
    created.personnel.push(crew.id);
    await assignPersonnel(page.request, cookieHeader, incident.id, crew.id);
  }

  let magazin: TestPersonnel | null = null;
  if (options.magazin) {
    magazin = await createPersonnel(page.request, cookieHeader, `Magazin Muster ${stamp}`, {
      role: 'Magazinwart',
    });
    created.personnel.push(magazin.id);
    // Deliberately no `assignPersonnel` for this one anywhere: the function plus
    // the material out on the Schadenplatz is the entire claim under test.
    await setSpecialFunction(page.request, cookieHeader, event.id, magazin.id, 'magazin');
    await assignResource(
      page.request,
      cookieHeader,
      incident.id,
      'material',
      await firstMaterialId(page.request, cookieHeader),
    );
  }

  return {
    eventName: event.name,
    link: await generateFeldLink(page.request, cookieHeader, event.id),
    code: await getFeldCode(page.request, cookieHeader, event.id),
    incident,
    crew,
    magazin,
  };
}

/**
 * A phone: its own context, no session cookie, nothing at all.
 *
 * Deliberately does NOT open the link — these tests are about the door itself,
 * so each one navigates when and how it wants to.
 */
async function fieldPhone(browser: Browser): Promise<{ page: Page; feld: FeldPage }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  return { page, feld: new FeldPage(page) };
}

/**
 * Four digits that are not the Ereignis' own — one past it, wrapping at 9999.
 *
 * Derived rather than hard-coded: a literal would be the right code roughly once
 * every ten thousand runs, and that failure would look like a broken door.
 */
function wrongCode(code: string): string {
  return String((Number(code) + 1) % 10000).padStart(4, '0');
}

/** The street part of the address — what both `/feld` list and detail render. */
function street(incident: TestIncident): string {
  return (incident.location_address ?? '').split(',')[0];
}

test.describe('/feld: die Tür und der Magazin-Blick', { tag: '@smoke' }, () => {
  test.afterEach(async ({ authenticatedPage }) => {
    const cookieHeader = await cookieHeaderFor(authenticatedPage);
    for (const id of created.events.splice(0)) {
      await deleteEvent(authenticatedPage.request, cookieHeader, id);
    }
    for (const id of created.personnel.splice(0)) {
      await deletePersonnel(authenticatedPage.request, cookieHeader, id);
    }
  });

  test('der Posterlink allein öffnet nichts — nur den Code-Schirm', async ({
    authenticatedPage,
    browser,
  }) => {
    const fixture = await arrangeField(authenticatedPage, 'Tuer');

    const { page: phone, feld } = await fieldPhone(browser);
    try {
      await phone.goto(fixture.link);

      // The code screen, and only that. This is the security property plan 26
      // bought: before it, this same navigation landed on the picker.
      await expect(phone.getByRole('heading', { name: 'Code eingeben' })).toBeVisible({
        timeout: FELD_TIMEOUT,
      });
      await expect(feld.codeInput).toBeVisible();

      // Nothing about the Ereignis has leaked to a device that only holds the
      // link — not the roster, not a name, not an address.
      await expect(feld.personSearch).toHaveCount(0);
      await expect(phone.getByText(fixture.crew!.name)).toHaveCount(0);
      await expect(phone.getByText(street(fixture.incident))).toHaveCount(0);
      await expect(phone.getByText(fixture.eventName)).toHaveCount(0);
    } finally {
      await phone.context().close();
    }
  });

  test('ein falscher Code wird abgewiesen — mit «Falscher Code», ohne Toast', async ({
    authenticatedPage,
    browser,
  }) => {
    const fixture = await arrangeField(authenticatedPage, 'Falschcode');

    const { page: phone, feld } = await fieldPhone(browser);
    try {
      await phone.goto(fixture.link);
      await expect(feld.codeInput).toBeVisible({ timeout: FELD_TIMEOUT });

      await feld.codeInput.fill(wrongCode(fixture.code));
      await feld.submitCodeButton.click();

      await expect(feld.codeError).toBeVisible({ timeout: FELD_TIMEOUT });
      // Refused means refused: still no picker, and the box is cleared for the
      // next attempt rather than left holding the wrong digits.
      await expect(feld.personSearch).toHaveCount(0);
      await expect(feld.codeInput).toHaveValue('');

      // …and NO toast. `unlockFeld` passes `skipToast` on purpose
      // (`lib/api-client.ts`): a mistyped PIN is the expected answer to a wet
      // thumb, not a fault worth an "API Fehler" card sliding over the screen.
      // Drop that flag and every typo becomes a report of something broken.
      await expect(phone.locator('[data-sonner-toast]')).toHaveCount(0);
      await expect(phone.getByText('API Fehler')).toHaveCount(0);
    } finally {
      await phone.context().close();
    }
  });

  test('der richtige Code zeigt den Picker — und «Nicht ich» schliesst wieder ab', async ({
    authenticatedPage,
    browser,
  }) => {
    const fixture = await arrangeField(authenticatedPage, 'Codewalk');
    const crew = fixture.crew!;

    const { page: phone, feld } = await fieldPhone(browser);
    try {
      await phone.goto(fixture.link);
      await expect(feld.codeInput).toBeVisible({ timeout: FELD_TIMEOUT });
      await expect(feld.personSearch).toHaveCount(0);

      await feld.codeInput.fill(fixture.code);
      await feld.submitCodeButton.click();

      // The picker is exactly what the four digits buy — no more: the device is
      // still nobody until it names itself.
      await expect(feld.personSearch).toBeVisible({ timeout: FELD_TIMEOUT });
      await expect(phone.getByText(fixture.eventName)).toBeVisible();

      await feld.pickPerson(crew.name);
      // Naming yourself binds the token to that person (decision 18) — and what
      // comes back is their own Schadenplatz, by address, the way a crew
      // standing on the street matches it.
      await expect(feld.assignmentRow(street(fixture.incident))).toBeVisible({
        timeout: FELD_TIMEOUT,
      });

      // The button sits one thumb-width from the rest of the header on a wet
      // phone, and since plan 26 it costs the device its bound token — so it
      // asks. A "Nicht ich" that just swapped the name could be tapped by
      // accident; this one cannot.
      await phone.getByRole('button', { name: 'Nicht ich' }).first().click();
      const confirm = phone.getByRole('alertdialog');
      await expect(confirm.getByText('Abmelden?')).toBeVisible({ timeout: FELD_TIMEOUT });
      // Nothing has happened yet: the list is still the same person's.
      await expect(feld.assignmentRow(street(fixture.incident))).toBeVisible();

      await confirm.getByRole('button', { name: 'Nicht ich' }).click();

      // All the way back to the door, not just back to the picker: whoever
      // takes the phone next types the code. That is what makes the binding a
      // rule instead of a request.
      await expect(phone.getByRole('heading', { name: 'Code eingeben' })).toBeVisible({
        timeout: FELD_TIMEOUT,
      });
      await expect(feld.personSearch).toHaveCount(0);
      await expect(phone.getByText(crew.name)).toHaveCount(0);
    } finally {
      await phone.context().close();
    }
  });

  test('der Magazinwart sieht eine Materialtabelle — nicht eine Liste von Einsätzen', async ({
    authenticatedPage,
    browser,
  }) => {
    // No crew at all on this Ereignis: this person is assigned to nothing,
    // drives nothing and was sent nowhere. Material still standing out there is
    // their ONLY thread to the Schadenplatz — which is what puts them in the
    // picker at all, and that half of the union is unchanged.
    //
    // What changed is what they get once they are in. They used to be handed
    // the *Schadenplatz* their material happened to hang off, which answers the
    // wrong question: they look after the material, not the incidents, and a
    // unit sitting safely in the Magazin appeared nowhere at all.
    const fixture = await arrangeField(authenticatedPage, 'Depot', { crew: false, magazin: true });
    const magazin = fixture.magazin!;

    const { page: phone, feld } = await fieldPhone(browser);
    try {
      await feld.open(fixture.link, fixture.code);
      await feld.pickPerson(magazin.name);

      // The table, headed by the one number they want first.
      const table = phone.getByRole('table');
      await expect(table).toBeVisible({ timeout: FELD_TIMEOUT });
      await expect(phone.getByText(/von \d+ draussen/)).toBeVisible();

      // The unit that is out names the Schadenplatz it is standing on…
      const out = table.getByRole('row').filter({ hasText: 'draussen' }).first();
      await expect(out).toBeVisible();
      await expect(out).toContainText(street(fixture.incident));

      // …and the stand-in it replaced is gone: no Schadenplatz row, no source
      // tag, no explanatory sentence, because the table says all three better.
      await expect(feld.assignmentRow(street(fixture.incident))).toHaveCount(0);
      await expect(phone.getByText('Material von hier ist noch nicht zurück')).toHaveCount(0);
      await expect(phone.getByText('kein Rapport')).toHaveCount(0);

      // «Melden» stays: noticing something is not a crew privilege.
      await expect(phone.getByRole('button', { name: 'Melden', exact: true })).toBeVisible();
    } finally {
      await phone.context().close();
    }
  });
});
