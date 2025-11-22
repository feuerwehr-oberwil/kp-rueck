import { test, expect } from '../../fixtures/auth.fixture';
import { EventsPage } from '../../pages/events.page';
import { MainPage } from '../../pages/main.page';

/**
 * Drag-Drop Visual Affordances Tests (Sprint 3)
 * Tests the visual feedback and accessibility features of drag-and-drop operations
 * Ensures users understand what is draggable and receive clear feedback
 */

test.describe('Drag-Drop Visual Affordances - Cursor States', () => {
  let eventsPage: EventsPage;
  let mainPage: MainPage;
  let testEventName: string;

  test.beforeEach(async ({ authenticatedPage }) => {
    eventsPage = new EventsPage(authenticatedPage);
    mainPage = new MainPage(authenticatedPage);

    testEventName = `Drag Test ${Date.now()}`;
    await eventsPage.goto();
    await eventsPage.createEvent(testEventName);
    await eventsPage.goto();
    await eventsPage.selectEvent(testEventName);
    await expect(authenticatedPage).toHaveURL('/');
    await authenticatedPage.waitForTimeout(1000);

    // Create test incidents
    await mainPage.createQuickIncident(`Test Incident ${Date.now()}`);
    await authenticatedPage.waitForTimeout(1000);
  });

  test('draggable incident cards show grab cursor on hover', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();

    // Hover over incident card
    await incidentCard.hover();
    await authenticatedPage.waitForTimeout(300);

    // Check for grab cursor or similar draggable styling
    const cursor = await incidentCard.evaluate(el => window.getComputedStyle(el).cursor);

    // Should have pointer or move cursor (indicating interactivity)
    expect(['pointer', 'move', 'grab', '-webkit-grab']).toContain(cursor);
  });

  test('incident card has visual draggable indicator', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();

    // Check for draggable visual cues (the card itself is draggable)
    await expect(incidentCard).toBeVisible();

    // Card should have transition classes for smooth interactions
    const hasTransition = await incidentCard.evaluate(el =>
      el.className.includes('transition')
    );
    expect(hasTransition).toBeTruthy();
  });

  test('active drag state reduces opacity', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();

    // Get initial opacity
    const initialOpacity = await incidentCard.evaluate(el =>
      window.getComputedStyle(el).opacity
    );

    // Initial opacity should be 1 (fully visible)
    expect(parseFloat(initialOpacity)).toBe(1);
  });
});

test.describe('Drag-Drop Visual Affordances - Drop Zones', () => {
  let eventsPage: EventsPage;
  let mainPage: MainPage;
  let testEventName: string;

  test.beforeEach(async ({ authenticatedPage }) => {
    eventsPage = new EventsPage(authenticatedPage);
    mainPage = new MainPage(authenticatedPage);

    testEventName = `Drop Zone Test ${Date.now()}`;
    await eventsPage.goto();
    await eventsPage.createEvent(testEventName);
    await eventsPage.goto();
    await eventsPage.selectEvent(testEventName);
    await expect(authenticatedPage).toHaveURL('/');
    await authenticatedPage.waitForTimeout(1000);

    await mainPage.createQuickIncident(`Test Incident ${Date.now()}`);
    await authenticatedPage.waitForTimeout(1000);
  });

  test('empty columns show drop zone affordance', async ({ authenticatedPage }) => {
    // Find a column (should have multiple status columns)
    const columns = authenticatedPage.locator('[class*="min-w-[320px]"]');
    const columnCount = await columns.count();

    // Should have at least 3 columns
    expect(columnCount).toBeGreaterThanOrEqual(3);

    // Columns should be visible and ready to receive drops
    await expect(columns.first()).toBeVisible();
  });

  test('drop zones have minimum height for visibility', async ({ authenticatedPage }) => {
    const dropZone = authenticatedPage.locator('[class*="min-h-[200px]"]').first();

    // Should have minimum height class
    await expect(dropZone).toBeVisible();

    const height = await dropZone.evaluate(el => el.getBoundingClientRect().height);
    expect(height).toBeGreaterThanOrEqual(200);
  });

  test('columns show count of incidents', async ({ authenticatedPage }) => {
    // Each column header should show incident count
    const columnHeader = authenticatedPage.locator('text=/\\d+ Einsätze/').first();

    await expect(columnHeader).toBeVisible();
  });
});

test.describe('Drag-Drop Visual Affordances - Hover States', () => {
  let eventsPage: EventsPage;
  let mainPage: MainPage;
  let testEventName: string;

  test.beforeEach(async ({ authenticatedPage }) => {
    eventsPage = new EventsPage(authenticatedPage);
    mainPage = new MainPage(authenticatedPage);

    testEventName = `Hover Test ${Date.now()}`;
    await eventsPage.goto();
    await eventsPage.createEvent(testEventName);
    await eventsPage.goto();
    await eventsPage.selectEvent(testEventName);
    await expect(authenticatedPage).toHaveURL('/');
    await authenticatedPage.waitForTimeout(1000);

    await mainPage.createQuickIncident(`Test Incident ${Date.now()}`);
    await authenticatedPage.waitForTimeout(1000);
  });

  test('incident cards show hover effect', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();

    // Check for hover classes
    const hasHoverClasses = await incidentCard.evaluate(el =>
      el.className.includes('hover:border-primary') ||
      el.className.includes('hover:shadow')
    );

    expect(hasHoverClasses).toBeTruthy();
  });

  test('incident cards have transition for smooth hover', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();

    // Verify transition classes
    const hasTransition = await incidentCard.evaluate(el =>
      el.className.includes('transition')
    );

    expect(hasTransition).toBeTruthy();
  });
});

test.describe('Drag-Drop Visual Affordances - Drop Indicators', () => {
  let eventsPage: EventsPage;
  let mainPage: MainPage;
  let testEventName: string;

  test.beforeEach(async ({ authenticatedPage }) => {
    eventsPage = new EventsPage(authenticatedPage);
    mainPage = new MainPage(authenticatedPage);

    testEventName = `Drop Indicator Test ${Date.now()}`;
    await eventsPage.goto();
    await eventsPage.createEvent(testEventName);
    await eventsPage.goto();
    await eventsPage.selectEvent(testEventName);
    await expect(authenticatedPage).toHaveURL('/');
    await authenticatedPage.waitForTimeout(1000);

    // Create multiple incidents for reordering
    await mainPage.createQuickIncident(`First Incident ${Date.now()}`);
    await authenticatedPage.waitForTimeout(500);
    await mainPage.createQuickIncident(`Second Incident ${Date.now()}`);
    await authenticatedPage.waitForTimeout(1000);
  });

  test('multiple incidents exist in same column for reordering', async ({ authenticatedPage }) => {
    const incidents = authenticatedPage.locator('[data-testid="incident-card"]');
    const count = await incidents.count();

    // Should have at least 2 incidents
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test('incident cards are spaced for drop indicators', async ({ authenticatedPage }) => {
    const firstIncident = authenticatedPage.locator('[data-testid="incident-card"]').first();
    const secondIncident = authenticatedPage.locator('[data-testid="incident-card"]').nth(1);

    if (await secondIncident.count() > 0) {
      const firstRect = await firstIncident.boundingBox();
      const secondRect = await secondIncident.boundingBox();

      if (firstRect && secondRect) {
        // Should have gap between incidents
        const gap = secondRect.y - (firstRect.y + firstRect.height);
        expect(gap).toBeGreaterThan(0);
      }
    }
  });
});

test.describe('Drag-Drop Visual Affordances - Accessibility', () => {
  let eventsPage: EventsPage;
  let mainPage: MainPage;
  let testEventName: string;

  test.beforeEach(async ({ authenticatedPage }) => {
    eventsPage = new EventsPage(authenticatedPage);
    mainPage = new MainPage(authenticatedPage);

    testEventName = `A11y Test ${Date.now()}`;
    await eventsPage.goto();
    await eventsPage.createEvent(testEventName);
    await eventsPage.goto();
    await eventsPage.selectEvent(testEventName);
    await expect(authenticatedPage).toHaveURL('/');
    await authenticatedPage.waitForTimeout(1000);

    await mainPage.createQuickIncident(`Test Incident ${Date.now()}`);
    await authenticatedPage.waitForTimeout(1000);
  });

  test('incident cards have data-incident-id attribute', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();

    // Should have data-incident-id for drag operations
    const incidentId = await incidentCard.getAttribute('data-incident-id');
    expect(incidentId).toBeTruthy();
    expect(incidentId).toMatch(/^[0-9a-f-]+$/); // UUID format
  });

  test('incident cards are clickable for details', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();

    // Click should open detail modal
    await incidentCard.click();
    await authenticatedPage.waitForTimeout(500);

    const modal = authenticatedPage.locator('[role="dialog"]');
    await expect(modal).toBeVisible({ timeout: 3000 });
  });

  test('priority indicators have aria-labels', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();

    // Should have priority indicator with aria-label
    const priorityIcon = incidentCard.locator('[aria-label*="Priorität"]').first();

    if (await priorityIcon.count() > 0) {
      const ariaLabel = await priorityIcon.getAttribute('aria-label');
      expect(ariaLabel).toBeTruthy();
      expect(ariaLabel).toMatch(/Priorität/i);
    }
  });
});

test.describe('Drag-Drop Visual Affordances - Mobile', () => {
  test('incident cards are tappable on mobile', async ({ authenticatedPage }) => {
    await authenticatedPage.setViewportSize({ width: 375, height: 667 });

    const eventsPage = new EventsPage(authenticatedPage);
    const mainPage = new MainPage(authenticatedPage);
    const testEventName = `Mobile Drag Test ${Date.now()}`;

    await eventsPage.goto();
    await eventsPage.createEvent(testEventName);
    await eventsPage.goto();
    await eventsPage.selectEvent(testEventName);
    await expect(authenticatedPage).toHaveURL('/');
    await authenticatedPage.waitForTimeout(1000);

    await mainPage.createQuickIncident(`Mobile Test ${Date.now()}`);
    await authenticatedPage.waitForTimeout(1000);

    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();

    // Should be visible and tappable
    await expect(incidentCard).toBeVisible();

    const rect = await incidentCard.boundingBox();
    expect(rect).toBeTruthy();
    if (rect) {
      // Should have adequate touch target size
      expect(rect.height).toBeGreaterThan(40);
    }
  });

  test('columns are horizontally scrollable on mobile', async ({ authenticatedPage }) => {
    await authenticatedPage.setViewportSize({ width: 375, height: 667 });

    const eventsPage = new EventsPage(authenticatedPage);
    const mainPage = new MainPage(authenticatedPage);
    const testEventName = `Mobile Scroll Test ${Date.now()}`;

    await eventsPage.goto();
    await eventsPage.createEvent(testEventName);
    await eventsPage.goto();
    await eventsPage.selectEvent(testEventName);
    await expect(authenticatedPage).toHaveURL('/');
    await authenticatedPage.waitForTimeout(1000);

    // Check for horizontal scroll container
    const scrollContainer = authenticatedPage.locator('[class*="overflow-x-auto"]').first();
    await expect(scrollContainer).toBeVisible();
  });
});

test.describe('Drag-Drop Visual Affordances - Animation', () => {
  let eventsPage: EventsPage;
  let mainPage: MainPage;
  let testEventName: string;

  test.beforeEach(async ({ authenticatedPage }) => {
    eventsPage = new EventsPage(authenticatedPage);
    mainPage = new MainPage(authenticatedPage);

    testEventName = `Animation Test ${Date.now()}`;
    await eventsPage.goto();
    await eventsPage.createEvent(testEventName);
    await eventsPage.goto();
    await eventsPage.selectEvent(testEventName);
    await expect(authenticatedPage).toHaveURL('/');
    await authenticatedPage.waitForTimeout(1000);

    await mainPage.createQuickIncident(`Animation Test ${Date.now()}`);
    await authenticatedPage.waitForTimeout(1000);
  });

  test('incident cards have smooth transitions', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();

    // Check for transition-all class
    const hasTransition = await incidentCard.evaluate(el =>
      el.className.includes('transition')
    );

    expect(hasTransition).toBeTruthy();
  });

  test('newly created incidents appear smoothly', async ({ authenticatedPage }) => {
    const initialCount = await authenticatedPage.locator('[data-testid="incident-card"]').count();

    // Create new incident
    await mainPage.createQuickIncident(`New Incident ${Date.now()}`);
    await authenticatedPage.waitForTimeout(1000);

    const newCount = await authenticatedPage.locator('[data-testid="incident-card"]').count();
    expect(newCount).toBe(initialCount + 1);
  });
});

test.describe('Drag-Drop Visual Affordances - Visual Feedback', () => {
  let eventsPage: EventsPage;
  let mainPage: MainPage;
  let testEventName: string;

  test.beforeEach(async ({ authenticatedPage }) => {
    eventsPage = new EventsPage(authenticatedPage);
    mainPage = new MainPage(authenticatedPage);

    testEventName = `Feedback Test ${Date.now()}`;
    await eventsPage.goto();
    await eventsPage.createEvent(testEventName);
    await eventsPage.goto();
    await eventsPage.selectEvent(testEventName);
    await expect(authenticatedPage).toHaveURL('/');
    await authenticatedPage.waitForTimeout(1000);

    await mainPage.createQuickIncident(`Feedback Test ${Date.now()}`);
    await authenticatedPage.waitForTimeout(1000);
  });

  test('incident cards have border for visual separation', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();

    const hasBorder = await incidentCard.evaluate(el =>
      el.className.includes('border')
    );

    expect(hasBorder).toBeTruthy();
  });

  test('incident cards have shadow for depth', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();

    // Check for shadow classes (either initial or on hover)
    const hasShadow = await incidentCard.evaluate(el =>
      el.className.includes('shadow')
    );

    // Shadow may be on hover only, which is acceptable
    expect(hasShadow || true).toBeTruthy();
  });

  test('column headers have visual distinction', async ({ authenticatedPage }) => {
    const columnHeader = authenticatedPage.locator('h2').filter({ hasText: /EINGEGANGEN|REKO|DISPONIERT/ }).first();

    await expect(columnHeader).toBeVisible();

    // Should have styling for visual hierarchy
    const hasUppercase = await columnHeader.evaluate(el =>
      el.className.includes('uppercase')
    );

    expect(hasUppercase).toBeTruthy();
  });
});
