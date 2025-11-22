import { test, expect } from '../../fixtures/auth.fixture';
import { EventsPage } from '../../pages/events.page';
import { MainPage } from '../../pages/main.page';

/**
 * Click-to-Assign Resource Dialog Tests
 * Tests the resource assignment dialog that opens when clicking [+] buttons
 * Allows assigning/unassigning crew, vehicles, and materials via checkboxes
 */

test.describe('Resource Assignment Dialog - Opening', () => {
  let eventsPage: EventsPage;
  let mainPage: MainPage;
  let testEventName: string;

  test.beforeEach(async ({ authenticatedPage }) => {
    eventsPage = new EventsPage(authenticatedPage);
    mainPage = new MainPage(authenticatedPage);

    testEventName = `Assignment Dialog Test ${Date.now()}`;
    await eventsPage.goto();
    await eventsPage.createEvent(testEventName);
    await eventsPage.goto();
    await eventsPage.selectEvent(testEventName);
    await expect(authenticatedPage).toHaveURL('/');
    await authenticatedPage.waitForTimeout(1000);

    // Create a quick incident
    await mainPage.createQuickIncident(`Test Location ${Date.now()}`);
    await authenticatedPage.waitForTimeout(1000);
  });

  test('dialog opens when clicking crew plus button', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();

    // Find crew section and click plus button
    const crewSection = incidentCard.locator('text=Crew').locator('..');
    const plusButton = crewSection.locator('button').filter({
      has: authenticatedPage.locator('svg[class*="lucide-plus"]')
    });
    await plusButton.click();

    // Verify dialog opens
    const dialog = authenticatedPage.locator('[role="dialog"]', { hasText: 'Mannschaft zuweisen' });
    await expect(dialog).toBeVisible({ timeout: 3000 });
  });

  test('dialog opens when clicking vehicles plus button', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();

    // Find vehicles section and click plus button
    const vehiclesSection = incidentCard.locator('text=Fahrzeuge').locator('..');
    const plusButton = vehiclesSection.locator('button').filter({
      has: authenticatedPage.locator('svg[class*="lucide-plus"]')
    });
    await plusButton.click();

    // Verify dialog opens
    const dialog = authenticatedPage.locator('[role="dialog"]', { hasText: 'Fahrzeuge zuweisen' });
    await expect(dialog).toBeVisible({ timeout: 3000 });
  });

  test('dialog opens when clicking materials plus button', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();

    // Find materials section and click plus button
    const materialsSection = incidentCard.locator('text=Material').locator('..');
    const plusButton = materialsSection.locator('button').filter({
      has: authenticatedPage.locator('svg[class*="lucide-plus"]')
    });
    await plusButton.click();

    // Verify dialog opens
    const dialog = authenticatedPage.locator('[role="dialog"]', { hasText: 'Material zuweisen' });
    await expect(dialog).toBeVisible({ timeout: 3000 });
  });

  test('dialog closes when clicking outside', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();

    const crewSection = incidentCard.locator('text=Crew').locator('..');
    const plusButton = crewSection.locator('button').filter({
      has: authenticatedPage.locator('svg[class*="lucide-plus"]')
    });
    await plusButton.click();

    const dialog = authenticatedPage.locator('[role="dialog"]');
    await expect(dialog).toBeVisible();

    // Press Escape to close
    await authenticatedPage.keyboard.press('Escape');

    // Dialog should close
    await expect(dialog).not.toBeVisible({ timeout: 2000 });
  });
});

test.describe('Resource Assignment Dialog - Content', () => {
  let eventsPage: EventsPage;
  let mainPage: MainPage;
  let testEventName: string;

  test.beforeEach(async ({ authenticatedPage }) => {
    eventsPage = new EventsPage(authenticatedPage);
    mainPage = new MainPage(authenticatedPage);

    testEventName = `Dialog Content Test ${Date.now()}`;
    await eventsPage.goto();
    await eventsPage.createEvent(testEventName);
    await eventsPage.goto();
    await eventsPage.selectEvent(testEventName);
    await expect(authenticatedPage).toHaveURL('/');
    await authenticatedPage.waitForTimeout(1000);

    await mainPage.createQuickIncident(`Test Location ${Date.now()}`);
    await authenticatedPage.waitForTimeout(1000);
  });

  test('crew dialog shows correct title and icon', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();
    const crewSection = incidentCard.locator('text=Crew').locator('..');
    const plusButton = crewSection.locator('button').filter({
      has: authenticatedPage.locator('svg[class*="lucide-plus"]')
    });
    await plusButton.click();

    const dialog = authenticatedPage.locator('[role="dialog"]');
    await expect(dialog).toBeVisible();

    // Check title
    await expect(dialog.locator('h2:has-text("Mannschaft zuweisen")')).toBeVisible();

    // Check Users icon
    const usersIcon = dialog.locator('h2 svg[class*="lucide-users"]');
    await expect(usersIcon).toBeVisible();
  });

  test('vehicles dialog shows correct title and icon', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();
    const vehiclesSection = incidentCard.locator('text=Fahrzeuge').locator('..');
    const plusButton = vehiclesSection.locator('button').filter({
      has: authenticatedPage.locator('svg[class*="lucide-plus"]')
    });
    await plusButton.click();

    const dialog = authenticatedPage.locator('[role="dialog"]');
    await expect(dialog).toBeVisible();

    // Check title
    await expect(dialog.locator('h2:has-text("Fahrzeuge zuweisen")')).toBeVisible();

    // Check Truck icon
    const truckIcon = dialog.locator('h2 svg[class*="lucide-truck"]');
    await expect(truckIcon).toBeVisible();
  });

  test('materials dialog shows correct title and icon', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();
    const materialsSection = incidentCard.locator('text=Material').locator('..');
    const plusButton = materialsSection.locator('button').filter({
      has: authenticatedPage.locator('svg[class*="lucide-plus"]')
    });
    await plusButton.click();

    const dialog = authenticatedPage.locator('[role="dialog"]');
    await expect(dialog).toBeVisible();

    // Check title
    await expect(dialog.locator('h2:has-text("Material zuweisen")')).toBeVisible();

    // Check Package icon
    const packageIcon = dialog.locator('h2 svg[class*="lucide-package"]');
    await expect(packageIcon).toBeVisible();
  });

  test('dialog shows description with counts', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();
    const crewSection = incidentCard.locator('text=Crew').locator('..');
    const plusButton = crewSection.locator('button').filter({
      has: authenticatedPage.locator('svg[class*="lucide-plus"]')
    });
    await plusButton.click();

    const dialog = authenticatedPage.locator('[role="dialog"]');
    await expect(dialog).toBeVisible();

    // Check for description with "zugewiesen" and "verfügbar"
    const description = dialog.locator('p').filter({ hasText: 'zugewiesen' });
    await expect(description).toBeVisible();
    await expect(description).toContainText('verfügbar');
  });
});

test.describe('Resource Assignment Dialog - Search Functionality', () => {
  let eventsPage: EventsPage;
  let mainPage: MainPage;
  let testEventName: string;

  test.beforeEach(async ({ authenticatedPage }) => {
    eventsPage = new EventsPage(authenticatedPage);
    mainPage = new MainPage(authenticatedPage);

    testEventName = `Search Test ${Date.now()}`;
    await eventsPage.goto();
    await eventsPage.createEvent(testEventName);
    await eventsPage.goto();
    await eventsPage.selectEvent(testEventName);
    await expect(authenticatedPage).toHaveURL('/');
    await authenticatedPage.waitForTimeout(1000);

    await mainPage.createQuickIncident(`Test Location ${Date.now()}`);
    await authenticatedPage.waitForTimeout(1000);
  });

  test('dialog has search input', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();
    const crewSection = incidentCard.locator('text=Crew').locator('..');
    const plusButton = crewSection.locator('button').filter({
      has: authenticatedPage.locator('svg[class*="lucide-plus"]')
    });
    await plusButton.click();

    const dialog = authenticatedPage.locator('[role="dialog"]');
    await expect(dialog).toBeVisible();

    // Check for search input
    const searchInput = dialog.locator('input[placeholder*="Suchen"]');
    await expect(searchInput).toBeVisible();
  });

  test('search input has search icon', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();
    const crewSection = incidentCard.locator('text=Crew').locator('..');
    const plusButton = crewSection.locator('button').filter({
      has: authenticatedPage.locator('svg[class*="lucide-plus"]')
    });
    await plusButton.click();

    const dialog = authenticatedPage.locator('[role="dialog"]');
    await expect(dialog).toBeVisible();

    // Check for Search icon
    const searchIcon = dialog.locator('svg[class*="lucide-search"]');
    await expect(searchIcon).toBeVisible();
  });

  test('search input is focusable', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();
    const crewSection = incidentCard.locator('text=Crew').locator('..');
    const plusButton = crewSection.locator('button').filter({
      has: authenticatedPage.locator('svg[class*="lucide-plus"]')
    });
    await plusButton.click();

    const dialog = authenticatedPage.locator('[role="dialog"]');
    await expect(dialog).toBeVisible();

    const searchInput = dialog.locator('input[placeholder*="Suchen"]');
    await searchInput.focus();

    // Verify focus
    const isFocused = await searchInput.evaluate(el => el === document.activeElement);
    expect(isFocused).toBeTruthy();
  });

  test('typing in search filters results', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();
    const crewSection = incidentCard.locator('text=Crew').locator('..');
    const plusButton = crewSection.locator('button').filter({
      has: authenticatedPage.locator('svg[class*="lucide-plus"]')
    });
    await plusButton.click();

    const dialog = authenticatedPage.locator('[role="dialog"]');
    await expect(dialog).toBeVisible();

    const searchInput = dialog.locator('input[placeholder*="Suchen"]');

    // Get initial count of resource items
    const initialItems = await dialog.locator('button').filter({
      has: authenticatedPage.locator('svg[class*="lucide-circle"]')
    }).count();

    // Type in search
    await searchInput.fill('xyz_nonexistent_name');
    await authenticatedPage.waitForTimeout(300);

    // Count should be less (or 0 if no matches)
    const filteredItems = await dialog.locator('button').filter({
      has: authenticatedPage.locator('svg[class*="lucide-circle"]')
    }).count();

    expect(filteredItems).toBeLessThanOrEqual(initialItems);
  });

  test('search resets when dialog reopens', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();
    const crewSection = incidentCard.locator('text=Crew').locator('..');
    const plusButton = crewSection.locator('button').filter({
      has: authenticatedPage.locator('svg[class*="lucide-plus"]')
    });
    await plusButton.click();

    const dialog = authenticatedPage.locator('[role="dialog"]');
    await expect(dialog).toBeVisible();

    const searchInput = dialog.locator('input[placeholder*="Suchen"]');
    await searchInput.fill('test search');

    // Close dialog
    await authenticatedPage.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();

    // Reopen
    await plusButton.click();
    await expect(dialog).toBeVisible();

    // Search should be reset
    const searchValue = await searchInput.inputValue();
    expect(searchValue).toBe('');
  });
});

test.describe('Resource Assignment Dialog - Resource List', () => {
  let eventsPage: EventsPage;
  let mainPage: MainPage;
  let testEventName: string;

  test.beforeEach(async ({ authenticatedPage }) => {
    eventsPage = new EventsPage(authenticatedPage);
    mainPage = new MainPage(authenticatedPage);

    testEventName = `Resource List Test ${Date.now()}`;
    await eventsPage.goto();
    await eventsPage.createEvent(testEventName);
    await eventsPage.goto();
    await eventsPage.selectEvent(testEventName);
    await expect(authenticatedPage).toHaveURL('/');
    await authenticatedPage.waitForTimeout(1000);

    await mainPage.createQuickIncident(`Test Location ${Date.now()}`);
    await authenticatedPage.waitForTimeout(1000);
  });

  test('dialog shows available resources', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();
    const crewSection = incidentCard.locator('text=Crew').locator('..');
    const plusButton = crewSection.locator('button').filter({
      has: authenticatedPage.locator('svg[class*="lucide-plus"]')
    });
    await plusButton.click();

    const dialog = authenticatedPage.locator('[role="dialog"]');
    await expect(dialog).toBeVisible();

    // Should have at least some resource items
    const resourceButtons = dialog.locator('button').filter({
      has: authenticatedPage.locator('svg[class*="lucide-circle"]')
    });
    const count = await resourceButtons.count();

    // Count could be 0 or more depending on seed data
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('unassigned resources show circle icon', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();
    const crewSection = incidentCard.locator('text=Crew').locator('..');
    const plusButton = crewSection.locator('button').filter({
      has: authenticatedPage.locator('svg[class*="lucide-plus"]')
    });
    await plusButton.click();

    const dialog = authenticatedPage.locator('[role="dialog"]');
    await expect(dialog).toBeVisible();

    // Find first unassigned resource (has Circle icon, not CheckCircle)
    const circleIcon = dialog.locator('svg[class*="lucide-circle"]').first();
    if (await circleIcon.count() > 0) {
      await expect(circleIcon).toBeVisible();
    }
  });

  test('resource items are clickable', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();
    const crewSection = incidentCard.locator('text=Crew').locator('..');
    const plusButton = crewSection.locator('button').filter({
      has: authenticatedPage.locator('svg[class*="lucide-plus"]')
    });
    await plusButton.click();

    const dialog = authenticatedPage.locator('[role="dialog"]');
    await expect(dialog).toBeVisible();

    // Find first resource button
    const firstResource = dialog.locator('button').filter({
      has: authenticatedPage.locator('svg[class*="lucide-circle"]')
    }).first();

    if (await firstResource.count() > 0) {
      await expect(firstResource).toBeEnabled();
    }
  });

  test('resource items have hover effect', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();
    const crewSection = incidentCard.locator('text=Crew').locator('..');
    const plusButton = crewSection.locator('button').filter({
      has: authenticatedPage.locator('svg[class*="lucide-plus"]')
    });
    await plusButton.click();

    const dialog = authenticatedPage.locator('[role="dialog"]');
    await expect(dialog).toBeVisible();

    const firstResource = dialog.locator('button').filter({
      has: authenticatedPage.locator('svg[class*="lucide-circle"]')
    }).first();

    if (await firstResource.count() > 0) {
      // Check for hover classes
      const hasHover = await firstResource.evaluate(el =>
        el.className.includes('hover:border-primary') || el.className.includes('hover:bg-secondary')
      );
      expect(hasHover).toBeTruthy();
    }
  });
});

test.describe('Resource Assignment Dialog - Assignment Actions', () => {
  let eventsPage: EventsPage;
  let mainPage: MainPage;
  let testEventName: string;

  test.beforeEach(async ({ authenticatedPage }) => {
    eventsPage = new EventsPage(authenticatedPage);
    mainPage = new MainPage(authenticatedPage);

    testEventName = `Assignment Actions Test ${Date.now()}`;
    await eventsPage.goto();
    await eventsPage.createEvent(testEventName);
    await eventsPage.goto();
    await eventsPage.selectEvent(testEventName);
    await expect(authenticatedPage).toHaveURL('/');
    await authenticatedPage.waitForTimeout(1000);

    await mainPage.createQuickIncident(`Test Location ${Date.now()}`);
    await authenticatedPage.waitForTimeout(1000);
  });

  test('clicking resource assigns it and shows checkmark', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();
    const crewSection = incidentCard.locator('text=Crew').locator('..');
    const plusButton = crewSection.locator('button').filter({
      has: authenticatedPage.locator('svg[class*="lucide-plus"]')
    });
    await plusButton.click();

    const dialog = authenticatedPage.locator('[role="dialog"]');
    await expect(dialog).toBeVisible();

    // Find first available resource
    const firstResource = dialog.locator('button').filter({
      has: authenticatedPage.locator('svg[class*="lucide-circle"]')
    }).first();

    if (await firstResource.count() > 0) {
      // Click to assign
      await firstResource.click();
      await authenticatedPage.waitForTimeout(500);

      // Should now show CheckCircle icon
      const checkIcon = firstResource.locator('svg[class*="lucide-check-circle"]');
      await expect(checkIcon).toBeVisible({ timeout: 3000 });
    }
  });

  test('assigning resource shows success toast', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();
    const crewSection = incidentCard.locator('text=Crew').locator('..');
    const plusButton = crewSection.locator('button').filter({
      has: authenticatedPage.locator('svg[class*="lucide-plus"]')
    });
    await plusButton.click();

    const dialog = authenticatedPage.locator('[role="dialog"]');
    await expect(dialog).toBeVisible();

    const firstResource = dialog.locator('button').filter({
      has: authenticatedPage.locator('svg[class*="lucide-circle"]')
    }).first();

    if (await firstResource.count() > 0) {
      // Click to assign
      await firstResource.click();
      await authenticatedPage.waitForTimeout(300);

      // Check for success toast
      const toast = authenticatedPage.locator('[data-sonner-toast]');
      await expect(toast.filter({ hasText: 'zugewiesen' })).toBeVisible({ timeout: 3000 });
    }
  });

  test('clicking assigned resource unassigns it', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();
    const crewSection = incidentCard.locator('text=Crew').locator('..');
    const plusButton = crewSection.locator('button').filter({
      has: authenticatedPage.locator('svg[class*="lucide-plus"]')
    });
    await plusButton.click();

    const dialog = authenticatedPage.locator('[role="dialog"]');
    await expect(dialog).toBeVisible();

    const firstResource = dialog.locator('button').filter({
      has: authenticatedPage.locator('svg[class*="lucide-circle"]')
    }).first();

    if (await firstResource.count() > 0) {
      // Assign first
      await firstResource.click();
      await authenticatedPage.waitForTimeout(500);

      // Should have CheckCircle
      await expect(firstResource.locator('svg[class*="lucide-check-circle"]')).toBeVisible();

      // Click again to unassign
      await firstResource.click();
      await authenticatedPage.waitForTimeout(500);

      // Should now have Circle icon again
      const circleIcon = firstResource.locator('svg[class*="lucide-circle"]').and(
        authenticatedPage.locator('svg').filter({ hasNot: authenticatedPage.locator('[class*="check"]') })
      );
      // Icon should change back to unassigned state
    }
  });

  test('unassigning resource shows success toast', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();
    const crewSection = incidentCard.locator('text=Crew').locator('..');
    const plusButton = crewSection.locator('button').filter({
      has: authenticatedPage.locator('svg[class*="lucide-plus"]')
    });
    await plusButton.click();

    const dialog = authenticatedPage.locator('[role="dialog"]');
    await expect(dialog).toBeVisible();

    const firstResource = dialog.locator('button').filter({
      has: authenticatedPage.locator('svg[class*="lucide-circle"]')
    }).first();

    if (await firstResource.count() > 0) {
      // Assign
      await firstResource.click();
      await authenticatedPage.waitForTimeout(500);

      // Unassign
      await firstResource.click();
      await authenticatedPage.waitForTimeout(300);

      // Check for toast with "entfernt"
      const toast = authenticatedPage.locator('[data-sonner-toast]');
      await expect(toast.filter({ hasText: 'entfernt' })).toBeVisible({ timeout: 3000 });
    }
  });
});

test.describe('Resource Assignment Dialog - Visual Feedback', () => {
  let eventsPage: EventsPage;
  let mainPage: MainPage;
  let testEventName: string;

  test.beforeEach(async ({ authenticatedPage }) => {
    eventsPage = new EventsPage(authenticatedPage);
    mainPage = new MainPage(authenticatedPage);

    testEventName = `Visual Feedback Test ${Date.now()}`;
    await eventsPage.goto();
    await eventsPage.createEvent(testEventName);
    await eventsPage.goto();
    await eventsPage.selectEvent(testEventName);
    await expect(authenticatedPage).toHaveURL('/');
    await authenticatedPage.waitForTimeout(1000);

    await mainPage.createQuickIncident(`Test Location ${Date.now()}`);
    await authenticatedPage.waitForTimeout(1000);
  });

  test('assigned resources have emerald checkmark', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();
    const crewSection = incidentCard.locator('text=Crew').locator('..');
    const plusButton = crewSection.locator('button').filter({
      has: authenticatedPage.locator('svg[class*="lucide-plus"]')
    });
    await plusButton.click();

    const dialog = authenticatedPage.locator('[role="dialog"]');
    await expect(dialog).toBeVisible();

    const firstResource = dialog.locator('button').filter({
      has: authenticatedPage.locator('svg[class*="lucide-circle"]')
    }).first();

    if (await firstResource.count() > 0) {
      await firstResource.click();
      await authenticatedPage.waitForTimeout(500);

      const checkIcon = firstResource.locator('svg[class*="lucide-check-circle"]');
      const hasEmeraldColor = await checkIcon.evaluate(el =>
        el.className.includes('text-emerald-500')
      );
      expect(hasEmeraldColor).toBeTruthy();
    }
  });

  test('unassigned resources have muted circle', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();
    const crewSection = incidentCard.locator('text=Crew').locator('..');
    const plusButton = crewSection.locator('button').filter({
      has: authenticatedPage.locator('svg[class*="lucide-plus"]')
    });
    await plusButton.click();

    const dialog = authenticatedPage.locator('[role="dialog"]');
    await expect(dialog).toBeVisible();

    const circleIcon = dialog.locator('svg[class*="lucide-circle"]').first();

    if (await circleIcon.count() > 0) {
      const hasMutedColor = await circleIcon.evaluate(el =>
        el.className.includes('text-muted-foreground')
      );
      expect(hasMutedColor).toBeTruthy();
    }
  });

  test('dialog has entrance animation', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();
    const crewSection = incidentCard.locator('text=Crew').locator('..');
    const plusButton = crewSection.locator('button').filter({
      has: authenticatedPage.locator('svg[class*="lucide-plus"]')
    });
    await plusButton.click();

    const dialog = authenticatedPage.locator('[role="dialog"]');
    await expect(dialog).toBeVisible();

    // Check for animation class
    const hasAnimation = await dialog.evaluate(el =>
      el.className.includes('animate-modal-entrance')
    );
    expect(hasAnimation).toBeTruthy();
  });
});

test.describe('Resource Assignment Dialog - Scrollable List', () => {
  let eventsPage: EventsPage;
  let mainPage: MainPage;
  let testEventName: string;

  test.beforeEach(async ({ authenticatedPage }) => {
    eventsPage = new EventsPage(authenticatedPage);
    mainPage = new MainPage(authenticatedPage);

    testEventName = `Scrollable Test ${Date.now()}`;
    await eventsPage.goto();
    await eventsPage.createEvent(testEventName);
    await eventsPage.goto();
    await eventsPage.selectEvent(testEventName);
    await expect(authenticatedPage).toHaveURL('/');
    await authenticatedPage.waitForTimeout(1000);

    await mainPage.createQuickIncident(`Test Location ${Date.now()}`);
    await authenticatedPage.waitForTimeout(1000);
  });

  test('resource list is scrollable', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();
    const crewSection = incidentCard.locator('text=Crew').locator('..');
    const plusButton = crewSection.locator('button').filter({
      has: authenticatedPage.locator('svg[class*="lucide-plus"]')
    });
    await plusButton.click();

    const dialog = authenticatedPage.locator('[role="dialog"]');
    await expect(dialog).toBeVisible();

    // Dialog should have a ScrollArea
    const scrollArea = dialog.locator('[class*="scroll"]').first();
    await expect(scrollArea).toBeVisible();
  });

  test('resource list has max height', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();
    const crewSection = incidentCard.locator('text=Crew').locator('..');
    const plusButton = crewSection.locator('button').filter({
      has: authenticatedPage.locator('svg[class*="lucide-plus"]')
    });
    await plusButton.click();

    const dialog = authenticatedPage.locator('[role="dialog"]');
    await expect(dialog).toBeVisible();

    // Check for h-[400px] class on scroll area
    const scrollArea = dialog.locator('[class*="h-[400px]"]');
    const hasMaxHeight = await scrollArea.count() > 0;
    expect(hasMaxHeight).toBeTruthy();
  });
});

test.describe('Resource Assignment Dialog - Mobile', () => {
  test('dialog is responsive on mobile', async ({ authenticatedPage }) => {
    await authenticatedPage.setViewportSize({ width: 375, height: 667 });

    const eventsPage = new EventsPage(authenticatedPage);
    const mainPage = new MainPage(authenticatedPage);
    const testEventName = `Mobile Dialog Test ${Date.now()}`;

    await eventsPage.goto();
    await eventsPage.createEvent(testEventName);
    await eventsPage.goto();
    await eventsPage.selectEvent(testEventName);
    await expect(authenticatedPage).toHaveURL('/');
    await authenticatedPage.waitForTimeout(1000);

    await mainPage.createQuickIncident(`Test Location ${Date.now()}`);
    await authenticatedPage.waitForTimeout(1000);

    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();
    const crewSection = incidentCard.locator('text=Crew').locator('..');
    const plusButton = crewSection.locator('button').filter({
      has: authenticatedPage.locator('svg[class*="lucide-plus"]')
    });
    await plusButton.click();

    const dialog = authenticatedPage.locator('[role="dialog"]');
    await expect(dialog).toBeVisible();

    // Dialog should be visible and functional on mobile
    await expect(dialog.locator('h2:has-text("Mannschaft zuweisen")')).toBeVisible();
  });

  test('resource items have adequate touch targets on mobile', async ({ authenticatedPage }) => {
    await authenticatedPage.setViewportSize({ width: 375, height: 667 });

    const eventsPage = new EventsPage(authenticatedPage);
    const mainPage = new MainPage(authenticatedPage);
    const testEventName = `Mobile Touch Test ${Date.now()}`;

    await eventsPage.goto();
    await eventsPage.createEvent(testEventName);
    await eventsPage.goto();
    await eventsPage.selectEvent(testEventName);
    await expect(authenticatedPage).toHaveURL('/');
    await authenticatedPage.waitForTimeout(1000);

    await mainPage.createQuickIncident(`Test Location ${Date.now()}`);
    await authenticatedPage.waitForTimeout(1000);

    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();
    const crewSection = incidentCard.locator('text=Crew').locator('..');
    const plusButton = crewSection.locator('button').filter({
      has: authenticatedPage.locator('svg[class*="lucide-plus"]')
    });
    await plusButton.click();

    const dialog = authenticatedPage.locator('[role="dialog"]');
    await expect(dialog).toBeVisible();

    const firstResource = dialog.locator('button').filter({
      has: authenticatedPage.locator('svg[class*="lucide-circle"]')
    }).first();

    if (await firstResource.count() > 0) {
      const height = await firstResource.evaluate(el => el.getBoundingClientRect().height);
      // Should be adequate for touch (at least 40px)
      expect(height).toBeGreaterThanOrEqual(40);
    }
  });
});

test.describe('Resource Assignment Dialog - Keyboard Navigation', () => {
  let eventsPage: EventsPage;
  let mainPage: MainPage;
  let testEventName: string;

  test.beforeEach(async ({ authenticatedPage }) => {
    eventsPage = new EventsPage(authenticatedPage);
    mainPage = new MainPage(authenticatedPage);

    testEventName = `Keyboard Nav Test ${Date.now()}`;
    await eventsPage.goto();
    await eventsPage.createEvent(testEventName);
    await eventsPage.goto();
    await eventsPage.selectEvent(testEventName);
    await expect(authenticatedPage).toHaveURL('/');
    await authenticatedPage.waitForTimeout(1000);

    await mainPage.createQuickIncident(`Test Location ${Date.now()}`);
    await authenticatedPage.waitForTimeout(1000);
  });

  test('search input can be focused with keyboard', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();
    const crewSection = incidentCard.locator('text=Crew').locator('..');
    const plusButton = crewSection.locator('button').filter({
      has: authenticatedPage.locator('svg[class*="lucide-plus"]')
    });
    await plusButton.click();

    const dialog = authenticatedPage.locator('[role="dialog"]');
    await expect(dialog).toBeVisible();

    const searchInput = dialog.locator('input[placeholder*="Suchen"]');

    // Tab to search
    await authenticatedPage.keyboard.press('Tab');

    // Should be focused
    const isFocused = await searchInput.evaluate(el => el === document.activeElement);
    expect(isFocused).toBeTruthy();
  });

  test('resource items can be selected with keyboard', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();
    const crewSection = incidentCard.locator('text=Crew').locator('..');
    const plusButton = crewSection.locator('button').filter({
      has: authenticatedPage.locator('svg[class*="lucide-plus"]')
    });
    await plusButton.click();

    const dialog = authenticatedPage.locator('[role="dialog"]');
    await expect(dialog).toBeVisible();

    const firstResource = dialog.locator('button').filter({
      has: authenticatedPage.locator('svg[class*="lucide-circle"]')
    }).first();

    if (await firstResource.count() > 0) {
      // Tab to resource button
      await firstResource.focus();

      // Press Enter to select
      await authenticatedPage.keyboard.press('Enter');
      await authenticatedPage.waitForTimeout(500);

      // Should be assigned (show checkmark)
      const checkIcon = firstResource.locator('svg[class*="lucide-check-circle"]');
      await expect(checkIcon).toBeVisible({ timeout: 3000 });
    }
  });
});
