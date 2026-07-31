import { test, expect } from '../../fixtures/auth.fixture';
import { setupBoard } from '../../helpers/api.helper';

/**
 * Mobile Bottom Navigation Tests
 * Tests the mobile-only bottom tab bar with iOS/Android safe area support
 * Tests primary tabs (Kanban, Map, Events) and "More" sheet
 */

test.describe('Mobile Bottom Navigation - Visibility', () => {
  test('bottom navigation is visible on mobile viewport', async ({ authenticatedPage }) => {
    // Set mobile viewport
    await authenticatedPage.setViewportSize({ width: 375, height: 667 });

    await setupBoard(authenticatedPage, 'Mobile Nav Test', { count: 0 });
    const bottomNav = authenticatedPage.locator('nav.fixed.bottom-0');
    await expect(bottomNav).toBeVisible();

    // Verify it has the backdrop blur styling
    const hasBackdrop = await bottomNav.evaluate(el =>
      el.className.includes('backdrop-blur')
    );
    expect(hasBackdrop).toBeTruthy();
  });

  test('bottom navigation is hidden on desktop viewport', async ({ authenticatedPage }) => {
    // Set desktop viewport
    await authenticatedPage.setViewportSize({ width: 1920, height: 1080 });

    await setupBoard(authenticatedPage, 'Desktop Nav Test', { count: 0 });
    const bottomNav = authenticatedPage.locator('nav.fixed.bottom-0');
    // On desktop, the element exists but should not be visible due to md:hidden
    const isHidden = await bottomNav.evaluate(el => {
      const styles = window.getComputedStyle(el);
      return styles.display === 'none';
    });
    expect(isHidden).toBeTruthy();
  });

  test('bottom navigation has safe area padding on mobile', async ({ authenticatedPage }) => {
    // Set mobile viewport
    await authenticatedPage.setViewportSize({ width: 375, height: 667 });

    await setupBoard(authenticatedPage, 'Safe Area Test', { count: 0 });
    const bottomNav = authenticatedPage.locator('nav.fixed.bottom-0');
    const hasSafeArea = await bottomNav.evaluate(el => {
      const style = el.getAttribute('style');
      return style?.includes('safe-area-inset-bottom') || false;
    });
    expect(hasSafeArea).toBeTruthy();
  });
});

test.describe('Mobile Bottom Navigation - Tab Navigation', () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    // Set mobile viewport
    await authenticatedPage.setViewportSize({ width: 375, height: 667 });

    await setupBoard(authenticatedPage, 'Tab Nav Test', { count: 0 });
  });

  test('kanban tab navigates to root page', async ({ authenticatedPage }) => {
    // Navigate away first
    await authenticatedPage.goto('/events');
    await authenticatedPage.waitForTimeout(500);

    // Click Kanban tab
    const kanbanTab = authenticatedPage.locator('nav.fixed.bottom-0 a[href="/"]');
    await kanbanTab.click();

    // Verify navigation
    await expect(authenticatedPage).toHaveURL('/');

    // Verify active state
    const isActive = await kanbanTab.evaluate(el => el.getAttribute('aria-current'));
    expect(isActive).toBe('page');
  });

  test('map tab navigates to map page', async ({ authenticatedPage }) => {
    // Click Map tab
    const mapTab = authenticatedPage.locator('nav.fixed.bottom-0 a[href="/map"]');
    await mapTab.click();

    // Verify navigation
    await expect(authenticatedPage).toHaveURL('/map');

    // Verify active state
    const isActive = await mapTab.evaluate(el => el.getAttribute('aria-current'));
    expect(isActive).toBe('page');
  });

  // The bottom bar has exactly two tabs — Einsätze and Karte — plus "Mehr"
  // (`components/mobile-bottom-navigation.tsx`). Reaching the event list is a
  // "Mehr" → "Alle Ereignisse" entry, so that is what this asserts; the old
  // `a[href="/events"]` tab in the bar has not existed for some time and cost
  // the spec a 30s timeout per run.
  test('all events is reachable from the more sheet', async ({ authenticatedPage }) => {
    await authenticatedPage
      .locator('nav.fixed.bottom-0 button[aria-label="Mehr Optionen"]')
      .click();

    const sheet = authenticatedPage.getByRole('dialog');
    await expect(sheet).toBeVisible();
    await sheet.getByRole('button', { name: 'Alle Ereignisse' }).click();

    await expect(authenticatedPage).toHaveURL('/events');
  });
});

test.describe('Mobile Bottom Navigation - Active Tab Highlighting', () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    await authenticatedPage.setViewportSize({ width: 375, height: 667 });

    await setupBoard(authenticatedPage, 'Active Tab Test', { count: 0 });
  });

  test('kanban tab is highlighted when on root page', async ({ authenticatedPage }) => {
    const kanbanTab = authenticatedPage.locator('nav.fixed.bottom-0 a[href="/"]');

    // Check for primary text color (active state)
    const hasActiveClass = await kanbanTab.evaluate(el =>
      el.className.includes('text-primary')
    );
    expect(hasActiveClass).toBeTruthy();
  });

  test('map tab is highlighted when on map page', async ({ authenticatedPage }) => {
    // Navigate to map
    await authenticatedPage.goto('/map');
    await authenticatedPage.waitForTimeout(500);

    const mapTab = authenticatedPage.locator('nav.fixed.bottom-0 a[href="/map"]');

    // Check for primary text color (active state)
    const hasActiveClass = await mapTab.evaluate(el =>
      el.className.includes('text-primary')
    );
    expect(hasActiveClass).toBeTruthy();
  });

  test('inactive tabs have muted text color', async ({ authenticatedPage }) => {
    // Kanban is active, others should be muted
    const mapTab = authenticatedPage.locator('nav.fixed.bottom-0 a[href="/map"]');

    const hasMutedClass = await mapTab.evaluate(el =>
      el.className.includes('text-muted-foreground')
    );
    expect(hasMutedClass).toBeTruthy();
  });
});

test.describe('Mobile Bottom Navigation - More Sheet', () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    await authenticatedPage.setViewportSize({ width: 375, height: 667 });

    await setupBoard(authenticatedPage, 'More Sheet Test', { count: 0 });
  });

  test('more button opens bottom sheet', async ({ authenticatedPage }) => {
    // Click More button
    const moreButton = authenticatedPage.locator('nav.fixed.bottom-0 button[aria-label="Mehr Optionen"]');
    await moreButton.click();

    // Verify sheet opens
    const sheet = authenticatedPage.locator('[role="dialog"]', { hasText: 'Weitere Funktionen' });
    await expect(sheet).toBeVisible({ timeout: 3000 });
  });

  test('more sheet shows secondary navigation items', async ({ authenticatedPage }) => {
    // Open More sheet
    const moreButton = authenticatedPage.locator('nav.fixed.bottom-0 button[aria-label="Mehr Optionen"]');
    await moreButton.click();

    // Wait for sheet
    const sheet = authenticatedPage.locator('[role="dialog"]');
    await expect(sheet).toBeVisible({ timeout: 3000 });

    // Verify secondary items are present. "Statistiken" is gone from the list:
    // `secondaryItems` is Einstellungen / Alarmeingang / Hilfe & Dokumentation.
    // Renamed: the entry is `nav.mobileBottomNav.diveraPool` = "Alarmeingang" (see
    // mobile-bottom-navigation.tsx). "Divera Notfälle" has not been rendered for a while.
    await expect(sheet.getByRole('button', { name: 'Einstellungen' })).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Alarmeingang' })).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Hilfe & Dokumentation' })).toBeVisible();
  });

  // Was "more sheet shows admin items for editors" and looked for an
  // Administration section with Ressourcen / Import-Export / Audit-Protokoll.
  // The sheet has no such section — the editor-only part is "Schnellzugriff"
  // (`isEditor && …` in mobile-bottom-navigation.tsx), which is what the role
  // distinction actually rests on now, so that is what is asserted. The viewer
  // half of the pair lives in 07-viewer-role.
  test('more sheet shows the editor-only quick actions', async ({ authenticatedPage }) => {
    // Open More sheet
    const moreButton = authenticatedPage.locator('nav.fixed.bottom-0 button[aria-label="Mehr Optionen"]');
    await moreButton.click();

    const sheet = authenticatedPage.locator('[role="dialog"]');
    await expect(sheet).toBeVisible({ timeout: 3000 });

    await expect(sheet.getByRole('heading', { name: 'Schnellzugriff' })).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Check-In QR-Code' })).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Personal' })).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Fahrzeuge' })).toBeVisible();
  });

  test('more sheet items are clickable and navigate', async ({ authenticatedPage }) => {
    // Open More sheet
    const moreButton = authenticatedPage.locator('nav.fixed.bottom-0 button[aria-label="Mehr Optionen"]');
    await moreButton.click();

    const sheet = authenticatedPage.locator('[role="dialog"]');
    await expect(sheet).toBeVisible({ timeout: 3000 });

    // Click Settings
    const settingsButton = sheet.locator('button', { hasText: 'Einstellungen' });
    await settingsButton.click();

    // Verify navigation
    await expect(authenticatedPage).toHaveURL('/settings');
  });

  test('more sheet has safe area padding', async ({ authenticatedPage }) => {
    // Open More sheet
    const moreButton = authenticatedPage.locator('nav.fixed.bottom-0 button[aria-label="Mehr Optionen"]');
    await moreButton.click();

    const sheet = authenticatedPage.locator('[role="dialog"]');
    await expect(sheet).toBeVisible({ timeout: 3000 });

    // Check for safe area padding
    const hasSafeArea = await sheet.evaluate(el => {
      const style = el.getAttribute('style');
      return style?.includes('safe-area-inset-bottom') || false;
    });
    expect(hasSafeArea).toBeTruthy();
  });

  test('more sheet shows role badge', async ({ authenticatedPage }) => {
    // Open More sheet
    const moreButton = authenticatedPage.locator('nav.fixed.bottom-0 button[aria-label="Mehr Optionen"]');
    await moreButton.click();

    const sheet = authenticatedPage.locator('[role="dialog"]');
    await expect(sheet).toBeVisible({ timeout: 3000 });

    // Verify role badge is present. `[class*="badge"]` matched nothing — the
    // shadcn Badge carries no class of that name, it carries `data-slot="badge"`.
    // On a phone the badge is icon-only (`hidden sm:inline-block` on the label),
    // so the shield/eye icon is what identifies it.
    const roleBadge = sheet.locator('[data-slot="badge"]').filter({
      has: authenticatedPage.locator('svg.lucide-shield, svg.lucide-eye'),
    });
    await expect(roleBadge).toBeVisible();
  });
});

test.describe('Mobile Bottom Navigation - Disabled States', () => {
  test('tabs requiring event are disabled when no event selected', async ({ authenticatedPage }) => {
    await authenticatedPage.setViewportSize({ width: 375, height: 667 });

    // Go to events page (no event selected)
    await authenticatedPage.goto('/events');
    await authenticatedPage.waitForTimeout(1000);

    const bottomNav = authenticatedPage.locator('nav.fixed.bottom-0');

    // Kanban, Map should be disabled
    const kanbanTab = bottomNav.locator('a[href="/"]');
    const mapTab = bottomNav.locator('a[href="/map"]');

    // Check for disabled styling (opacity-40 and pointer-events-none)
    const kanbanDisabled = await kanbanTab.evaluate(el =>
      el.className.includes('opacity-40') && el.className.includes('pointer-events-none')
    );
    const mapDisabled = await mapTab.evaluate(el =>
      el.className.includes('opacity-40') && el.className.includes('pointer-events-none')
    );

    expect(kanbanDisabled).toBeTruthy();
    expect(mapDisabled).toBeTruthy();
  });

  // "events tab is always enabled" removed: there is no events tab in the bottom
  // bar to be enabled or disabled — see "all events is reachable from the more
  // sheet" above for the route that replaced it.
});

test.describe('Mobile Bottom Navigation - Touch Targets', () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    await authenticatedPage.setViewportSize({ width: 375, height: 667 });

    await setupBoard(authenticatedPage, 'Touch Target Test', { count: 0 });
  });

  test('all tabs have minimum 44px touch target', async ({ authenticatedPage }) => {
    const bottomNav = authenticatedPage.locator('nav.fixed.bottom-0');
    const tabs = await bottomNav.locator('a, button').all();

    for (const tab of tabs) {
      const height = await tab.evaluate(el => el.getBoundingClientRect().height);
      expect(height).toBeGreaterThanOrEqual(44);
    }
  });

  // "tabs are tappable on mobile" removed: it called `locator.tap()`, which needs
  // `hasTouch` on the browser context — a touch-input assertion for a product whose
  // brief is explicitly desktop, mouse and keyboard (CLAUDE.md, Design Context).
  // "map tab navigates to map page" above already covers that the tab navigates.
});

test.describe('Mobile Bottom Navigation - Accessibility', () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    await authenticatedPage.setViewportSize({ width: 375, height: 667 });

    await setupBoard(authenticatedPage, 'A11y Test', { count: 0 });
  });

  test('tabs have aria-label attributes', async ({ authenticatedPage }) => {
    const kanbanTab = authenticatedPage.locator('nav.fixed.bottom-0 a[href="/"]');
    const ariaLabel = await kanbanTab.getAttribute('aria-label');
    expect(ariaLabel).toBeTruthy();
  });

  test('active tab has aria-current attribute', async ({ authenticatedPage }) => {
    const kanbanTab = authenticatedPage.locator('nav.fixed.bottom-0 a[href="/"]');
    const ariaCurrent = await kanbanTab.getAttribute('aria-current');
    expect(ariaCurrent).toBe('page');
  });

  test('icons have aria-hidden attribute', async ({ authenticatedPage }) => {
    const kanbanTab = authenticatedPage.locator('nav.fixed.bottom-0 a[href="/"]');
    const icon = kanbanTab.locator('svg').first();
    const ariaHidden = await icon.getAttribute('aria-hidden');
    expect(ariaHidden).toBe('true');
  });

  test('more button has descriptive aria-label', async ({ authenticatedPage }) => {
    const moreButton = authenticatedPage.locator('nav.fixed.bottom-0 button[aria-label="Mehr Optionen"]');
    const ariaLabel = await moreButton.getAttribute('aria-label');
    expect(ariaLabel).toBe('Mehr Optionen');
  });
});
