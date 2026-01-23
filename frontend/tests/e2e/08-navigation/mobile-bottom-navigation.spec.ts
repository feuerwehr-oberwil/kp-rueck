import { test, expect } from '../../fixtures/auth.fixture';
import { EventsPage } from '../../pages/events.page';

/**
 * Mobile Bottom Navigation Tests
 * Tests the mobile-only bottom tab bar with iOS/Android safe area support
 * Tests primary tabs (Kanban, Map, Events) and "More" sheet
 */

test.describe('Mobile Bottom Navigation - Visibility', () => {
  let eventsPage: EventsPage;
  let testEventName: string;

  test('bottom navigation is visible on mobile viewport', async ({ authenticatedPage }) => {
    // Set mobile viewport
    await authenticatedPage.setViewportSize({ width: 375, height: 667 });

    eventsPage = new EventsPage(authenticatedPage);
    testEventName = `Mobile Nav Test ${Date.now()}`;
    await eventsPage.goto();
    await eventsPage.createEvent(testEventName);
    await eventsPage.goto();
    await eventsPage.selectEvent(testEventName);
    await expect(authenticatedPage).toHaveURL('/');

    // Wait for page to load
    await authenticatedPage.waitForTimeout(1000);

    // Verify bottom navigation is visible
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

    eventsPage = new EventsPage(authenticatedPage);
    testEventName = `Desktop Nav Test ${Date.now()}`;
    await eventsPage.goto();
    await eventsPage.createEvent(testEventName);
    await eventsPage.goto();
    await eventsPage.selectEvent(testEventName);
    await expect(authenticatedPage).toHaveURL('/');

    // Wait for page to load
    await authenticatedPage.waitForTimeout(1000);

    // Verify bottom navigation is NOT visible (md:hidden class)
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

    eventsPage = new EventsPage(authenticatedPage);
    testEventName = `Safe Area Test ${Date.now()}`;
    await eventsPage.goto();
    await eventsPage.createEvent(testEventName);
    await eventsPage.goto();
    await eventsPage.selectEvent(testEventName);
    await expect(authenticatedPage).toHaveURL('/');
    await authenticatedPage.waitForTimeout(1000);

    // Check that safe area inset is applied
    const bottomNav = authenticatedPage.locator('nav.fixed.bottom-0');
    const hasSafeArea = await bottomNav.evaluate(el => {
      const style = el.getAttribute('style');
      return style?.includes('safe-area-inset-bottom') || false;
    });
    expect(hasSafeArea).toBeTruthy();
  });
});

test.describe('Mobile Bottom Navigation - Tab Navigation', () => {
  let eventsPage: EventsPage;
  let testEventName: string;

  test.beforeEach(async ({ authenticatedPage }) => {
    // Set mobile viewport
    await authenticatedPage.setViewportSize({ width: 375, height: 667 });

    eventsPage = new EventsPage(authenticatedPage);
    testEventName = `Tab Nav Test ${Date.now()}`;
    await eventsPage.goto();
    await eventsPage.createEvent(testEventName);
    await eventsPage.goto();
    await eventsPage.selectEvent(testEventName);
    await expect(authenticatedPage).toHaveURL('/');
    await authenticatedPage.waitForTimeout(1000);
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

  test('events tab navigates to events page', async ({ authenticatedPage }) => {
    // Click Events tab
    const eventsTab = authenticatedPage.locator('nav.fixed.bottom-0 a[href="/events"]');
    await eventsTab.click();

    // Verify navigation
    await expect(authenticatedPage).toHaveURL('/events');

    // Verify active state
    const isActive = await eventsTab.evaluate(el => el.getAttribute('aria-current'));
    expect(isActive).toBe('page');
  });
});

test.describe('Mobile Bottom Navigation - Active Tab Highlighting', () => {
  let eventsPage: EventsPage;
  let testEventName: string;

  test.beforeEach(async ({ authenticatedPage }) => {
    await authenticatedPage.setViewportSize({ width: 375, height: 667 });

    eventsPage = new EventsPage(authenticatedPage);
    testEventName = `Active Tab Test ${Date.now()}`;
    await eventsPage.goto();
    await eventsPage.createEvent(testEventName);
    await eventsPage.goto();
    await eventsPage.selectEvent(testEventName);
    await expect(authenticatedPage).toHaveURL('/');
    await authenticatedPage.waitForTimeout(1000);
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
  let eventsPage: EventsPage;
  let testEventName: string;

  test.beforeEach(async ({ authenticatedPage }) => {
    await authenticatedPage.setViewportSize({ width: 375, height: 667 });

    eventsPage = new EventsPage(authenticatedPage);
    testEventName = `More Sheet Test ${Date.now()}`;
    await eventsPage.goto();
    await eventsPage.createEvent(testEventName);
    await eventsPage.goto();
    await eventsPage.selectEvent(testEventName);
    await expect(authenticatedPage).toHaveURL('/');
    await authenticatedPage.waitForTimeout(1000);
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

    // Verify secondary items are present
    await expect(sheet.locator('text=Einstellungen')).toBeVisible();
    await expect(sheet.locator('text=Statistiken')).toBeVisible();
    await expect(sheet.locator('text=Divera Notfälle')).toBeVisible();
    await expect(sheet.locator('text=Hilfe & Dokumentation')).toBeVisible();
  });

  test('more sheet shows admin items for editors', async ({ authenticatedPage }) => {
    // Open More sheet
    const moreButton = authenticatedPage.locator('nav.fixed.bottom-0 button[aria-label="Mehr Optionen"]');
    await moreButton.click();

    const sheet = authenticatedPage.locator('[role="dialog"]');
    await expect(sheet).toBeVisible({ timeout: 3000 });

    // Verify admin section is present (for editor role)
    await expect(sheet.locator('text=Administration')).toBeVisible();
    await expect(sheet.locator('text=Ressourcen')).toBeVisible();
    await expect(sheet.locator('text=Import/Export')).toBeVisible();
    await expect(sheet.locator('text=Audit-Protokoll')).toBeVisible();
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

    // Verify role badge is present
    const roleBadge = sheet.locator('[class*="badge"]').filter({
      has: authenticatedPage.locator('svg[class*="lucide-shield"], svg[class*="lucide-eye"]')
    }).first();
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

  test('events tab is always enabled', async ({ authenticatedPage }) => {
    await authenticatedPage.setViewportSize({ width: 375, height: 667 });

    // Go to events page (no event selected)
    await authenticatedPage.goto('/events');
    await authenticatedPage.waitForTimeout(1000);

    const bottomNav = authenticatedPage.locator('nav.fixed.bottom-0');
    const eventsTab = bottomNav.locator('a[href="/events"]');

    // Events tab should NOT be disabled
    const eventsDisabled = await eventsTab.evaluate(el =>
      el.className.includes('opacity-40') || el.className.includes('pointer-events-none')
    );
    expect(eventsDisabled).toBeFalsy();
  });
});

test.describe('Mobile Bottom Navigation - Touch Targets', () => {
  let eventsPage: EventsPage;
  let testEventName: string;

  test.beforeEach(async ({ authenticatedPage }) => {
    await authenticatedPage.setViewportSize({ width: 375, height: 667 });

    eventsPage = new EventsPage(authenticatedPage);
    testEventName = `Touch Target Test ${Date.now()}`;
    await eventsPage.goto();
    await eventsPage.createEvent(testEventName);
    await eventsPage.goto();
    await eventsPage.selectEvent(testEventName);
    await expect(authenticatedPage).toHaveURL('/');
    await authenticatedPage.waitForTimeout(1000);
  });

  test('all tabs have minimum 44px touch target', async ({ authenticatedPage }) => {
    const bottomNav = authenticatedPage.locator('nav.fixed.bottom-0');
    const tabs = await bottomNav.locator('a, button').all();

    for (const tab of tabs) {
      const height = await tab.evaluate(el => el.getBoundingClientRect().height);
      expect(height).toBeGreaterThanOrEqual(44);
    }
  });

  test('tabs are tappable on mobile', async ({ authenticatedPage }) => {
    // Tap Map tab
    const mapTab = authenticatedPage.locator('nav.fixed.bottom-0 a[href="/map"]');
    await mapTab.tap();

    // Verify navigation
    await expect(authenticatedPage).toHaveURL('/map');
  });
});

test.describe('Mobile Bottom Navigation - Accessibility', () => {
  let eventsPage: EventsPage;
  let testEventName: string;

  test.beforeEach(async ({ authenticatedPage }) => {
    await authenticatedPage.setViewportSize({ width: 375, height: 667 });

    eventsPage = new EventsPage(authenticatedPage);
    testEventName = `A11y Test ${Date.now()}`;
    await eventsPage.goto();
    await eventsPage.createEvent(testEventName);
    await eventsPage.goto();
    await eventsPage.selectEvent(testEventName);
    await expect(authenticatedPage).toHaveURL('/');
    await authenticatedPage.waitForTimeout(1000);
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
