import { test, expect } from '../../fixtures/auth.fixture';
import type { APIRequestContext, Locator, Page } from '@playwright/test';
import {
  API_BASE,
  cookieHeaderFor,
  createEventWithIncident,
  dismissOverlays,
  selectEvent,
  type BoardFixture,
} from '../07-viewer-role/viewer-role.helpers';

/**
 * Resource summary — crew, vehicles and materials per incident.
 *
 * This suite used to assert all of it on the kanban card: "Crew (0)",
 * "Fahrzeuge (0)", "Material (0)", three [+] buttons, a CheckCircle when
 * something was assigned and an XCircle when nothing was. None of that is on
 * the card any more (`components/kanban/draggable-operation.tsx`): the counted
 * sections moved into the detail view (`operation-detail-content.tsx`, and its
 * phone-sized twin `mobile/mobile-incident-detail-sheet.tsx`), and the card now
 * shows the assigned resources by *name* instead of by count.
 *
 * Two further pieces of rot were hiding behind the move, both of the kind that
 * fails silently rather than loudly:
 *   - the label is "Mannschaft", not "Crew" — `text=Crew` matched nothing
 *     anywhere in the app, so simply re-pointing the old locators at the detail
 *     view would still have found nothing;
 *   - the checkmark/cross icons were located by `svg[class*="lucide-x-circle"]`,
 *     and no such icon exists in this app at all. Unassigned is now said in
 *     words ("Keine Mannschaft zugewiesen"), which is what is asserted below.
 *
 * Setup goes through the REST API rather than the events page and the "Neuer
 * Einsatz" modal. That modal commits its address through a geocoder popover, so
 * the old UI setup made every test here depend on network to Nominatim — and it
 * is why this one file took 22 minutes in the nightly run.
 */

/** The three resource sections, as the detail view renders them. */
const SECTIONS = [
  {
    id: 'crew',
    /** `common.crewCount` etc. — the heading is label + live count. */
    heading: /^Mannschaft \(\d+\)$/,
    zero: 'Mannschaft (0)',
    icon: 'lucide-users',
    /** `title` on the add control (`common.assignCrew`). */
    addTitle: 'Mannschaft zuweisen',
    empty: 'Keine Mannschaft zugewiesen',
  },
  {
    id: 'vehicles',
    heading: /^Fahrzeuge \(\d+\)$/,
    zero: 'Fahrzeuge (0)',
    icon: 'lucide-truck',
    addTitle: 'Fahrzeug zuweisen',
    empty: 'Keine Fahrzeuge zugewiesen',
  },
  {
    id: 'materials',
    heading: /^Material \(\d+\)$/,
    zero: 'Material (0)',
    icon: 'lucide-package',
    addTitle: 'Material zuweisen',
    empty: 'Kein Material zugewiesen',
  },
] as const;

const MOBILE_VIEWPORT = { width: 375, height: 667 };

/** The detail modal — `[role="dialog"]` alone also matches Radix popovers. */
const detailModal = (page: Page): Locator =>
  page.locator('[role="dialog"][data-slot="dialog-content"][data-state="open"]');

const incidentCard = (page: Page, address: string): Locator =>
  page.getByTestId('incident-card').filter({ hasText: address });

/**
 * Open an incident's detail view from the board.
 *
 * Only below 1536px (`SIDE_PANEL_BREAKPOINT`) does a card click open the modal;
 * above it the same click loads the side panel instead. The Playwright project
 * is Desktop Chrome at 1280px, so the modal is the path under test — the panel
 * renders the very same `OperationDetailContent`.
 */
async function openDetail(page: Page, address: string): Promise<Locator> {
  await incidentCard(page, address).click();
  const modal = detailModal(page);
  await expect(modal).toBeVisible({ timeout: 15_000 });
  return modal;
}

/**
 * Get the Setup-Checkliste popover out of the way — and wait for it first.
 *
 * It opens itself once per newly selected event (`autoOpenedEventRef` in
 * app/page.tsx) but *late*: only after the readiness summary has come back from
 * five API calls. Dismissing before that returns just leaves it to appear later,
 * mid-test, sitting over the board and swallowing clicks on the cards behind it.
 * So wait for it, then dismiss — once is enough, it never re-opens for the same
 * event. Waiting is safe: a brand-new event has no check-ins, no drivers and no
 * Reko officer, so the checklist can never already be complete.
 */
async function dismissSetupChecklist(page: Page) {
  await expect
    .poll(() => page.locator('[data-radix-popper-content-wrapper]').count(), {
      timeout: 30_000,
    })
    .toBeGreaterThan(0);
  await dismissOverlays(page);
}

/**
 * Close the detail modal by its own close control (`data-slot="dialog-close"`).
 *
 * Escape is deliberately not used: it is swallowed if any Radix layer opened
 * inside the modal is still winding down, and then the assertion that follows
 * reads a modal nobody meant to leave open.
 */
async function closeDetail(modal: Locator) {
  await modal.getByRole('button', { name: 'Close' }).click();
  await expect(modal).toBeHidden({ timeout: 15_000 });
}

/**
 * The section box around a heading: heading span → label group → header row →
 * section. Structural, but the alternative is matching Tailwind utility classes,
 * which is precisely how the old version of this file rotted unnoticed.
 */
const sectionAround = (heading: Locator): Locator =>
  heading.locator('xpath=ancestor::div[3]');

/** Board setup shared by every test: one event, one incident, board on screen. */
async function setUpBoard(
  page: Page,
  request: APIRequestContext,
  prefix: string,
): Promise<BoardFixture> {
  const fixture = await createEventWithIncident(
    request,
    await cookieHeaderFor(page),
    prefix,
  );
  await selectEvent(page, '/', fixture.eventId);
  await expect(incidentCard(page, fixture.address)).toBeVisible({ timeout: 15_000 });
  await dismissSetupChecklist(page);
  return fixture;
}

/**
 * Create a throwaway piece of equipment to assign, and hand back a disposer.
 *
 * Material, rather than the crew or the fleet, because it is the one of the
 * three that needs no other state to be assignable: the crew dialog offers only
 * personnel *checked in to this event*, and the vehicles section is a popover
 * (see `assignMaterialFromDetail`). A purpose-made name also means the dialog's
 * search narrows to exactly one row, and that nothing else holds the item — an
 * item committed elsewhere gets an amber flag and a confirmation step first.
 */
async function createTestMaterial(
  request: APIRequestContext,
  cookieHeader: string,
): Promise<{ name: string; dispose: () => Promise<void> }> {
  const headers = { 'Content-Type': 'application/json', cookie: cookieHeader };
  const name = `Testgerät ${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const response = await request.post(`${API_BASE}/api/materials/`, {
    headers,
    // No `group_id`: an ungrouped item is a plain row in the dialog, where a
    // module would be a collapsed group header instead.
    data: { name, type: 'Werkzeug', location: 'Testdepot', status: 'available' },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  const { id } = await response.json();
  return {
    name,
    // DELETE on a material is a soft delete — it flips the status to
    // "unavailable" rather than removing the row — so this keeps the item out of
    // the station's live inventory without pretending the fixture never existed.
    dispose: async () => {
      await request.delete(`${API_BASE}/api/materials/${id}`, { headers });
    },
  };
}

/**
 * Assign `materialName` through the detail view's "Material zuweisen" dialog.
 *
 * Not the vehicles section, whose add control is a popover that renders the
 * whole fleet in one unbounded column: at 1280×720 it already overflows the
 * viewport with the dev seed's nine vehicles, and Radix then shifts it so that
 * rows fall off the top instead — unreachable, because there is nothing to
 * scroll. Worth fixing in the app; a spec should not be the thing that depends
 * on the fleet being short. The assignment dialog searches and scrolls.
 */
async function assignMaterialFromDetail(page: Page, modal: Locator, materialName: string) {
  await modal.getByTitle('Material zuweisen').click();
  const dialog = page.getByRole('dialog', { name: 'Material zu Einsatz zuweisen' });
  await expect(dialog).toBeVisible({ timeout: 15_000 });

  await dialog.getByPlaceholder('Suchen...').fill(materialName);
  await dialog.getByRole('button', { name: materialName }).click();
  // Material selection is staged locally and only written on "Fertig".
  await dialog.getByRole('button', { name: 'Fertig' }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });
}

test.describe('Resource summary — the counted sections', () => {
  let fixture: BoardFixture;

  test.beforeEach(async ({ authenticatedPage, request }) => {
    fixture = await setUpBoard(authenticatedPage, request, 'Ressourcen');
  });

  test('the counts are in the detail view, not on the kanban card', async ({
    authenticatedPage,
  }) => {
    const card = incidentCard(authenticatedPage, fixture.address);

    // The move this suite failed to notice. Asserted together with the positive
    // half below, so a rename cannot turn it into a free pass.
    for (const section of SECTIONS) {
      await expect(card.getByText(section.heading)).toHaveCount(0);
    }

    const modal = await openDetail(authenticatedPage, fixture.address);
    for (const section of SECTIONS) {
      await expect(modal.getByText(section.heading)).toHaveText(section.zero);
    }
  });

  test('each section is labelled with its own icon', async ({ authenticatedPage }) => {
    const modal = await openDetail(authenticatedPage, fixture.address);

    for (const section of SECTIONS) {
      const label = modal.getByText(section.heading).locator('xpath=..');
      await expect(label.locator(`svg[class*="${section.icon}"]`)).toBeVisible();
    }
  });

  test('an empty section says so in words, not only by icon', async ({
    authenticatedPage,
  }) => {
    const modal = await openDetail(authenticatedPage, fixture.address);

    for (const section of SECTIONS) {
      const box = sectionAround(modal.getByText(section.heading));
      await expect(box.getByText(section.empty)).toBeVisible();
    }
  });
});

test.describe('Resource summary — the add controls', () => {
  let fixture: BoardFixture;

  test.beforeEach(async ({ authenticatedPage, request }) => {
    fixture = await setUpBoard(authenticatedPage, request, 'Zuweisen');
  });

  test('every section offers an add control naming what it assigns', async ({
    authenticatedPage,
  }) => {
    const modal = await openDetail(authenticatedPage, fixture.address);

    for (const section of SECTIONS) {
      // All three buttons read "Hinzufügen"; the `title` is the only thing that
      // says *what* gets added, so it is both the locator and the assertion.
      const add = sectionAround(modal.getByText(section.heading)).getByTitle(
        section.addTitle,
      );
      await expect(add).toBeVisible();
      await expect(add).toBeEnabled();
    }
  });

  test('the crew add control can be operated from the keyboard', async ({
    authenticatedPage,
  }) => {
    const modal = await openDetail(authenticatedPage, fixture.address);

    // Focus + Enter, with the dialog it opens as the proof. The predecessors of
    // this test focused the button and then asserted nothing at all.
    await modal.getByTitle('Mannschaft zuweisen').focus();
    await authenticatedPage.keyboard.press('Enter');

    await expect(
      authenticatedPage.getByRole('dialog', { name: 'Mannschaft zu Einsatz zuweisen' }),
    ).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('Resource summary — assigned state', () => {
  let fixture: BoardFixture;
  let material: { name: string; dispose: () => Promise<void> };

  test.beforeEach(async ({ authenticatedPage, request }) => {
    // Created before the board loads: the materials context fetches once on
    // mount, and an item added afterwards would not be in the list the dialog
    // renders from.
    material = await createTestMaterial(
      request,
      await cookieHeaderFor(authenticatedPage),
    );
    fixture = await setUpBoard(authenticatedPage, request, 'Zugewiesen');
  });

  test.afterEach(async () => {
    await material?.dispose();
  });

  test('assigning a resource raises the count and names it', async ({
    authenticatedPage,
  }) => {
    const modal = await openDetail(authenticatedPage, fixture.address);
    const heading = modal.getByText(/^Material \(\d+\)$/);
    await expect(heading).toHaveText('Material (0)');
    await expect(
      sectionAround(heading).getByText('Kein Material zugewiesen'),
    ).toBeVisible();

    await assignMaterialFromDetail(authenticatedPage, modal, material.name);

    await expect(heading).toHaveText('Material (1)');
    await expect(sectionAround(heading).getByText(material.name)).toBeVisible();
  });

  test('the search really narrows the list', async ({ authenticatedPage }) => {
    // `assignMaterialFromDetail` types into this box on its way to a row, but a
    // search that had stopped filtering would go unnoticed there: the row is in
    // the list either way. So assert the narrowing itself — and with exact
    // counts, not "no more than before", which is true even when nothing
    // happens at all.
    const modal = await openDetail(authenticatedPage, fixture.address);
    await modal.getByTitle('Material zuweisen').click();
    const dialog = authenticatedPage.getByRole('dialog', {
      name: 'Material zu Einsatz zuweisen',
    });
    await expect(dialog).toBeVisible({ timeout: 15_000 });

    const search = dialog.getByPlaceholder('Suchen...');
    const row = dialog.getByRole('button', { name: material.name });
    await expect(row).toHaveCount(1);

    await search.fill('gibtesnichtxyz');
    await expect(row).toHaveCount(0);
    await expect(dialog.getByText('Versuche einen anderen Suchbegriff')).toBeVisible();

    await search.fill(material.name);
    await expect(row).toHaveCount(1);
  });

  test('an assigned resource can be taken off again', async ({ authenticatedPage }) => {
    // The counterpart of the test above it. Assigning was covered; giving a
    // resource back was not, and it is the half an operator does under time
    // pressure when a squad is redirected.
    const modal = await openDetail(authenticatedPage, fixture.address);
    const heading = modal.getByText(/^Material \(\d+\)$/);
    await assignMaterialFromDetail(authenticatedPage, modal, material.name);
    await expect(heading).toHaveText('Material (1)');

    await modal.getByTitle('Material zuweisen').click();
    const dialog = authenticatedPage.getByRole('dialog', {
      name: 'Material zu Einsatz zuweisen',
    });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await dialog.getByPlaceholder('Suchen...').fill(material.name);
    // The row is a toggle: clicking an assigned one deselects it.
    await dialog.getByRole('button', { name: material.name }).click();
    await dialog.getByRole('button', { name: 'Fertig' }).click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });

    await expect(heading).toHaveText('Material (0)');
    await expect(
      sectionAround(heading).getByText('Kein Material zugewiesen'),
    ).toBeVisible();

    await closeDetail(modal);
    await expect(
      incidentCard(authenticatedPage, fixture.address).getByText(material.name),
    ).toHaveCount(0);
  });

  test('what is assigned shows on the kanban card, by name', async ({
    authenticatedPage,
  }) => {
    // The card lost the counts but not the job of reporting resources at a
    // glance — it lists them by name now, which is what this checks.
    const card = incidentCard(authenticatedPage, fixture.address);
    await expect(card.getByText(material.name)).toHaveCount(0);

    const modal = await openDetail(authenticatedPage, fixture.address);
    await assignMaterialFromDetail(authenticatedPage, modal, material.name);
    await closeDetail(modal);

    await expect(card.getByText(material.name)).toBeVisible({ timeout: 15_000 });
  });

  test('each incident keeps its own counts', async ({ authenticatedPage, request }) => {
    const cookieHeader = await cookieHeaderFor(authenticatedPage);
    const headers = { 'Content-Type': 'application/json', cookie: cookieHeader };
    const secondAddress = `Zweitstrasse ${Date.now()}`;
    const created = await request.post(`${API_BASE}/api/incidents/`, {
      headers,
      data: {
        event_id: fixture.eventId,
        title: 'Zweiter Einsatz',
        type: 'brandbekaempfung',
        priority: 'low',
        // 'active', not 'einsatz': the German column label is not the API enum,
        // and the POST was being rejected with a 422 on every run.
        status: 'active',
        location_address: `${secondAddress}, 4104 Oberwil`,
        location_lat: 47.4989,
        location_lng: 7.5567,
      },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    await expect(incidentCard(authenticatedPage, secondAddress)).toBeVisible({
      timeout: 15_000,
    });

    const firstModal = await openDetail(authenticatedPage, fixture.address);
    await assignMaterialFromDetail(authenticatedPage, firstModal, material.name);
    await expect(firstModal.getByText(/^Material \(\d+\)$/)).toHaveText('Material (1)');
    await closeDetail(firstModal);

    const secondModal = await openDetail(authenticatedPage, secondAddress);
    await expect(secondModal.getByText(/^Material \(\d+\)$/)).toHaveText('Material (0)');
    await expect(
      sectionAround(secondModal.getByText(/^Material \(\d+\)$/)).getByText(
        'Kein Material zugewiesen',
      ),
    ).toBeVisible();
  });
});

test.describe('Resource summary — phone layout', () => {
  test('the phone detail sheet carries the same three counted sections', async ({
    authenticatedPage,
    request,
  }) => {
    await authenticatedPage.setViewportSize(MOBILE_VIEWPORT);
    const fixture = await createEventWithIncident(
      request,
      await cookieHeaderFor(authenticatedPage),
      'Mobil',
    );
    await selectEvent(authenticatedPage, '/', fixture.eventId);

    // Below 768px the board is not the kanban at all but
    // `MobileIncidentListView`, whose cards carry no `data-testid` and open
    // `MobileIncidentDetailSheet` — a read-only twin of the detail view. The
    // old mobile tests looked for kanban cards at 375px and so asserted
    // against a component that does not render at that width.
    // No Setup-Checkliste to dismiss here: its popover lives in the desktop
    // footer, which the mobile branch never renders.
    await authenticatedPage.getByRole('heading', { name: fixture.address }).click();
    const sheet = authenticatedPage.getByRole('dialog');
    await expect(sheet).toBeVisible({ timeout: 15_000 });

    for (const section of SECTIONS) {
      await expect(sheet.getByText(section.heading)).toBeVisible();
      await expect(sheet.getByText(section.empty)).toBeVisible();
    }

    // Read-only on a phone: KP Rück is run from a desk, the phone is for
    // looking. No add controls here, and the desktop test above proves they
    // exist to be missing.
    for (const section of SECTIONS) {
      await expect(sheet.getByTitle(section.addTitle)).toHaveCount(0);
    }
  });
});
