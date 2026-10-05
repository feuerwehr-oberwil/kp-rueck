import { test, expect } from '../../fixtures/auth.fixture';
import type { Locator, Page } from '@playwright/test';
import { dismissOverlays } from '../07-viewer-role/viewer-role.helpers';

/**
 * Role Badge Tests
 * Tests the role badge component that displays the user's role
 * (`components/auth/role-badge.tsx`).
 *
 * Since bca38bdb the badge always says its role in words — the translated
 * `settings.users.roles` label (Admin / Bearbeiter / Betrachter), never the old
 * English «Editor»/«Viewer» — and always in the neutral `secondary` variant:
 * red is priority and danger only, a role is neither. The icon (Shield for
 * anyone who may edit, Eye for viewers) is what still tells the two apart.
 * The suite logs in as the seeded `admin`, so the editor-side label is «Admin».
 *
 * The badge is NOT in the navigation bar. It lives in the `AccountBlock`
 * (`components/auth/account-block.tsx`), which sits in two places, both of
 * which Radix keeps unmounted while closed:
 *   - desktop: at the top of the UserMenu dropdown (`components/user-menu.tsx`)
 *   - mobile:  in the «Konto» section of the bottom navigation's "Mehr" sheet
 *              (`components/mobile-bottom-navigation.tsx`)
 * Every assertion below therefore has to open the containing menu first.
 *
 * These tests used to locate the badge with `[class*="badge"]`, which never
 * matched anything at all — the shadcn Badge emits utility classes, none of
 * which contain the string "badge". Locate it by its `data-slot="badge"`
 * contract instead, scoped to the menu it lives in.
 */

// These tests are the first thing in a run to touch /events, /settings and
// /help, and a cold Next dev server compiles a route on first visit — which on
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
 * A role badge is the one badge carrying a Shield (editor) or Eye (viewer)
 * icon — specific enough not to collide with any other badge on the page.
 */
const ROLE_BADGE =
  '[data-slot="badge"]:has(svg[class*="lucide-shield"], svg[class*="lucide-eye"])';

const roleBadge = (container: Locator | Page): Locator =>
  container.locator(ROLE_BADGE);

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

test.describe('Role Badge - Editor', () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    await selectAnyEvent(authenticatedPage);
  });

  test('editor badge lives in the user menu, not in the navigation bar', async ({
    authenticatedPage,
  }) => {
    // Radix keeps the dropdown unmounted while closed, so the badge is not in
    // the DOM at all until the menu opens — the move this suite previously
    // failed to notice.
    await expect(roleBadge(authenticatedPage)).toHaveCount(0);

    const menu = await openUserMenu(authenticatedPage);
    await expect(roleBadge(menu)).toHaveText(ADMIN_LABEL);
  });

  test('editor badge shows Shield icon', async ({ authenticatedPage }) => {
    const menu = await openUserMenu(authenticatedPage);
    const badge = roleBadge(menu);

    await expect(badge).toBeVisible();
    await expect(badge.locator('svg[class*="lucide-shield"]')).toBeVisible();
    await expect(badge.locator('svg[class*="lucide-eye"]')).toHaveCount(0);
  });

  test('editor badge uses the neutral (secondary) variant, not red', async ({
    authenticatedPage,
  }) => {
    const menu = await openUserMenu(authenticatedPage);
    const badge = roleBadge(menu);

    // Every role gets <Badge variant="secondary">: the red `default` variant
    // is reserved for priority and danger. The icon carries the difference.
    await expect(badge).toHaveClass(/bg-secondary/);
    await expect(badge).not.toHaveClass(/bg-primary/);
  });
});

test.describe('Role Badge - Editor on Multiple Pages', () => {
  // `/resources` used to be in this list; it is a redirect stub to
  // /settings?section=personnel, so it only ever tested /settings by accident.
  for (const path of ['/', '/events', '/settings']) {
    test(`editor badge is reachable on ${path}`, async ({ authenticatedPage }) => {
      await selectAnyEvent(authenticatedPage);
      await authenticatedPage.goto(path);

      const menu = await openUserMenu(authenticatedPage);
      await expect(roleBadge(menu)).toHaveText(ADMIN_LABEL);
    });
  }
});

test.describe('Role Badge - Mobile Behavior', () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    await authenticatedPage.setViewportSize(MOBILE_VIEWPORT);
    await selectAnyEvent(authenticatedPage);
  });

  test('editor badge shows icon and label in the mobile "Mehr" sheet', async ({
    authenticatedPage,
  }) => {
    // The desktop nav (and with it the UserMenu) is `hidden md:flex`, so on a
    // phone the badge is only reachable through the bottom navigation.
    await expect(
      authenticatedPage.getByRole('button', { name: USER_MENU_TRIGGER }),
    ).toBeHidden();

    const sheet = await openMobileMoreSheet(authenticatedPage);
    const badge = roleBadge(sheet);

    await expect(badge).toBeVisible();
    await expect(badge.locator('svg[class*="lucide-shield"]')).toBeVisible();

    // The phone used to show the icon alone, which nobody could read; the
    // badge now says its role at every width.
    await expect(badge).toHaveText(ADMIN_LABEL);
    await expect(badge.getByText(ADMIN_LABEL)).toBeVisible();
  });
});

/**
 * Viewers are bounced to /display/board by `ProtectedRoute`, and the display
 * pages carry no UserMenu — so the badge's viewer branch is only reachable on
 * `/help`, the one nav-bearing page that is not behind ProtectedRoute.
 */
test.describe('Role Badge - Viewer', () => {
  test.beforeEach(async ({ viewerPage }) => {
    await viewerPage.goto('/help');
  });

  test('shows viewer badge with Eye icon', async ({ viewerPage }) => {
    const menu = await openUserMenu(viewerPage);
    const badge = roleBadge(menu);

    await expect(badge).toHaveText(VIEWER_LABEL);
    await expect(badge.locator('svg[class*="lucide-eye"]')).toBeVisible();
    await expect(badge.locator('svg[class*="lucide-shield"]')).toHaveCount(0);
  });

  test('viewer badge uses the secondary variant', async ({ viewerPage }) => {
    const menu = await openUserMenu(viewerPage);
    const badge = roleBadge(menu);

    await expect(badge).toHaveClass(/bg-secondary/);
    await expect(badge).not.toHaveClass(/bg-primary/);
  });
});

test.describe('Role Badge - Unauthenticated User', () => {
  test('badge does not show when not logged in', async ({ page }) => {
    await page.goto('/login');

    // No user, no badge — RoleBadge returns null. And nothing on the login
    // page opens a menu that could contain one.
    await expect(roleBadge(page)).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: USER_MENU_TRIGGER }),
    ).toHaveCount(0);
  });
});
