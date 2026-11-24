import { test, expect } from '../../fixtures/auth.fixture';
import type { Page } from '@playwright/test';
import { API_BASE, MOBILE_VIEWPORT, cookieHeaderFor, setupBoard } from '../../helpers/api.helper';

/**
 * The phone's bottom bar: two tabs (Einsätze, Karte) and «Mehr», whose sheet reaches the
 * rest. What it must do is get the operator to every page, and keep the tabs that need an
 * Ereignis shut while none is chosen.
 *
 * How it looks (active tint, muted inactive tabs, backdrop blur, safe-area padding, 44px
 * targets) used to be asserted here class by class; the phone visual screen and the
 * overflow scan carry that now. Which page and role get the quick actions is
 * `mobile-bottom-navigation.test.tsx`; here only that the real board wires them.
 */

/** The bar is the navigation landmark that holds «Mehr» (its classes differ per page). */
const bottomNav = (page: Page) =>
  page.getByRole('navigation').filter({ has: page.getByRole('button', { name: 'Mehr Optionen' }) });

/** `next dev` compiles a route on its first visit; on a busy runner that alone takes seconds. */
const ROUTE_COMPILE_MS = 15_000;

test.describe('Mobile bottom navigation', () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    await authenticatedPage.setViewportSize(MOBILE_VIEWPORT);
  });

  test('the two tabs switch between the board and the map', async ({ authenticatedPage: page }) => {
    await setupBoard(page, 'Mobile Nav', { count: 0 });
    const nav = bottomNav(page);
    const board = nav.locator('a[href="/"]');
    const map = nav.locator('a[href="/map"]');
    await expect(board).toHaveAttribute('aria-current', 'page');

    await map.click();
    await expect(page).toHaveURL('/map', { timeout: ROUTE_COMPILE_MS });
    await expect(map).toHaveAttribute('aria-current', 'page');

    await board.click();
    await expect(page).toHaveURL('/', { timeout: ROUTE_COMPILE_MS });
    await expect(board).toHaveAttribute('aria-current', 'page');
  });

  for (const [entry, path] of [
    ['Alle Ereignisse', '/events'],
    ['Einstellungen', '/settings'],
  ] as const) {
    test(`«Mehr» reaches ${entry}`, async ({ authenticatedPage: page }) => {
      await setupBoard(page, 'Mobile Mehr', { count: 0 });
      await bottomNav(page).getByRole('button', { name: 'Mehr Optionen' }).click();
      // A page entry is the row itself as a link (Button asChild), not a button inside a link.
      await page.getByRole('dialog').getByRole('link', { name: entry }).click();
      await expect(page).toHaveURL(path, { timeout: ROUTE_COMPILE_MS });
    });
  }

  // The same menu on the board and on the Lagekarte (owner, 16.11.2026): the sheets are the
  // nav's own, so the map opens them over itself instead of offering only Kennzahlen.
  for (const [where, path] of [
    ['the board', '/'],
    ['the Lagekarte', '/map'],
  ] as const) {
    test(`the «Mehr» sheet offers an editor the quick actions on ${where}`, async ({ authenticatedPage: page }) => {
      await setupBoard(page, 'Mobile Mehr', { count: 0 });
      if (path !== '/') await page.goto(path);
      await bottomNav(page).getByRole('button', { name: 'Mehr Optionen' }).click({ timeout: ROUTE_COMPILE_MS });

      const sheet = page.getByRole('dialog');
      await expect(sheet.getByRole('heading', { name: 'Schnellzugriff' })).toBeVisible();
      await expect(sheet.getByRole('button', { name: 'Links & QR' })).toBeVisible();
      await expect(sheet.getByRole('button', { name: 'Personal' })).toBeVisible();
      await sheet.getByRole('button', { name: 'Fahrzeuge' }).click();

      await expect(page.getByRole('dialog', { name: 'Fahrzeugstatus' })).toBeVisible();
      await expect(page).toHaveURL(path);
    });
  }

  // Routenplanung and Reko-Modus are KP-desk tools (owner, 24.11.2026): the phone's Ansicht
  // menu offers neither, and the Setup-Checkliste's `?mode=reko` link opens the plain list.
  test('the Lagekarte offers no Routenplanung and no Reko-Modus', async ({ authenticatedPage: page }) => {
    await setupBoard(page, 'Mobile Modes', { count: 0 });
    await page.goto('/map?mode=reko');
    await expect(page.getByRole('heading', { name: /Einsätze/ })).toBeVisible({ timeout: ROUTE_COMPILE_MS });
    await expect(page.getByRole('heading', { name: 'Reko-Modus' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Ansicht' }).click();
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Routenplanung' })).toHaveCount(0);
    await expect(menu.getByRole('menuitem', { name: 'Reko-Modus' })).toHaveCount(0);
  });

  // Phone sweep 24.11.2026 (#4, #29): a row tap opens the Einsatz – the double tap nobody knew
  // of is gone – the sheet's «Auf Karte anzeigen» stays on this page, and the selected row's
  // Abholung is a label, not the «Abholung disponiert» button (the phone board is read-only).
  test('a Lagekarte row opens its Einsatz with one tap, and the sheet stays on the Lagekarte', async ({
    authenticatedPage: page,
  }) => {
    const { incidents } = await setupBoard(page, 'Mobile Karte', { count: 1, layout: 'mobile' });
    const pickup = await page.request.post(`${API_BASE}/api/incidents/${incidents[0].id}/field-report`, {
      data: { pickup_needed: true },
      headers: { cookie: await cookieHeaderFor(page) },
    });
    expect(pickup.ok()).toBe(true);
    await page.goto('/map');

    const row = page.locator(`#map-incident-card-${incidents[0].id}`);
    await row.click({ timeout: ROUTE_COMPILE_MS });
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByRole('heading', { name: /Mobile Kartestrasse/ })).toBeVisible();

    await sheet.getByRole('button', { name: 'Auf Karte anzeigen' }).click();
    await expect(sheet).toHaveCount(0);
    await expect(page).toHaveURL('/map');
    await expect(row).toHaveAttribute('aria-current', 'true');
    await expect(page.getByText('Abholung').first()).toBeVisible();
    await expect(page.getByRole('button', { name: /Abholung/ })).toHaveCount(0);
  });

  // The phone's «Neuer Einsatz» sheet opens the map picker as a step inside itself, as the desk
  // dialog does (owner pick 5A) – not as a centred desk card over the sheet.
  test('the map picker of «Neuer Einsatz» is a step in the phone sheet', async ({ authenticatedPage: page }) => {
    await setupBoard(page, 'Mobile Picker', { count: 0 });
    await page.getByRole('button', { name: 'Neuer Einsatz' }).click();
    const sheet = page.getByRole('dialog', { name: 'Neuer Einsatz' });
    await sheet.getByRole('button', { name: 'Auf Karte wählen' }).click();

    await expect(page.getByRole('dialog')).toHaveCount(1);
    await expect(sheet.getByRole('heading', { name: 'Einsatzort auf Karte wählen' })).toBeVisible();

    await sheet.getByRole('button', { name: 'Zurück' }).click();
    await expect(sheet.getByLabel('Einsatzort')).toBeVisible();
  });

  test('without a chosen Ereignis the board and map tabs cannot be tapped', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/events');
    const nav = bottomNav(page);
    await expect(nav).toBeVisible();
    // `pointer-events: none` is what shuts them – the one style this spec reads.
    for (const href of ['/', '/map']) {
      await expect(nav.locator(`a[href="${href}"]`)).toHaveCSS('pointer-events', 'none');
    }
  });
});
