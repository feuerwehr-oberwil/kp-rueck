import { test, expect } from '../../fixtures/auth.fixture';
import type { Page } from '@playwright/test';
import { MOBILE_VIEWPORT, setupBoard } from '../../helpers/api.helper';

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
