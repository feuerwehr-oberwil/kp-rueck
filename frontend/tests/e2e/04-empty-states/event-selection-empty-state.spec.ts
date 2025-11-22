import { test, expect } from '../../fixtures/auth.fixture';

/**
 * Event Selection Empty State Tests
 * Tests the empty state component shown when no event is selected
 */

test.describe('Event Selection Empty State', () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    // Navigate to main page without selecting an event
    await authenticatedPage.goto('/');
  });

  test('shows empty state when no event is selected', async ({ authenticatedPage }) => {
    // Verify empty state component is visible
    const emptyState = authenticatedPage.locator('[class*="max-w-2xl"]').filter({
      has: authenticatedPage.locator('text=Noch kein Ereignis ausgewählt?')
    });
    await expect(emptyState).toBeVisible();

    // Verify welcome message appears
    await expect(authenticatedPage.locator('h1:has-text("Noch kein Ereignis ausgewählt?")')).toBeVisible();
    await expect(authenticatedPage.locator('text=Kein Problem! Erstellen Sie ein neues Ereignis')).toBeVisible();
  });

  test('displays calendar icon with gentle pulse animation', async ({ authenticatedPage }) => {
    // Verify calendar icon is present
    const calendarIcon = authenticatedPage.locator('[class*="animate-gentle-pulse"]').locator('svg[class*="lucide-calendar"]');
    await expect(calendarIcon).toBeVisible();

    // Verify icon has animation class
    const pulseContainer = authenticatedPage.locator('[class*="animate-gentle-pulse"]');
    await expect(pulseContainer).toBeVisible();
  });

  test('shows motivational message with sparkles icon', async ({ authenticatedPage }) => {
    // Verify sparkles icon is present
    const sparklesIcon = authenticatedPage.locator('svg[class*="lucide-sparkles"]').first();
    await expect(sparklesIcon).toBeVisible();

    // Verify motivational text
    await expect(authenticatedPage.locator('text=Bereit für Ihren ersten Einsatz')).toBeVisible();
  });

  test('displays "Create New Event" button', async ({ authenticatedPage }) => {
    // Verify "Neues Ereignis erstellen" button exists
    const createButton = authenticatedPage.locator('button:has-text("Neues Ereignis erstellen")');
    await expect(createButton).toBeVisible();

    // Verify button has calendar icon
    await expect(createButton.locator('svg[class*="lucide-calendar"]')).toBeVisible();

    // Verify button is clickable (has hover effect class)
    const hasHoverDelight = await createButton.evaluate(el =>
      el.className.includes('hover-delight')
    );
    expect(hasHoverDelight).toBeTruthy();
  });

  test('displays "View Events" button', async ({ authenticatedPage }) => {
    // Verify "Ereignisse anzeigen" button exists
    const viewButton = authenticatedPage.locator('button:has-text("Ereignisse anzeigen")');
    await expect(viewButton).toBeVisible();

    // Verify button has chevron icon
    await expect(viewButton.locator('svg[class*="lucide-chevron-right"]')).toBeVisible();

    // Verify button is outline variant
    const isOutlineVariant = await viewButton.evaluate(el =>
      el.className.includes('outline')
    );
    expect(isOutlineVariant).toBeTruthy();
  });

  test('create button navigates to events page with create action', async ({ authenticatedPage }) => {
    // Click "Neues Ereignis erstellen" button
    const createButton = authenticatedPage.locator('button:has-text("Neues Ereignis erstellen")');
    await createButton.click();

    // Verify navigation to events page with action parameter
    await expect(authenticatedPage).toHaveURL(/\/events\?action=create/);
  });

  test('view button navigates to events page', async ({ authenticatedPage }) => {
    // Click "Ereignisse anzeigen" button
    const viewButton = authenticatedPage.locator('button:has-text("Ereignisse anzeigen")');
    await viewButton.click();

    // Verify navigation to events page
    await expect(authenticatedPage).toHaveURL(/\/events/);
  });

  test('displays quick start guide with 4 steps', async ({ authenticatedPage }) => {
    // Verify "Erste Schritte" section is visible
    await expect(authenticatedPage.locator('text=Erste Schritte')).toBeVisible();

    // Verify all 4 steps are present
    const steps = [
      'Ereignis erstellen für heutigen Einsatztag',
      'Personal über Check-In QR-Code einchecken',
      'Fahrzeuge als einsatzbereit markieren',
      'Ersten Einsatz anlegen und Ressourcen zuweisen',
    ];

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const stepElement = authenticatedPage.locator(`text=${i + 1}. ${step}`);
      await expect(stepElement).toBeVisible();
    }
  });

  test('quick start guide steps have hover effects', async ({ authenticatedPage }) => {
    // Find first step
    const firstStep = authenticatedPage.locator('li').filter({
      hasText: '1. Ereignis erstellen'
    }).first();

    // Hover over step
    await firstStep.hover();

    // Verify step has group class for hover effects
    const hasGroupClass = await firstStep.evaluate(el =>
      el.className.includes('group')
    );
    expect(hasGroupClass).toBeTruthy();
  });

  test('empty state has border separator before quick start guide', async ({ authenticatedPage }) => {
    // Verify border-t class is present
    const quickStartSection = authenticatedPage.locator('div').filter({
      has: authenticatedPage.locator('text=Erste Schritte')
    }).filter({
      has: authenticatedPage.locator('[class*="border-t"]')
    });
    await expect(quickStartSection).toBeVisible();
  });

  test('empty state is responsive on mobile', async ({ authenticatedPage }) => {
    // Set viewport to mobile size
    await authenticatedPage.setViewportSize({ width: 375, height: 667 });

    // Verify empty state is still visible
    const emptyState = authenticatedPage.locator('h1:has-text("Noch kein Ereignis ausgewählt?")');
    await expect(emptyState).toBeVisible();

    // Verify buttons stack vertically on mobile (flex-col)
    const buttonContainer = authenticatedPage.locator('div').filter({
      has: authenticatedPage.locator('button:has-text("Neues Ereignis erstellen")')
    }).filter({
      has: authenticatedPage.locator('button:has-text("Ereignisse anzeigen")')
    });

    const isFlexCol = await buttonContainer.evaluate(el =>
      el.className.includes('flex-col')
    );
    expect(isFlexCol).toBeTruthy();
  });
});

test.describe('Event Selection Empty State - With Event Selected', () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    // First navigate to events page
    await authenticatedPage.goto('/events');
    await authenticatedPage.waitForTimeout(1000);
  });

  test('empty state does not show when event is selected', async ({ authenticatedPage }) => {
    // Create a test event
    const eventName = `Test Event ${Date.now()}`;
    const createButton = authenticatedPage.locator('button:has-text("Neues Ereignis")').first();
    await createButton.click();

    // Fill in event name
    const nameInput = authenticatedPage.locator('input#event-name');
    await nameInput.fill(eventName);

    // Submit
    const submitButton = authenticatedPage.locator('button:has-text("Erstellen")');
    await submitButton.click();
    await authenticatedPage.waitForTimeout(1000);

    // Select the event
    await authenticatedPage.goto('/events');
    await authenticatedPage.waitForTimeout(500);

    const selectButton = authenticatedPage.locator('button:has-text("Auswählen")').first();
    await selectButton.click();

    // Wait for redirect to main page
    await expect(authenticatedPage).toHaveURL('/');
    await authenticatedPage.waitForTimeout(1000);

    // Verify empty state is NOT visible
    const emptyState = authenticatedPage.locator('text=Noch kein Ereignis ausgewählt?');
    await expect(emptyState).not.toBeVisible();

    // Verify kanban board or incident view is visible instead
    const hasContent = await authenticatedPage.locator('main').isVisible();
    expect(hasContent).toBeTruthy();
  });
});
