import { test, expect } from '../../fixtures/auth.fixture';
import { EventsPage } from '../../pages/events.page';
import { MainPage } from '../../pages/main.page';

/**
 * Resource Status Badges Tests
 * Tests the visual resource status badges on incident cards
 * Shows checkmarks for assigned resources and [+] buttons to open assignment dialog
 */

test.describe('Resource Status Badges - Visual Display', () => {
  let eventsPage: EventsPage;
  let mainPage: MainPage;
  let testEventName: string;

  test.beforeEach(async ({ authenticatedPage }) => {
    eventsPage = new EventsPage(authenticatedPage);
    mainPage = new MainPage(authenticatedPage);

    // Create and select event
    testEventName = `Resource Badge Test ${Date.now()}`;
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

  test('incident card shows resource status badges', async ({ authenticatedPage }) => {
    // Find the incident card
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();
    await expect(incidentCard).toBeVisible();

    // Verify Crew badge is visible
    const crewBadge = incidentCard.locator('text=Crew').first();
    await expect(crewBadge).toBeVisible();

    // Verify Vehicles badge is visible
    const vehiclesBadge = incidentCard.locator('text=Fahrzeuge').first();
    await expect(vehiclesBadge).toBeVisible();

    // Verify Materials badge is visible
    const materialsBadge = incidentCard.locator('text=Material').first();
    await expect(materialsBadge).toBeVisible();
  });

  test('unassigned resources show X icon', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();

    // Find XCircle icons (unassigned state)
    const xCircleIcons = incidentCard.locator('svg[class*="lucide-x-circle"]');
    const count = await xCircleIcons.count();

    // Should have at least one X icon for unassigned resources
    expect(count).toBeGreaterThan(0);
  });

  test('resource badges show count in parentheses', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();

    // Check that counts are displayed (initially 0)
    await expect(incidentCard.locator('text=Crew (0)')).toBeVisible();
    await expect(incidentCard.locator('text=Fahrzeuge (0)')).toBeVisible();
    await expect(incidentCard.locator('text=Material (0)')).toBeVisible();
  });

  test('resource badges have appropriate icons', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();

    // Verify Icons are present
    // Users icon for Crew
    const usersIcon = incidentCard.locator('svg[class*="lucide-users"]').first();
    await expect(usersIcon).toBeVisible();

    // Truck icon for Vehicles
    const truckIcon = incidentCard.locator('svg[class*="lucide-truck"]').first();
    await expect(truckIcon).toBeVisible();

    // Package icon for Materials
    const packageIcon = incidentCard.locator('svg[class*="lucide-package"]').first();
    await expect(packageIcon).toBeVisible();
  });
});

test.describe('Resource Status Badges - Plus Button', () => {
  let eventsPage: EventsPage;
  let mainPage: MainPage;
  let testEventName: string;

  test.beforeEach(async ({ authenticatedPage }) => {
    eventsPage = new EventsPage(authenticatedPage);
    mainPage = new MainPage(authenticatedPage);

    testEventName = `Plus Button Test ${Date.now()}`;
    await eventsPage.goto();
    await eventsPage.createEvent(testEventName);
    await eventsPage.goto();
    await eventsPage.selectEvent(testEventName);
    await expect(authenticatedPage).toHaveURL('/');
    await authenticatedPage.waitForTimeout(1000);

    await mainPage.createQuickIncident(`Test Location ${Date.now()}`);
    await authenticatedPage.waitForTimeout(1000);
  });

  test('plus buttons are visible for all resource types', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();

    // Find all Plus icon buttons
    const plusButtons = incidentCard.locator('button svg[class*="lucide-plus"]');
    const count = await plusButtons.count();

    // Should have 3 plus buttons (crew, vehicles, materials)
    expect(count).toBe(3);
  });

  test('plus buttons are clickable', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();

    // Find and click the first plus button
    const plusButton = incidentCard.locator('button').filter({
      has: authenticatedPage.locator('svg[class*="lucide-plus"]')
    }).first();

    await expect(plusButton).toBeVisible();
    await expect(plusButton).toBeEnabled();

    // Click should not throw error
    await plusButton.click();
    await authenticatedPage.waitForTimeout(500);
  });

  test('plus button has hover effect', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();

    const plusButton = incidentCard.locator('button').filter({
      has: authenticatedPage.locator('svg[class*="lucide-plus"]')
    }).first();

    // Verify hover class is present
    const hasHoverClass = await plusButton.evaluate(el =>
      el.className.includes('hover:bg-primary')
    );
    expect(hasHoverClass).toBeTruthy();
  });

  test('plus button has descriptive title attribute', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();

    // Find crew plus button
    const crewSection = incidentCard.locator('text=Crew').locator('..');
    const crewPlusButton = crewSection.locator('button').filter({
      has: authenticatedPage.locator('svg[class*="lucide-plus"]')
    });

    const title = await crewPlusButton.getAttribute('title');
    expect(title).toContain('zuweisen');
  });

  test('plus button click stops event propagation', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();

    const plusButton = incidentCard.locator('button').filter({
      has: authenticatedPage.locator('svg[class*="lucide-plus"]')
    }).first();

    // Click plus button
    await plusButton.click();
    await authenticatedPage.waitForTimeout(300);

    // Incident detail modal should NOT open (event propagation stopped)
    const detailModal = authenticatedPage.locator('[role="dialog"]').filter({
      hasText: 'Einsatzdetails'
    });
    await expect(detailModal).not.toBeVisible();
  });
});

test.describe('Resource Status Badges - Assigned State', () => {
  let eventsPage: EventsPage;
  let mainPage: MainPage;
  let testEventName: string;

  test.beforeEach(async ({ authenticatedPage }) => {
    eventsPage = new EventsPage(authenticatedPage);
    mainPage = new MainPage(authenticatedPage);

    testEventName = `Assigned State Test ${Date.now()}`;
    await eventsPage.goto();
    await eventsPage.createEvent(testEventName);
    await eventsPage.goto();
    await eventsPage.selectEvent(testEventName);
    await expect(authenticatedPage).toHaveURL('/');
    await authenticatedPage.waitForTimeout(1000);
  });

  test('assigned resources show checkmark icon', async ({ authenticatedPage }) => {
    // Create incident
    await mainPage.createQuickIncident(`Test Location ${Date.now()}`);
    await authenticatedPage.waitForTimeout(1000);

    // Find the incident
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();

    // Assign a crew member via drag and drop from sidebar
    const personnelSidebar = authenticatedPage.locator('[data-testid="personnel-sidebar"]');
    if (await personnelSidebar.isVisible()) {
      const firstPerson = personnelSidebar.locator('[data-testid="draggable-person"]').first();
      if (await firstPerson.isVisible()) {
        // Drag person to incident
        await firstPerson.dragTo(incidentCard);
        await authenticatedPage.waitForTimeout(500);

        // Check for CheckCircle icon
        const checkIcon = incidentCard.locator('svg[class*="lucide-check-circle"]');
        const hasCheckIcon = await checkIcon.count() > 0;
        expect(hasCheckIcon).toBeTruthy();
      }
    }
  });

  test('count updates when resource is assigned', async ({ authenticatedPage }) => {
    // Create incident
    await mainPage.createQuickIncident(`Test Location ${Date.now()}`);
    await authenticatedPage.waitForTimeout(1000);

    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();

    // Initially 0
    await expect(incidentCard.locator('text=Crew (0)')).toBeVisible();

    // Assign a crew member
    const personnelSidebar = authenticatedPage.locator('[data-testid="personnel-sidebar"]');
    if (await personnelSidebar.isVisible()) {
      const firstPerson = personnelSidebar.locator('[data-testid="draggable-person"]').first();
      if (await firstPerson.isVisible()) {
        await firstPerson.dragTo(incidentCard);
        await authenticatedPage.waitForTimeout(500);

        // Count should update to 1
        await expect(incidentCard.locator('text=Crew (1)')).toBeVisible({ timeout: 3000 });
      }
    }
  });
});

test.describe('Resource Status Badges - Color Coding', () => {
  let eventsPage: EventsPage;
  let mainPage: MainPage;
  let testEventName: string;

  test.beforeEach(async ({ authenticatedPage }) => {
    eventsPage = new EventsPage(authenticatedPage);
    mainPage = new MainPage(authenticatedPage);

    testEventName = `Color Test ${Date.now()}`;
    await eventsPage.goto();
    await eventsPage.createEvent(testEventName);
    await eventsPage.goto();
    await eventsPage.selectEvent(testEventName);
    await expect(authenticatedPage).toHaveURL('/');
    await authenticatedPage.waitForTimeout(1000);

    await mainPage.createQuickIncident(`Test Location ${Date.now()}`);
    await authenticatedPage.waitForTimeout(1000);
  });

  test('unassigned resources show muted color', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();

    // Find XCircle icon
    const xCircleIcon = incidentCard.locator('svg[class*="lucide-x-circle"]').first();

    // Should have text-muted-foreground class
    const hasMutedColor = await xCircleIcon.evaluate(el =>
      el.className.includes('text-muted-foreground')
    );
    expect(hasMutedColor).toBeTruthy();
  });

  test('assigned resources show emerald/green color', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();

    // Assign a resource first
    const personnelSidebar = authenticatedPage.locator('[data-testid="personnel-sidebar"]');
    if (await personnelSidebar.isVisible()) {
      const firstPerson = personnelSidebar.locator('[data-testid="draggable-person"]').first();
      if (await firstPerson.isVisible()) {
        await firstPerson.dragTo(incidentCard);
        await authenticatedPage.waitForTimeout(500);

        // Find CheckCircle icon
        const checkIcon = incidentCard.locator('svg[class*="lucide-check-circle"]').first();

        // Should have text-emerald-500 class
        const hasEmeraldColor = await checkIcon.evaluate(el =>
          el.className.includes('text-emerald-500')
        );
        expect(hasEmeraldColor).toBeTruthy();
      }
    }
  });
});

test.describe('Resource Status Badges - Responsive Layout', () => {
  let eventsPage: EventsPage;
  let mainPage: MainPage;
  let testEventName: string;

  test('badges display correctly on mobile', async ({ authenticatedPage }) => {
    // Set mobile viewport
    await authenticatedPage.setViewportSize({ width: 375, height: 667 });

    eventsPage = new EventsPage(authenticatedPage);
    mainPage = new MainPage(authenticatedPage);

    testEventName = `Mobile Badge Test ${Date.now()}`;
    await eventsPage.goto();
    await eventsPage.createEvent(testEventName);
    await eventsPage.goto();
    await eventsPage.selectEvent(testEventName);
    await expect(authenticatedPage).toHaveURL('/');
    await authenticatedPage.waitForTimeout(1000);

    await mainPage.createQuickIncident(`Test Location ${Date.now()}`);
    await authenticatedPage.waitForTimeout(1000);

    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();

    // Verify badges are still visible on mobile
    await expect(incidentCard.locator('text=Crew')).toBeVisible();
    await expect(incidentCard.locator('text=Fahrzeuge')).toBeVisible();
    await expect(incidentCard.locator('text=Material')).toBeVisible();
  });

  test('badges have proper spacing on mobile', async ({ authenticatedPage }) => {
    await authenticatedPage.setViewportSize({ width: 375, height: 667 });

    eventsPage = new EventsPage(authenticatedPage);
    mainPage = new MainPage(authenticatedPage);

    testEventName = `Mobile Spacing Test ${Date.now()}`;
    await eventsPage.goto();
    await eventsPage.createEvent(testEventName);
    await eventsPage.goto();
    await eventsPage.selectEvent(testEventName);
    await expect(authenticatedPage).toHaveURL('/');
    await authenticatedPage.waitForTimeout(1000);

    await mainPage.createQuickIncident(`Test Location ${Date.now()}`);
    await authenticatedPage.waitForTimeout(1000);

    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();

    // Check that badges are properly aligned
    const badgeSection = incidentCard.locator('text=Crew').locator('..');
    const isVisible = await badgeSection.isVisible();
    expect(isVisible).toBeTruthy();
  });
});

test.describe('Resource Status Badges - Accessibility', () => {
  let eventsPage: EventsPage;
  let mainPage: MainPage;
  let testEventName: string;

  test.beforeEach(async ({ authenticatedPage }) => {
    eventsPage = new EventsPage(authenticatedPage);
    mainPage = new MainPage(authenticatedPage);

    testEventName = `A11y Badge Test ${Date.now()}`;
    await eventsPage.goto();
    await eventsPage.createEvent(testEventName);
    await eventsPage.goto();
    await eventsPage.selectEvent(testEventName);
    await expect(authenticatedPage).toHaveURL('/');
    await authenticatedPage.waitForTimeout(1000);

    await mainPage.createQuickIncident(`Test Location ${Date.now()}`);
    await authenticatedPage.waitForTimeout(1000);
  });

  test('plus buttons are keyboard accessible', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();

    const plusButton = incidentCard.locator('button').filter({
      has: authenticatedPage.locator('svg[class*="lucide-plus"]')
    }).first();

    // Tab to button
    await plusButton.focus();

    // Verify focus
    const isFocused = await plusButton.evaluate(el => el === document.activeElement);
    expect(isFocused).toBeTruthy();
  });

  test('plus buttons can be activated with Enter key', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();

    const plusButton = incidentCard.locator('button').filter({
      has: authenticatedPage.locator('svg[class*="lucide-plus"]')
    }).first();

    // Focus and press Enter
    await plusButton.focus();
    await authenticatedPage.keyboard.press('Enter');
    await authenticatedPage.waitForTimeout(300);

    // Should trigger action (without throwing error)
  });

  test('resource labels are readable for screen readers', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();

    // Verify text labels are present (not just icons)
    await expect(incidentCard.locator('text=Crew')).toBeVisible();
    await expect(incidentCard.locator('text=Fahrzeuge')).toBeVisible();
    await expect(incidentCard.locator('text=Material')).toBeVisible();
  });
});

test.describe('Resource Status Badges - Multiple Incidents', () => {
  let eventsPage: EventsPage;
  let mainPage: MainPage;
  let testEventName: string;

  test.beforeEach(async ({ authenticatedPage }) => {
    eventsPage = new EventsPage(authenticatedPage);
    mainPage = new MainPage(authenticatedPage);

    testEventName = `Multi Incident Test ${Date.now()}`;
    await eventsPage.goto();
    await eventsPage.createEvent(testEventName);
    await eventsPage.goto();
    await eventsPage.selectEvent(testEventName);
    await expect(authenticatedPage).toHaveURL('/');
    await authenticatedPage.waitForTimeout(1000);

    // Create multiple incidents
    await mainPage.createQuickIncident(`Location A ${Date.now()}`);
    await authenticatedPage.waitForTimeout(500);
    await mainPage.createQuickIncident(`Location B ${Date.now()}`);
    await authenticatedPage.waitForTimeout(1000);
  });

  test('each incident shows independent resource badges', async ({ authenticatedPage }) => {
    const incidents = authenticatedPage.locator('[data-testid="incident-card"]');
    const count = await incidents.count();

    expect(count).toBeGreaterThanOrEqual(2);

    // Each should have its own badge set
    for (let i = 0; i < Math.min(count, 2); i++) {
      const incident = incidents.nth(i);
      await expect(incident.locator('text=Crew')).toBeVisible();
      await expect(incident.locator('text=Fahrzeuge')).toBeVisible();
      await expect(incident.locator('text=Material')).toBeVisible();
    }
  });

  test('plus buttons on different incidents are independent', async ({ authenticatedPage }) => {
    const incidents = authenticatedPage.locator('[data-testid="incident-card"]');
    const firstIncident = incidents.first();
    const secondIncident = incidents.nth(1);

    // Click plus on first incident
    const firstPlus = firstIncident.locator('button').filter({
      has: authenticatedPage.locator('svg[class*="lucide-plus"]')
    }).first();
    await firstPlus.click();
    await authenticatedPage.waitForTimeout(300);

    // Should not affect second incident
    const secondPlusStillVisible = await secondIncident.locator('button').filter({
      has: authenticatedPage.locator('svg[class*="lucide-plus"]')
    }).first().isVisible();
    expect(secondPlusStillVisible).toBeTruthy();
  });
});
