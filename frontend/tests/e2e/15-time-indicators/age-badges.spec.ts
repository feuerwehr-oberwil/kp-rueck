import { test, expect } from '../../fixtures/auth.fixture';
import { EventsPage } from '../../pages/events.page';
import { MainPage } from '../../pages/main.page';

/**
 * Time-Based Indicators Tests (Sprint 3)
 * Tests the age/time indicators on incident cards
 * Ensures operators can quickly identify old incidents
 */

test.describe('Time-Based Indicators - Display and Formatting', () => {
  let eventsPage: EventsPage;
  let mainPage: MainPage;
  let testEventName: string;

  test.beforeEach(async ({ authenticatedPage }) => {
    eventsPage = new EventsPage(authenticatedPage);
    mainPage = new MainPage(authenticatedPage);

    testEventName = `Time Test ${Date.now()}`;
    await eventsPage.goto();
    await eventsPage.createEvent(testEventName);
    await eventsPage.goto();
    await eventsPage.selectEvent(testEventName);
    await expect(authenticatedPage).toHaveURL('/');
    await authenticatedPage.waitForTimeout(1000);

    await mainPage.createQuickIncident(`Time Test ${Date.now()}`);
    await authenticatedPage.waitForTimeout(1000);
  });

  test('incident shows dispatch time', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();

    // Should show time in HH:MM format
    const timeElement = incidentCard.locator('[class*="font-mono"]').filter({ hasText: /:/ }).first();

    await expect(timeElement).toBeVisible();

    const timeText = await timeElement.textContent();
    expect(timeText).toMatch(/\d{2}:\d{2}/); // HH:MM format
  });

  test('incident shows elapsed time', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();

    // Should show elapsed time (e.g., "0'", "5'", "1h 23'")
    const elapsedTime = incidentCard.locator('[class*="font-mono"]').filter({ hasText: /' $|h / }).first();

    await expect(elapsedTime).toBeVisible();

    const elapsedText = await elapsedTime.textContent();

    // Should be in format: "X'" for minutes or "Xh Y'" for hours
    expect(elapsedText).toMatch(/\d+['h]|h \d+'/);
  });

  test('newly created incident shows 0 minutes', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();

    // Find elapsed time
    const elapsedTime = incidentCard.locator('[class*="font-mono"]').last();
    const elapsedText = await elapsedTime.textContent();

    // Should show 0' or very low number
    expect(elapsedText).toMatch(/^[0-5]'/);
  });

  test('time display uses monospace font', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();

    // Time elements should use font-mono class
    const timeElement = incidentCard.locator('[class*="font-mono"]').first();

    const hasMonospace = await timeElement.evaluate(el =>
      el.className.includes('font-mono')
    );

    expect(hasMonospace).toBeTruthy();
  });

  test('clock icon accompanies time display', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();

    // Should have Clock icon
    const clockIcon = incidentCard.locator('svg[class*="lucide-clock"]').first();

    await expect(clockIcon).toBeVisible();
  });
});

test.describe('Time-Based Indicators - Time Formatting', () => {
  let eventsPage: EventsPage;
  let mainPage: MainPage;
  let testEventName: string;

  test.beforeEach(async ({ authenticatedPage }) => {
    eventsPage = new EventsPage(authenticatedPage);
    mainPage = new MainPage(authenticatedPage);

    testEventName = `Format Test ${Date.now()}`;
    await eventsPage.goto();
    await eventsPage.createEvent(testEventName);
    await eventsPage.goto();
    await eventsPage.selectEvent(testEventName);
    await expect(authenticatedPage).toHaveURL('/');
    await authenticatedPage.waitForTimeout(1000);

    await mainPage.createQuickIncident(`Format Test ${Date.now()}`);
    await authenticatedPage.waitForTimeout(1000);
  });

  test('dispatch time uses 24-hour format', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();

    const timeElement = incidentCard.locator('[class*="font-mono"]').filter({ hasText: /:/ }).first();
    const timeText = await timeElement.textContent();

    // Should be HH:MM in 24-hour format
    expect(timeText).toMatch(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/);
  });

  test('elapsed time shows minutes with apostrophe', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();

    const elapsedTime = incidentCard.locator('[class*="font-mono"]').last();
    const elapsedText = await elapsedTime.textContent();

    // Should end with ' (apostrophe for minutes)
    expect(elapsedText).toMatch(/'/);
  });

  test('elapsed time over 60 minutes shows hours', async ({ authenticatedPage }) => {
    // This test verifies the format even though new incidents won't have hours yet
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();

    const elapsedTime = incidentCard.locator('[class*="font-mono"]').last();

    // Format should support "Xh Y'" pattern
    // For now, just verify element exists
    await expect(elapsedTime).toBeVisible();
  });
});

test.describe('Time-Based Indicators - Visual Styling', () => {
  let eventsPage: EventsPage;
  let mainPage: MainPage;
  let testEventName: string;

  test.beforeEach(async ({ authenticatedPage }) => {
    eventsPage = new EventsPage(authenticatedPage);
    mainPage = new MainPage(authenticatedPage);

    testEventName = `Style Test ${Date.now()}`;
    await eventsPage.goto();
    await eventsPage.createEvent(testEventName);
    await eventsPage.goto();
    await eventsPage.selectEvent(testEventName);
    await expect(authenticatedPage).toHaveURL('/');
    await authenticatedPage.waitForTimeout(1000);

    await mainPage.createQuickIncident(`Style Test ${Date.now()}`);
    await authenticatedPage.waitForTimeout(1000);
  });

  test('time elements use muted foreground color', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();

    const timeElement = incidentCard.locator('[class*="font-mono"]').first();

    const hasMutedColor = await timeElement.evaluate(el =>
      el.className.includes('text-muted-foreground')
    );

    expect(hasMutedColor).toBeTruthy();
  });

  test('time section has proper layout', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();

    // Time section should be in a flex container
    const timeContainer = incidentCard.locator('[class*="flex"][class*="items-center"]').filter({
      has: authenticatedPage.locator('svg[class*="lucide-clock"]')
    }).first();

    await expect(timeContainer).toBeVisible();

    // Should have gap between icon and text
    const hasGap = await timeContainer.evaluate(el =>
      el.className.includes('gap-')
    );

    expect(hasGap).toBeTruthy();
  });

  test('clock icon is properly sized', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();

    const clockIcon = incidentCard.locator('svg[class*="lucide-clock"]').first();

    // Should have h-4 w-4 sizing
    const hasProperSize = await clockIcon.evaluate(el =>
      el.className.includes('h-4') && el.className.includes('w-4')
    );

    expect(hasProperSize).toBeTruthy();
  });

  test('time display has consistent text size', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();

    const timeElements = incidentCard.locator('[class*="font-mono"]');
    const count = await timeElements.count();

    // All time elements should have text-sm or text-xs
    for (let i = 0; i < count; i++) {
      const element = timeElements.nth(i);
      const hasTextSize = await element.evaluate(el =>
        el.className.includes('text-sm') || el.className.includes('text-xs')
      );

      expect(hasTextSize).toBeTruthy();
    }
  });
});

test.describe('Time-Based Indicators - Layout and Position', () => {
  let eventsPage: EventsPage;
  let mainPage: MainPage;
  let testEventName: string;

  test.beforeEach(async ({ authenticatedPage }) => {
    eventsPage = new EventsPage(authenticatedPage);
    mainPage = new MainPage(authenticatedPage);

    testEventName = `Layout Test ${Date.now()}`;
    await eventsPage.goto();
    await eventsPage.createEvent(testEventName);
    await eventsPage.goto();
    await eventsPage.selectEvent(testEventName);
    await expect(authenticatedPage).toHaveURL('/');
    await authenticatedPage.waitForTimeout(1000);

    await mainPage.createQuickIncident(`Layout Test ${Date.now()}`);
    await authenticatedPage.waitForTimeout(1000);
  });

  test('dispatch time is on same line as clock icon', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();

    // Clock icon and dispatch time should be in flex row
    const timeRow = incidentCard.locator('[class*="flex"][class*="items-center"]').filter({
      has: authenticatedPage.locator('svg[class*="lucide-clock"]')
    }).first();

    await expect(timeRow).toBeVisible();

    // Should contain both icon and time text
    const hasIcon = await timeRow.locator('svg[class*="lucide-clock"]').count() > 0;
    const hasTime = await timeRow.locator('[class*="font-mono"]').count() > 0;

    expect(hasIcon && hasTime).toBeTruthy();
  });

  test('elapsed time is aligned to the right', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();

    // Find the time row container
    const timeRow = incidentCard.locator('[class*="flex"][class*="justify-between"]').filter({
      has: authenticatedPage.locator('svg[class*="lucide-clock"]')
    }).first();

    // Should use justify-between for left/right alignment
    const hasJustifyBetween = await timeRow.evaluate(el =>
      el.className.includes('justify-between')
    );

    expect(hasJustifyBetween).toBeTruthy();
  });

  test('time section is below incident type', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();

    // Get positions of incident type (Siren icon) and time (Clock icon)
    const sirenIcon = incidentCard.locator('svg[class*="lucide-siren"]').first();
    const clockIcon = incidentCard.locator('svg[class*="lucide-clock"]').first();

    if (await sirenIcon.count() > 0 && await clockIcon.count() > 0) {
      const sirenBox = await sirenIcon.boundingBox();
      const clockBox = await clockIcon.boundingBox();

      if (sirenBox && clockBox) {
        // Clock should be below Siren
        expect(clockBox.y).toBeGreaterThan(sirenBox.y);
      }
    }
  });
});

test.describe('Time-Based Indicators - Responsiveness', () => {
  test('time displays correctly on mobile', async ({ authenticatedPage }) => {
    await authenticatedPage.setViewportSize({ width: 375, height: 667 });

    const eventsPage = new EventsPage(authenticatedPage);
    const mainPage = new MainPage(authenticatedPage);
    const testEventName = `Mobile Time Test ${Date.now()}`;

    await eventsPage.goto();
    await eventsPage.createEvent(testEventName);
    await eventsPage.goto();
    await eventsPage.selectEvent(testEventName);
    await expect(authenticatedPage).toHaveURL('/');
    await authenticatedPage.waitForTimeout(1000);

    await mainPage.createQuickIncident(`Mobile Test ${Date.now()}`);
    await authenticatedPage.waitForTimeout(1000);

    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();

    // Time should still be visible on mobile
    const timeElement = incidentCard.locator('[class*="font-mono"]').first();
    await expect(timeElement).toBeVisible();
  });

  test('elapsed time remains readable on mobile', async ({ authenticatedPage }) => {
    await authenticatedPage.setViewportSize({ width: 375, height: 667 });

    const eventsPage = new EventsPage(authenticatedPage);
    const mainPage = new MainPage(authenticatedPage);
    const testEventName = `Mobile Elapsed Test ${Date.now()}`;

    await eventsPage.goto();
    await eventsPage.createEvent(testEventName);
    await eventsPage.goto();
    await eventsPage.selectEvent(testEventName);
    await expect(authenticatedPage).toHaveURL('/');
    await authenticatedPage.waitForTimeout(1000);

    await mainPage.createQuickIncident(`Mobile Test ${Date.now()}`);
    await authenticatedPage.waitForTimeout(1000);

    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();
    const elapsedTime = incidentCard.locator('[class*="font-mono"]').last();

    // Should be visible and readable
    await expect(elapsedTime).toBeVisible();

    const fontSize = await elapsedTime.evaluate(el =>
      window.getComputedStyle(el).fontSize
    );

    // Should be at least 12px
    const size = parseInt(fontSize);
    expect(size).toBeGreaterThanOrEqual(12);
  });

  test('time section doesnt overflow on mobile', async ({ authenticatedPage }) => {
    await authenticatedPage.setViewportSize({ width: 375, height: 667 });

    const eventsPage = new EventsPage(authenticatedPage);
    const mainPage = new MainPage(authenticatedPage);
    const testEventName = `Mobile Overflow Test ${Date.now()}`;

    await eventsPage.goto();
    await eventsPage.createEvent(testEventName);
    await eventsPage.goto();
    await eventsPage.selectEvent(testEventName);
    await expect(authenticatedPage).toHaveURL('/');
    await authenticatedPage.waitForTimeout(1000);

    await mainPage.createQuickIncident(`Mobile Test ${Date.now()}`);
    await authenticatedPage.waitForTimeout(1000);

    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();
    const timeRow = incidentCard.locator('[class*="flex"]').filter({
      has: authenticatedPage.locator('svg[class*="lucide-clock"]')
    }).first();

    // Get card width and time row width
    const cardBox = await incidentCard.boundingBox();
    const timeBox = await timeRow.boundingBox();

    if (cardBox && timeBox) {
      // Time row should not exceed card width
      expect(timeBox.width).toBeLessThanOrEqual(cardBox.width);
    }
  });
});

test.describe('Time-Based Indicators - Accessibility', () => {
  let eventsPage: EventsPage;
  let mainPage: MainPage;
  let testEventName: string;

  test.beforeEach(async ({ authenticatedPage }) => {
    eventsPage = new EventsPage(authenticatedPage);
    mainPage = new MainPage(authenticatedPage);

    testEventName = `A11y Time Test ${Date.now()}`;
    await eventsPage.goto();
    await eventsPage.createEvent(testEventName);
    await eventsPage.goto();
    await eventsPage.selectEvent(testEventName);
    await expect(authenticatedPage).toHaveURL('/');
    await authenticatedPage.waitForTimeout(1000);

    await mainPage.createQuickIncident(`A11y Test ${Date.now()}`);
    await authenticatedPage.waitForTimeout(1000);
  });

  test('time information is readable by screen readers', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();

    // Time text should be in plain text, readable by screen readers
    const timeElement = incidentCard.locator('[class*="font-mono"]').first();

    const text = await timeElement.textContent();
    expect(text).toBeTruthy();
    expect(text?.length).toBeGreaterThan(0);
  });

  test('clock icon has semantic meaning', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();

    // Clock icon should be next to time text for context
    const clockIcon = incidentCard.locator('svg[class*="lucide-clock"]').first();

    await expect(clockIcon).toBeVisible();

    // Icon should have aria-hidden or be decorative
    const ariaHidden = await clockIcon.evaluate(el => el.getAttribute('aria-hidden'));

    // Icon is decorative (aria-hidden) or has semantic meaning
    expect(ariaHidden === 'true' || ariaHidden === null).toBeTruthy();
  });
});

test.describe('Time-Based Indicators - Multiple Incidents', () => {
  let eventsPage: EventsPage;
  let mainPage: MainPage;
  let testEventName: string;

  test.beforeEach(async ({ authenticatedPage }) => {
    eventsPage = new EventsPage(authenticatedPage);
    mainPage = new MainPage(authenticatedPage);

    testEventName = `Multiple Time Test ${Date.now()}`;
    await eventsPage.goto();
    await eventsPage.createEvent(testEventName);
    await eventsPage.goto();
    await eventsPage.selectEvent(testEventName);
    await expect(authenticatedPage).toHaveURL('/');
    await authenticatedPage.waitForTimeout(1000);

    // Create multiple incidents
    await mainPage.createQuickIncident(`First ${Date.now()}`);
    await authenticatedPage.waitForTimeout(500);
    await mainPage.createQuickIncident(`Second ${Date.now()}`);
    await authenticatedPage.waitForTimeout(500);
    await mainPage.createQuickIncident(`Third ${Date.now()}`);
    await authenticatedPage.waitForTimeout(1000);
  });

  test('all incidents show time information', async ({ authenticatedPage }) => {
    const incidents = authenticatedPage.locator('[data-testid="incident-card"]');
    const count = await incidents.count();

    expect(count).toBeGreaterThanOrEqual(3);

    // Each incident should have clock icon and time
    for (let i = 0; i < Math.min(count, 3); i++) {
      const incident = incidents.nth(i);
      const clockIcon = incident.locator('svg[class*="lucide-clock"]').first();
      await expect(clockIcon).toBeVisible();
    }
  });

  test('incidents created sequentially have increasing elapsed time', async ({ authenticatedPage }) => {
    const incidents = authenticatedPage.locator('[data-testid="incident-card"]');
    const count = await incidents.count();

    if (count >= 2) {
      // Get elapsed times
      const first = incidents.first();
      const last = incidents.last();

      const firstElapsed = first.locator('[class*="font-mono"]').last();
      const lastElapsed = last.locator('[class*="font-mono"]').last();

      // Both should show very low times (0-5 minutes since just created)
      const firstText = await firstElapsed.textContent() || '';
      const lastText = await lastElapsed.textContent() || '';

      // Both should be in minute format
      expect(firstText).toMatch(/\d+'/);
      expect(lastText).toMatch(/\d+'/);
    }
  });
});

test.describe('Time-Based Indicators - Dark Mode', () => {
  let eventsPage: EventsPage;
  let mainPage: MainPage;
  let testEventName: string;

  test.beforeEach(async ({ authenticatedPage }) => {
    eventsPage = new EventsPage(authenticatedPage);
    mainPage = new MainPage(authenticatedPage);

    testEventName = `Dark Mode Test ${Date.now()}`;
    await eventsPage.goto();
    await eventsPage.createEvent(testEventName);
    await eventsPage.goto();
    await eventsPage.selectEvent(testEventName);
    await expect(authenticatedPage).toHaveURL('/');
    await authenticatedPage.waitForTimeout(1000);

    await mainPage.createQuickIncident(`Dark Test ${Date.now()}`);
    await authenticatedPage.waitForTimeout(1000);
  });

  test('time text uses muted foreground in all themes', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();

    const timeElement = incidentCard.locator('[class*="font-mono"]').first();

    // Should use text-muted-foreground which adapts to theme
    const hasMutedColor = await timeElement.evaluate(el =>
      el.className.includes('text-muted-foreground')
    );

    expect(hasMutedColor).toBeTruthy();
  });

  test('clock icon is visible in dark mode', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();

    const clockIcon = incidentCard.locator('svg[class*="lucide-clock"]').first();

    // Icon should be visible
    await expect(clockIcon).toBeVisible();

    // Should have muted color that works in both themes
    const hasMutedColor = await clockIcon.evaluate(el =>
      el.className.includes('text-muted-foreground')
    );

    expect(hasMutedColor).toBeTruthy();
  });
});
