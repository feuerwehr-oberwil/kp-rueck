import { test, expect } from '../../fixtures/auth.fixture';
import type { Locator, Page } from '@playwright/test';
import { dismissOverlays } from '../07-viewer-role/viewer-role.helpers';

/**
 * The role badge (`components/auth/role-badge.tsx`) says the role in words – the translated
 * `settings.users.roles` label (Admin / Bearbeiter / Betrachter). The suite logs in as the
 * seeded `admin`, so the editor-side label is «Admin».
 *
 * It is NOT in the navigation bar but in the `AccountBlock`, which Radix keeps unmounted
 * while closed: desktop at the top of the UserMenu dropdown, phone in the «Konto» section of
 * the «Mehr» sheet. So every test opens the containing menu first.
 *
 * Its look (secondary variant, Shield/Eye icon) is the visual screens' business, not this
 * file's.
 */

// These tests are the first thing in a run to touch /events and /help, and a cold Next dev server compiles a route on first visit — which on
// its own ate more than the 30 s default. Triple the budget rather than let a
// compile masquerade as a missing badge. No assertion is relaxed by this.
test.beforeEach(() => {
  test.slow();
});

const USER_MENU_TRIGGER = 'Benutzermenü öffnen';
const MOBILE_MORE_TRIGGER = 'Mehr Optionen';
const MOBILE_VIEWPORT = { width: 375, height: 667 };

/** Opens the desktop UserMenu dropdown and returns it. */
async function openUserMenu(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: USER_MENU_TRIGGER }).click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  return menu;
}

/** Opens the mobile bottom-navigation "Mehr" sheet and returns it. */
async function openMobileMoreSheet(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: MOBILE_MORE_TRIGGER }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();
  return sheet;
}

/**
 * The badge is the one `data-slot="badge"` in the menu that says the role. Found by its
 * words rather than its icon, so a different glyph or variant does not hide it.
 */
const roleBadge = (container: Locator, label: string): Locator =>
  container.locator('[data-slot="badge"]').filter({ hasText: label });

/** Label of the seeded `admin` account the suite logs in as (`settings.users.roles.admin`). */
const ADMIN_LABEL = 'Admin';
/** Label of the seeded `viewer` account (`settings.users.roles.viewer`). */
const VIEWER_LABEL = 'Betrachter';

/**
 * `/` renders an "Ereignis auswählen" empty state — with no navigation and so
 * no user menu — until an event is picked. Pick whichever one the seed left
 * behind; nothing here cares which. Read-only for the viewer too: the choice
 * is client-side.
 */
async function selectAnyEvent(page: Page): Promise<void> {
  await page.goto('/events');
  await page.getByRole('button', { name: 'Auswählen' }).first().click();
  await page.waitForURL('/');
  // The Setup-Checkliste popover opens itself on a freshly selected event and
  // would swallow the click on the user-menu trigger behind it.
  await dismissOverlays(page);
}

test.describe('Role Badge', () => {
  test('an editor finds the role in the user menu, not in the navigation bar', async ({
    authenticatedPage,
  }) => {
    await selectAnyEvent(authenticatedPage);
    // Radix keeps the dropdown unmounted while closed, so the badge is not in the DOM
    // at all until the menu opens.
    await expect(authenticatedPage.locator('[data-slot="badge"]', { hasText: ADMIN_LABEL })).toHaveCount(0);

    const menu = await openUserMenu(authenticatedPage);
    await expect(roleBadge(menu, ADMIN_LABEL)).toBeVisible();
  });

  test('on the phone the role is in the «Mehr» sheet, in words', async ({ authenticatedPage }) => {
    await authenticatedPage.setViewportSize(MOBILE_VIEWPORT);
    await selectAnyEvent(authenticatedPage);
    // The desktop nav (and with it the UserMenu) is `hidden md:flex`.
    await expect(authenticatedPage.getByRole('button', { name: USER_MENU_TRIGGER })).toBeHidden();

    const sheet = await openMobileMoreSheet(authenticatedPage);
    await expect(roleBadge(sheet, ADMIN_LABEL)).toBeVisible();
  });

  /**
   * Viewers are bounced to /display/board by `ProtectedRoute`, and the display pages carry
   * no UserMenu – so the viewer branch is only reachable on `/help`, the one nav-bearing
   * page that is not behind ProtectedRoute.
   */
  test('a viewer is told «Betrachter»', async ({ viewerPage }) => {
    await viewerPage.goto('/help');
    const menu = await openUserMenu(viewerPage);
    await expect(roleBadge(menu, VIEWER_LABEL)).toBeVisible();
  });
});
