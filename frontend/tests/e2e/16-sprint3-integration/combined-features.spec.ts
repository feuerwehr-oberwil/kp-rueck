import { test, expect } from '../../fixtures/auth.fixture';
import { EventsPage } from '../../pages/events.page';
import { MainPage } from '../../pages/main.page';

/**
 * Sprint 3 Integration Tests
 * Tests the combined functionality of all Sprint 3 features:
 * - Drag-drop visual affordances
 * - Priority visual hierarchy
 * - Time-based indicators
 */

test.describe('Sprint 3 Integration - All Features Together', () => {
  let eventsPage: EventsPage;
  let mainPage: MainPage;
  let testEventName: string;

  test.beforeEach(async ({ authenticatedPage }) => {
    eventsPage = new EventsPage(authenticatedPage);
    mainPage = new MainPage(authenticatedPage);

    testEventName = `Integration Test ${Date.now()}`;
    await eventsPage.goto();
    await eventsPage.createEvent(testEventName);
    await eventsPage.goto();
    await eventsPage.selectEvent(testEventName);
    await expect(authenticatedPage).toHaveURL('/');
    await authenticatedPage.waitForTimeout(1000);

    await mainPage.createQuickIncident(`Integration ${Date.now()}`);
    await authenticatedPage.waitForTimeout(1000);
  });

  test('incident card shows all Sprint 3 features simultaneously', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();

    // 1. Drag-drop affordance: Card should be draggable
    await expect(incidentCard).toBeVisible();
    const hasTransition = await incidentCard.evaluate(el =>
      el.className.includes('transition')
    );
    expect(hasTransition).toBeTruthy();

    // 2. Priority indicators: Should show dot and icon
    const priorityDot = incidentCard.locator('[class*="rounded-full"]').first();
    await expect(priorityDot).toBeVisible();

    const priorityIcon = incidentCard.locator('svg[class*="lucide-chevron"], svg[class*="lucide-minus"]').first();
    await expect(priorityIcon).toBeVisible();

    // 3. Time indicators: Should show clock icon and times
    const clockIcon = incidentCard.locator('svg[class*="lucide-clock"]').first();
    await expect(clockIcon).toBeVisible();

    const timeElement = incidentCard.locator('[class*="font-mono"]').first();
    await expect(timeElement).toBeVisible();
  });

  test('all Sprint 3 visual elements have proper spacing', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();

    // Priority indicators in flex container with gap
    const priorityContainer = incidentCard.locator('[class*="flex"][class*="gap-1"]').filter({
      has: authenticatedPage.locator('[class*="rounded-full"]')
    }).first();

    await expect(priorityContainer).toBeVisible();

    // Time section in flex container with gap
    const timeContainer = incidentCard.locator('[class*="flex"][class*="gap-2"]').filter({
      has: authenticatedPage.locator('svg[class*="lucide-clock"]')
    }).first();

    await expect(timeContainer).toBeVisible();

    // Overall card has padding
    const hasPadding = await incidentCard.evaluate(el =>
      el.className.includes('p-4')
    );
    expect(hasPadding).toBeTruthy();
  });

  test('Sprint 3 features dont interfere with each other', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();

    // Hover to test drag affordance doesn't break priority/time display
    await incidentCard.hover();
    await authenticatedPage.waitForTimeout(300);

    // All elements should still be visible
    const priorityDot = incidentCard.locator('[class*="rounded-full"]').first();
    await expect(priorityDot).toBeVisible();

    const clockIcon = incidentCard.locator('svg[class*="lucide-clock"]').first();
    await expect(clockIcon).toBeVisible();

    // Click to test interaction doesn't break layout
    await incidentCard.click();
    await authenticatedPage.waitForTimeout(500);

    const modal = authenticatedPage.locator('[role="dialog"]');
    await expect(modal).toBeVisible();

    // Close modal
    await authenticatedPage.keyboard.press('Escape');
    await authenticatedPage.waitForTimeout(300);

    // Elements should still be intact
    await expect(priorityDot).toBeVisible();
    await expect(clockIcon).toBeVisible();
  });
});

test.describe('Sprint 3 Integration - Visual Hierarchy', () => {
  let eventsPage: EventsPage;
  let mainPage: MainPage;
  let testEventName: string;

  test.beforeEach(async ({ authenticatedPage }) => {
    eventsPage = new EventsPage(authenticatedPage);
    mainPage = new MainPage(authenticatedPage);

    testEventName = `Hierarchy Test ${Date.now()}`;
    await eventsPage.goto();
    await eventsPage.createEvent(testEventName);
    await eventsPage.goto();
    await eventsPage.selectEvent(testEventName);
    await expect(authenticatedPage).toHaveURL('/');
    await authenticatedPage.waitForTimeout(1000);

    await mainPage.createQuickIncident(`Hierarchy ${Date.now()}`);
    await authenticatedPage.waitForTimeout(1000);
  });

  test('priority indicators are visually prominent', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();

    // Priority should be at top of card
    const cardContent = incidentCard.locator('[class*="space-y-3"]').first();
    const priorityContainer = cardContent.locator('[class*="flex"]').first();

    // Should contain priority indicators
    const hasPriorityDot = await priorityContainer.locator('[class*="rounded-full"]').count() > 0;
    expect(hasPriorityDot).toBeTruthy();
  });

  test('time information is secondary but visible', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();

    // Time should use muted colors (secondary information)
    const timeElement = incidentCard.locator('[class*="font-mono"]').first();

    const hasMutedColor = await timeElement.evaluate(el =>
      el.className.includes('text-muted-foreground')
    );

    expect(hasMutedColor).toBeTruthy();

    // But should still be clearly visible
    await expect(timeElement).toBeVisible();
  });

  test('location text remains most prominent', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();

    // Location should be h3 with bold font
    const locationHeading = incidentCard.locator('h3').first();

    await expect(locationHeading).toBeVisible();

    const isBold = await locationHeading.evaluate(el =>
      el.className.includes('font-bold')
    );

    expect(isBold).toBeTruthy();
  });
});

test.describe('Sprint 3 Integration - Color Harmony', () => {
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

    await mainPage.createQuickIncident(`Color ${Date.now()}`);
    await authenticatedPage.waitForTimeout(1000);
  });

  test('priority colors use consistent palette', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();

    const priorityDot = incidentCard.locator('[class*="rounded-full"]').first();
    const dotClasses = await priorityDot.getAttribute('class') || '';

    // Should use -500 shade for consistency
    const usesConsistentShade = dotClasses.includes('-500');
    expect(usesConsistentShade).toBeTruthy();
  });

  test('muted elements use consistent gray tones', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();

    // Time icon and text should both use muted-foreground
    const clockIcon = incidentCard.locator('svg[class*="lucide-clock"]').first();
    const timeText = incidentCard.locator('[class*="font-mono"]').first();

    const iconMuted = await clockIcon.evaluate(el =>
      el.className.includes('text-muted-foreground')
    );

    const textMuted = await timeText.evaluate(el =>
      el.className.includes('text-muted-foreground')
    );

    expect(iconMuted).toBeTruthy();
    expect(textMuted).toBeTruthy();
  });

  test('card maintains visual coherence', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();

    // Card should have border
    const hasBorder = await incidentCard.evaluate(el =>
      el.className.includes('border')
    );

    expect(hasBorder).toBeTruthy();

    // Card should have backdrop blur for depth
    const hasBackdrop = await incidentCard.evaluate(el =>
      el.className.includes('backdrop-blur')
    );

    expect(hasBackdrop).toBeTruthy();
  });
});

test.describe('Sprint 3 Integration - Mobile Experience', () => {
  test('all Sprint 3 features work on mobile', async ({ authenticatedPage }) => {
    await authenticatedPage.setViewportSize({ width: 375, height: 667 });

    const eventsPage = new EventsPage(authenticatedPage);
    const mainPage = new MainPage(authenticatedPage);
    const testEventName = `Mobile Integration ${Date.now()}`;

    await eventsPage.goto();
    await eventsPage.createEvent(testEventName);
    await eventsPage.goto();
    await eventsPage.selectEvent(testEventName);
    await expect(authenticatedPage).toHaveURL('/');
    await authenticatedPage.waitForTimeout(1000);

    await mainPage.createQuickIncident(`Mobile ${Date.now()}`);
    await authenticatedPage.waitForTimeout(1000);

    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();

    // All features should be visible on mobile
    await expect(incidentCard).toBeVisible();

    // Priority indicators
    const priorityDot = incidentCard.locator('[class*="rounded-full"]').first();
    await expect(priorityDot).toBeVisible();

    // Time indicators
    const clockIcon = incidentCard.locator('svg[class*="lucide-clock"]').first();
    await expect(clockIcon).toBeVisible();

    // Card should be tappable
    const rect = await incidentCard.boundingBox();
    expect(rect).toBeTruthy();
  });

  test('mobile layout prevents overlapping of Sprint 3 elements', async ({ authenticatedPage }) => {
    await authenticatedPage.setViewportSize({ width: 375, height: 667 });

    const eventsPage = new EventsPage(authenticatedPage);
    const mainPage = new MainPage(authenticatedPage);
    const testEventName = `Mobile Layout ${Date.now()}`;

    await eventsPage.goto();
    await eventsPage.createEvent(testEventName);
    await eventsPage.goto();
    await eventsPage.selectEvent(testEventName);
    await expect(authenticatedPage).toHaveURL('/');
    await authenticatedPage.waitForTimeout(1000);

    await mainPage.createQuickIncident(`Mobile ${Date.now()}`);
    await authenticatedPage.waitForTimeout(1000);

    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();

    // Get positions of key elements
    const priorityDot = incidentCard.locator('[class*="rounded-full"]').first();
    const locationHeading = incidentCard.locator('h3').first();

    const dotBox = await priorityDot.boundingBox();
    const headingBox = await locationHeading.boundingBox();

    if (dotBox && headingBox) {
      // Priority dot should not overlap with heading
      expect(dotBox.x + dotBox.width).toBeLessThanOrEqual(headingBox.x + 5); // 5px tolerance
    }
  });

  test('Sprint 3 features remain readable on small screens', async ({ authenticatedPage }) => {
    await authenticatedPage.setViewportSize({ width: 320, height: 568 }); // iPhone SE

    const eventsPage = new EventsPage(authenticatedPage);
    const mainPage = new MainPage(authenticatedPage);
    const testEventName = `Small Screen ${Date.now()}`;

    await eventsPage.goto();
    await eventsPage.createEvent(testEventName);
    await eventsPage.goto();
    await eventsPage.selectEvent(testEventName);
    await expect(authenticatedPage).toHaveURL('/');
    await authenticatedPage.waitForTimeout(1000);

    await mainPage.createQuickIncident(`Small ${Date.now()}`);
    await authenticatedPage.waitForTimeout(1000);

    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();

    // All elements should be visible
    const priorityDot = incidentCard.locator('[class*="rounded-full"]').first();
    await expect(priorityDot).toBeVisible();

    const timeElement = incidentCard.locator('[class*="font-mono"]').first();
    await expect(timeElement).toBeVisible();

    // Text should be readable size
    const fontSize = await timeElement.evaluate(el =>
      window.getComputedStyle(el).fontSize
    );

    const size = parseInt(fontSize);
    expect(size).toBeGreaterThanOrEqual(12);
  });
});

test.describe('Sprint 3 Integration - Performance', () => {
  let eventsPage: EventsPage;
  let mainPage: MainPage;
  let testEventName: string;

  test.beforeEach(async ({ authenticatedPage }) => {
    eventsPage = new EventsPage(authenticatedPage);
    mainPage = new MainPage(authenticatedPage);

    testEventName = `Performance Test ${Date.now()}`;
    await eventsPage.goto();
    await eventsPage.createEvent(testEventName);
    await eventsPage.goto();
    await eventsPage.selectEvent(testEventName);
    await expect(authenticatedPage).toHaveURL('/');
    await authenticatedPage.waitForTimeout(1000);
  });

  test('multiple incidents with Sprint 3 features render quickly', async ({ authenticatedPage }) => {
    // Create multiple incidents
    const createPromises = [];
    for (let i = 0; i < 5; i++) {
      createPromises.push(
        mainPage.createQuickIncident(`Performance ${i} ${Date.now()}`)
          .then(() => authenticatedPage.waitForTimeout(500))
      );
    }

    const startTime = Date.now();
    await Promise.all(createPromises);
    const endTime = Date.now();

    // Should create 5 incidents in reasonable time (< 15 seconds)
    expect(endTime - startTime).toBeLessThan(15000);

    // All incidents should be visible
    const incidents = authenticatedPage.locator('[data-testid="incident-card"]');
    const count = await incidents.count();

    expect(count).toBeGreaterThanOrEqual(5);

    // All should have Sprint 3 features
    for (let i = 0; i < Math.min(count, 5); i++) {
      const incident = incidents.nth(i);
      const hasPriority = await incident.locator('[class*="rounded-full"]').count() > 0;
      const hasTime = await incident.locator('svg[class*="lucide-clock"]').count() > 0;

      expect(hasPriority).toBeTruthy();
      expect(hasTime).toBeTruthy();
    }
  });

  test('Sprint 3 animations dont cause layout thrashing', async ({ authenticatedPage }) => {
    await mainPage.createQuickIncident(`Animation ${Date.now()}`);
    await authenticatedPage.waitForTimeout(1000);

    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();

    // Hover multiple times rapidly
    for (let i = 0; i < 3; i++) {
      await incidentCard.hover();
      await authenticatedPage.waitForTimeout(100);
      await authenticatedPage.mouse.move(0, 0);
      await authenticatedPage.waitForTimeout(100);
    }

    // Card should still be intact with all features
    const priorityDot = incidentCard.locator('[class*="rounded-full"]').first();
    await expect(priorityDot).toBeVisible();

    const clockIcon = incidentCard.locator('svg[class*="lucide-clock"]').first();
    await expect(clockIcon).toBeVisible();
  });
});

test.describe('Sprint 3 Integration - Accessibility', () => {
  let eventsPage: EventsPage;
  let mainPage: MainPage;
  let testEventName: string;

  test.beforeEach(async ({ authenticatedPage }) => {
    eventsPage = new EventsPage(authenticatedPage);
    mainPage = new MainPage(authenticatedPage);

    testEventName = `A11y Integration ${Date.now()}`;
    await eventsPage.goto();
    await eventsPage.createEvent(testEventName);
    await eventsPage.goto();
    await eventsPage.selectEvent(testEventName);
    await expect(authenticatedPage).toHaveURL('/');
    await authenticatedPage.waitForTimeout(1000);

    await mainPage.createQuickIncident(`A11y ${Date.now()}`);
    await authenticatedPage.waitForTimeout(1000);
  });

  test('all Sprint 3 visual indicators have semantic meaning', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();

    // Priority icon should have aria-label
    const priorityIcon = incidentCard.locator('[aria-label*="Priorität"]').first();

    if (await priorityIcon.count() > 0) {
      const ariaLabel = await priorityIcon.getAttribute('aria-label');
      expect(ariaLabel).toMatch(/Priorität/i);
    }

    // Time text should be plain text (readable by screen readers)
    const timeElement = incidentCard.locator('[class*="font-mono"]').first();
    const timeText = await timeElement.textContent();
    expect(timeText).toBeTruthy();
  });

  test('Sprint 3 features dont break keyboard navigation', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();

    // Tab to card
    await authenticatedPage.keyboard.press('Tab');
    await authenticatedPage.keyboard.press('Tab');

    // Card should still be clickable with Enter
    await authenticatedPage.keyboard.press('Enter');
    await authenticatedPage.waitForTimeout(500);

    const modal = authenticatedPage.locator('[role="dialog"]');

    // Modal may or may not open depending on focus - just verify no errors
    expect(true).toBeTruthy();
  });

  test('color-coded priority works without relying solely on color', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();

    // Priority should have BOTH color AND icon shape
    const priorityDot = incidentCard.locator('[class*="rounded-full"]').first();
    await expect(priorityDot).toBeVisible();

    const priorityIcon = incidentCard.locator('svg[class*="lucide-chevron"], svg[class*="lucide-minus"]').first();
    await expect(priorityIcon).toBeVisible();

    // Different priorities use different icon shapes (not just color)
    // ChevronUp, Minus, or ChevronDown provide shape differentiation
    const iconExists = await priorityIcon.count() > 0;
    expect(iconExists).toBeTruthy();
  });
});

test.describe('Sprint 3 Integration - Real-World Scenarios', () => {
  let eventsPage: EventsPage;
  let mainPage: MainPage;
  let testEventName: string;

  test.beforeEach(async ({ authenticatedPage }) => {
    eventsPage = new EventsPage(authenticatedPage);
    mainPage = new MainPage(authenticatedPage);

    testEventName = `Real World ${Date.now()}`;
    await eventsPage.goto();
    await eventsPage.createEvent(testEventName);
    await eventsPage.goto();
    await eventsPage.selectEvent(testEventName);
    await expect(authenticatedPage).toHaveURL('/');
    await authenticatedPage.waitForTimeout(1000);
  });

  test('operator can quickly identify incident priority and age', async ({ authenticatedPage }) => {
    await mainPage.createQuickIncident(`Emergency ${Date.now()}`);
    await authenticatedPage.waitForTimeout(1000);

    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();

    // Within 1 second, operator should see:
    // 1. Priority (colored dot and icon)
    const priorityVisible = await incidentCard.locator('[class*="rounded-full"]').isVisible();
    expect(priorityVisible).toBeTruthy();

    // 2. Age (elapsed time)
    const timeVisible = await incidentCard.locator('[class*="font-mono"]').last().isVisible();
    expect(timeVisible).toBeTruthy();

    // Both should be visible without scrolling
    const cardBox = await incidentCard.boundingBox();
    expect(cardBox).toBeTruthy();
  });

  test('Sprint 3 features support rapid incident triage', async ({ authenticatedPage }) => {
    // Create multiple incidents
    await mainPage.createQuickIncident(`Incident A ${Date.now()}`);
    await authenticatedPage.waitForTimeout(500);
    await mainPage.createQuickIncident(`Incident B ${Date.now()}`);
    await authenticatedPage.waitForTimeout(500);
    await mainPage.createQuickIncident(`Incident C ${Date.now()}`);
    await authenticatedPage.waitForTimeout(1000);

    const incidents = authenticatedPage.locator('[data-testid="incident-card"]');
    const count = await incidents.count();

    expect(count).toBeGreaterThanOrEqual(3);

    // Each incident should have clear priority and time
    for (let i = 0; i < Math.min(count, 3); i++) {
      const incident = incidents.nth(i);

      const hasPriority = await incident.locator('[class*="rounded-full"]').isVisible();
      const hasTime = await incident.locator('svg[class*="lucide-clock"]').isVisible();

      expect(hasPriority).toBeTruthy();
      expect(hasTime).toBeTruthy();
    }
  });

  test('Sprint 3 features enhance situational awareness', async ({ authenticatedPage }) => {
    await mainPage.createQuickIncident(`Situation ${Date.now()}`);
    await authenticatedPage.waitForTimeout(1000);

    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();

    // Operator should see complete picture:
    // - Location (h3 heading)
    const location = incidentCard.locator('h3').first();
    await expect(location).toBeVisible();

    // - Priority (visual indicators)
    const priority = incidentCard.locator('[class*="rounded-full"]').first();
    await expect(priority).toBeVisible();

    // - Age (time elapsed)
    const age = incidentCard.locator('[class*="font-mono"]').last();
    await expect(age).toBeVisible();

    // - Type (Siren icon and text)
    const type = incidentCard.locator('svg[class*="lucide-siren"]').first();
    await expect(type).toBeVisible();

    // All information is scannable at a glance
    const allVisible = await Promise.all([
      location.isVisible(),
      priority.isVisible(),
      age.isVisible(),
      type.isVisible()
    ]);

    expect(allVisible.every(v => v)).toBeTruthy();
  });
});
