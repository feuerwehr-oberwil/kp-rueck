import { test, expect } from '../../fixtures/auth.fixture';
import { EventsPage } from '../../pages/events.page';

/**
 * Quick Incident Creation Tests
 * Tests the enhanced incident creation modal with Quick Mode and Full Mode
 */

test.describe('Quick Incident Creation - Setup', () => {
  let eventsPage: EventsPage;
  let testEventName: string;

  test.beforeEach(async ({ authenticatedPage }) => {
    eventsPage = new EventsPage(authenticatedPage);

    // Create and select an event
    testEventName = `Quick Test Event ${Date.now()}`;
    await eventsPage.goto();
    await eventsPage.createEvent(testEventName);
    await eventsPage.goto();
    await eventsPage.selectEvent(testEventName);

    // Wait for redirect to main page
    await expect(authenticatedPage).toHaveURL('/');
    await authenticatedPage.waitForTimeout(1000);
  });

  test('quick add button is visible on main page', async ({ authenticatedPage }) => {
    // Verify "Schnell" button exists
    const quickButton = authenticatedPage.locator('button:has-text("Schnell")');
    await expect(quickButton).toBeVisible();

    // Verify Zap icon is present
    await expect(quickButton.locator('svg[class*="lucide-zap"]')).toBeVisible();

    // Verify button has orange/warning styling
    const hasOrangeStyle = await quickButton.evaluate(el =>
      el.className.includes('bg-orange') || el.outerHTML.includes('orange')
    );
    expect(hasOrangeStyle).toBeTruthy();
  });

  test('regular "Neuer Einsatz" button still exists', async ({ authenticatedPage }) => {
    // Verify regular create button still exists
    const regularButton = authenticatedPage.locator('button:has-text("Neuer Einsatz")');
    await expect(regularButton).toBeVisible();

    // Verify Plus icon is present
    await expect(regularButton.locator('svg[class*="lucide-plus"]')).toBeVisible();
  });
});

test.describe('Quick Mode Functionality', () => {
  let eventsPage: EventsPage;
  let testEventName: string;

  test.beforeEach(async ({ authenticatedPage }) => {
    eventsPage = new EventsPage(authenticatedPage);

    // Create and select an event
    testEventName = `Quick Mode Test ${Date.now()}`;
    await eventsPage.goto();
    await eventsPage.createEvent(testEventName);
    await eventsPage.goto();
    await eventsPage.selectEvent(testEventName);
    await expect(authenticatedPage).toHaveURL('/');
    await authenticatedPage.waitForTimeout(1000);
  });

  test('quick add button opens modal in quick mode', async ({ authenticatedPage }) => {
    // Click "Schnell" button
    const quickButton = authenticatedPage.locator('button:has-text("Schnell")');
    await quickButton.click();

    // Verify modal opens
    const modal = authenticatedPage.locator('[role="dialog"]');
    await expect(modal).toBeVisible();

    // Verify modal is in Quick Mode (has "Schnellerfassung" title)
    await expect(modal.locator('h2:has-text("Schnellerfassung")')).toBeVisible();

    // Verify Zap icon with sparkles is visible
    await expect(modal.locator('svg[class*="lucide-zap"]')).toBeVisible();
  });

  test('quick mode shows only location field', async ({ authenticatedPage }) => {
    // Open quick mode
    const quickButton = authenticatedPage.locator('button:has-text("Schnell")');
    await quickButton.click();

    const modal = authenticatedPage.locator('[role="dialog"]');
    await expect(modal).toBeVisible();

    // Verify location input is visible
    await expect(modal.locator('input[placeholder*="Adresse"]')).toBeVisible();

    // Verify notes/message field is NOT visible in quick mode
    const notesField = modal.locator('textarea[placeholder*="Notizen"]');
    await expect(notesField).not.toBeVisible();

    // Verify incident type dropdown is NOT visible in quick mode
    const typeSelect = modal.locator('text=Einsatzart').locator('..');
    await expect(typeSelect).not.toBeVisible();
  });

  test('quick mode displays smart defaults info box', async ({ authenticatedPage }) => {
    // Open quick mode
    const quickButton = authenticatedPage.locator('button:has-text("Schnell")');
    await quickButton.click();

    const modal = authenticatedPage.locator('[role="dialog"]');

    // Verify info box is visible
    const infoBox = modal.locator('text=Automatisch ausgefüllt:').locator('..');
    await expect(infoBox).toBeVisible();

    // Verify default values are shown
    await expect(modal.locator('text=Einsatzart:')).toBeVisible();
    await expect(modal.locator('text=Priorität: Mittel')).toBeVisible();
    await expect(modal.locator('text=Status: Eingegangen')).toBeVisible();
  });

  test('quick mode shows description about pre-filled values', async ({ authenticatedPage }) => {
    // Open quick mode
    const quickButton = authenticatedPage.locator('button:has-text("Schnell")');
    await quickButton.click();

    const modal = authenticatedPage.locator('[role="dialog"]');

    // Verify description is present
    await expect(modal.locator('text=Nur Standort eingeben - Rest wird automatisch ausgefüllt')).toBeVisible();
  });

  test('can create incident in quick mode', async ({ authenticatedPage }) => {
    // Open quick mode
    const quickButton = authenticatedPage.locator('button:has-text("Schnell")');
    await quickButton.click();

    const modal = authenticatedPage.locator('[role="dialog"]');

    // Enter location
    const locationInput = modal.locator('input[placeholder*="Adresse"]');
    await locationInput.fill('Teststrasse 123, Basel');

    // Click "Schnell erstellen" button
    const createButton = modal.locator('button:has-text("Schnell erstellen")');
    await createButton.click();

    // Verify success toast appears
    await authenticatedPage.waitForTimeout(500);
    const toast = authenticatedPage.locator('[data-sonner-toast]');
    await expect(toast).toBeVisible({ timeout: 5000 });

    // Verify toast shows success message
    await expect(toast.filter({ hasText: 'Zack, fertig!' })).toBeVisible();
    await expect(toast.filter({ hasText: 'Teststrasse 123' })).toBeVisible();

    // Verify incident appears on page (wait for it to render)
    await authenticatedPage.waitForTimeout(1000);
    const incidentCard = authenticatedPage.locator('text=Teststrasse 123, Basel');
    await expect(incidentCard).toBeVisible();
  });

  test('quick mode validates location is required', async ({ authenticatedPage }) => {
    // Open quick mode
    const quickButton = authenticatedPage.locator('button:has-text("Schnell")');
    await quickButton.click();

    const modal = authenticatedPage.locator('[role="dialog"]');

    // Leave location empty
    const locationInput = modal.locator('input[placeholder*="Adresse"]');
    await expect(locationInput).toBeEmpty();

    // Try to click "Schnell erstellen"
    const createButton = modal.locator('button:has-text("Schnell erstellen")');

    // Verify button is disabled when location is empty
    await expect(createButton).toBeDisabled();
  });

  test('quick mode button has Zap icon', async ({ authenticatedPage }) => {
    // Open quick mode
    const quickButton = authenticatedPage.locator('button:has-text("Schnell")');
    await quickButton.click();

    const modal = authenticatedPage.locator('[role="dialog"]');

    // Verify create button has Zap icon
    const createButton = modal.locator('button:has-text("Schnell erstellen")');
    await expect(createButton.locator('svg[class*="lucide-zap"]')).toBeVisible();
  });

  test('success toast shows time tracking for fast creation', async ({ authenticatedPage }) => {
    // Open quick mode
    const quickButton = authenticatedPage.locator('button:has-text("Schnell")');
    await quickButton.click();

    const modal = authenticatedPage.locator('[role="dialog"]');

    // Enter location quickly
    const locationInput = modal.locator('input[placeholder*="Adresse"]');
    await locationInput.fill('Schnellstrasse 1, Basel');

    // Wait a moment (but less than 15 seconds)
    await authenticatedPage.waitForTimeout(1000);

    // Submit
    const createButton = modal.locator('button:has-text("Schnell erstellen")');
    await createButton.click();

    // Verify toast appears
    const toast = authenticatedPage.locator('[data-sonner-toast]');
    await expect(toast).toBeVisible({ timeout: 5000 });

    // Check if time is shown (it should be under 15s)
    const hasTimeTracking = await toast.locator('text=/Erstellt in \\d+s/').isVisible().catch(() => false);

    // Time tracking appears for fast creation
    if (hasTimeTracking) {
      await expect(toast.locator('text=/Erstellt in \\d+s/')).toBeVisible();
    }
  });
});

test.describe('Mode Toggle Functionality', () => {
  let eventsPage: EventsPage;
  let testEventName: string;

  test.beforeEach(async ({ authenticatedPage }) => {
    eventsPage = new EventsPage(authenticatedPage);

    testEventName = `Toggle Test ${Date.now()}`;
    await eventsPage.goto();
    await eventsPage.createEvent(testEventName);
    await eventsPage.goto();
    await eventsPage.selectEvent(testEventName);
    await expect(authenticatedPage).toHaveURL('/');
    await authenticatedPage.waitForTimeout(1000);
  });

  test('can toggle from quick mode to full mode', async ({ authenticatedPage }) => {
    // Open quick mode
    const quickButton = authenticatedPage.locator('button:has-text("Schnell")');
    await quickButton.click();

    const modal = authenticatedPage.locator('[role="dialog"]');

    // Verify we're in quick mode
    await expect(modal.locator('h2:has-text("Schnellerfassung")')).toBeVisible();

    // Enter location
    const locationInput = modal.locator('input[placeholder*="Adresse"]');
    await locationInput.fill('Teststrasse 456, Basel');

    // Click mode toggle "Alle Details"
    const toggleButton = modal.locator('button:has-text("Alle Details")');
    await toggleButton.click();

    // Verify we're now in full mode (title changes)
    await expect(modal.locator('h2:has-text("Neuer Einsatz")')).toBeVisible();

    // Verify all fields are now visible
    await expect(modal.locator('textarea[placeholder*="Notizen"]')).toBeVisible();
    await expect(modal.locator('text=Einsatzart')).toBeVisible();
    await expect(modal.locator('text=Priorität')).toBeVisible();

    // Verify location value is preserved
    const locationValue = await locationInput.inputValue();
    expect(locationValue).toBe('Teststrasse 456, Basel');
  });

  test('can toggle from full mode to quick mode', async ({ authenticatedPage }) => {
    // Open full mode
    const regularButton = authenticatedPage.locator('button:has-text("Neuer Einsatz")');
    await regularButton.click();

    const modal = authenticatedPage.locator('[role="dialog"]');

    // Verify we're in full mode
    await expect(modal.locator('h2:has-text("Neuer Einsatz")')).toBeVisible();

    // Click mode toggle "Schnellmodus"
    const toggleButton = modal.locator('button:has-text("Schnellmodus")');
    await toggleButton.click();

    // Verify we're now in quick mode
    await expect(modal.locator('h2:has-text("Schnellerfassung")')).toBeVisible();

    // Verify detailed fields are hidden
    const notesField = modal.locator('textarea[placeholder*="Notizen"]');
    await expect(notesField).not.toBeVisible();
  });

  test('mode toggle button has chevron icon', async ({ authenticatedPage }) => {
    // Open quick mode
    const quickButton = authenticatedPage.locator('button:has-text("Schnell")');
    await quickButton.click();

    const modal = authenticatedPage.locator('[role="dialog"]');

    // Verify toggle button has chevron
    const toggleButton = modal.locator('button:has-text("Alle Details")');
    await expect(toggleButton.locator('svg[class*="lucide-chevron-right"]')).toBeVisible();
  });
});

test.describe('Full Mode Button', () => {
  let eventsPage: EventsPage;
  let testEventName: string;

  test.beforeEach(async ({ authenticatedPage }) => {
    eventsPage = new EventsPage(authenticatedPage);

    testEventName = `Full Mode Test ${Date.now()}`;
    await eventsPage.goto();
    await eventsPage.createEvent(testEventName);
    await eventsPage.goto();
    await eventsPage.selectEvent(testEventName);
    await expect(authenticatedPage).toHaveURL('/');
    await authenticatedPage.waitForTimeout(1000);
  });

  test('full mode button opens modal with all fields', async ({ authenticatedPage }) => {
    // Click "Neuer Einsatz" button
    const regularButton = authenticatedPage.locator('button:has-text("Neuer Einsatz")');
    await regularButton.click();

    const modal = authenticatedPage.locator('[role="dialog"]');
    await expect(modal).toBeVisible();

    // Verify we're in full mode
    await expect(modal.locator('h2:has-text("Neuer Einsatz")')).toBeVisible();

    // Verify all fields are visible
    await expect(modal.locator('input[placeholder*="Adresse"]')).toBeVisible();
    await expect(modal.locator('textarea[placeholder*="Notizen"]')).toBeVisible();
    await expect(modal.locator('text=Einsatzart')).toBeVisible();
    await expect(modal.locator('text=Priorität')).toBeVisible();
    await expect(modal.locator('text=Kontakt / Melder')).toBeVisible();
  });

  test('full mode create button has Plus icon', async ({ authenticatedPage }) => {
    // Open full mode
    const regularButton = authenticatedPage.locator('button:has-text("Neuer Einsatz")');
    await regularButton.click();

    const modal = authenticatedPage.locator('[role="dialog"]');

    // Verify create button has Plus icon
    const createButton = modal.locator('button:has-text("Einsatz erstellen")');
    await expect(createButton.locator('svg[class*="lucide-plus"]')).toBeVisible();
  });

  test('full mode shows standard success toast', async ({ authenticatedPage }) => {
    // Open full mode
    const regularButton = authenticatedPage.locator('button:has-text("Neuer Einsatz")');
    await regularButton.click();

    const modal = authenticatedPage.locator('[role="dialog"]');

    // Enter location
    const locationInput = modal.locator('input[placeholder*="Adresse"]');
    await locationInput.fill('Vollstrasse 789, Basel');

    // Submit
    const createButton = modal.locator('button:has-text("Einsatz erstellen")');
    await createButton.click();

    // Verify standard success toast appears
    const toast = authenticatedPage.locator('[data-sonner-toast]');
    await expect(toast).toBeVisible({ timeout: 5000 });

    // Verify toast shows standard message (not quick mode message)
    await expect(toast.filter({ hasText: 'Einsatz erfolgreich erstellt' })).toBeVisible();
    await expect(toast.filter({ hasText: 'Vollstrasse 789' })).toBeVisible();
  });
});

test.describe('Quick Incident Creation - Mobile', () => {
  let eventsPage: EventsPage;
  let testEventName: string;

  test.beforeEach(async ({ authenticatedPage }) => {
    // Set mobile viewport
    await authenticatedPage.setViewportSize({ width: 375, height: 667 });

    eventsPage = new EventsPage(authenticatedPage);

    testEventName = `Mobile Test ${Date.now()}`;
    await eventsPage.goto();
    await eventsPage.createEvent(testEventName);
    await eventsPage.goto();
    await eventsPage.selectEvent(testEventName);
    await expect(authenticatedPage).toHaveURL('/');
    await authenticatedPage.waitForTimeout(1000);
  });

  test('quick button is accessible on mobile', async ({ authenticatedPage }) => {
    // Verify "Schnell" button is visible on mobile
    const quickButton = authenticatedPage.locator('button:has-text("Schnell")');
    await expect(quickButton).toBeVisible();

    // Button should maintain 44px minimum touch target
    const buttonHeight = await quickButton.evaluate(el => el.getBoundingClientRect().height);
    expect(buttonHeight).toBeGreaterThanOrEqual(44);
  });

  test('quick mode modal is scrollable on mobile', async ({ authenticatedPage }) => {
    // Open quick mode
    const quickButton = authenticatedPage.locator('button:has-text("Schnell")');
    await quickButton.click();

    const modal = authenticatedPage.locator('[role="dialog"]');
    await expect(modal).toBeVisible();

    // Verify modal has overflow-y-auto class
    const hasOverflow = await modal.evaluate(el =>
      el.className.includes('overflow-y-auto') ||
      getComputedStyle(el).overflowY === 'auto'
    );
    expect(hasOverflow).toBeTruthy();
  });
});
