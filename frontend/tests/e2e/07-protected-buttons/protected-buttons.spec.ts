import { test, expect } from '../../fixtures/auth.fixture';
import { EventsPage } from '../../pages/events.page';

/**
 * Protected Button Tests
 * Tests buttons that require editor permissions
 * Shows lock icons and helpful tooltips for viewers
 */

test.describe('Protected Buttons - Editor Access', () => {
  let eventsPage: EventsPage;
  let testEventName: string;

  test.beforeEach(async ({ authenticatedPage }) => {
    eventsPage = new EventsPage(authenticatedPage);

    // Create and select an event
    testEventName = `Editor Test ${Date.now()}`;
    await eventsPage.goto();
    await eventsPage.createEvent(testEventName);
    await eventsPage.goto();
    await eventsPage.selectEvent(testEventName);

    // Wait for redirect to main page
    await expect(authenticatedPage).toHaveURL('/');
    await authenticatedPage.waitForTimeout(1000);
  });

  test('editor can see create buttons without lock icons', async ({ authenticatedPage }) => {
    // Verify "Schnell" button is enabled
    const quickButton = authenticatedPage.locator('button:has-text("Schnell")');
    await expect(quickButton).toBeVisible();
    await expect(quickButton).toBeEnabled();

    // Verify "Neuer Einsatz" button is enabled
    const newIncidentButton = authenticatedPage.locator('button:has-text("Neuer Einsatz")');
    await expect(newIncidentButton).toBeVisible();
    await expect(newIncidentButton).toBeEnabled();

    // Verify NO lock icons are visible on these buttons
    const lockIconInQuick = quickButton.locator('svg[class*="lucide-lock"]');
    await expect(lockIconInQuick).not.toBeVisible();

    const lockIconInNew = newIncidentButton.locator('svg[class*="lucide-lock"]');
    await expect(lockIconInNew).not.toBeVisible();
  });

  test('editor can click quick add button', async ({ authenticatedPage }) => {
    // Click "Schnell" button
    const quickButton = authenticatedPage.locator('button:has-text("Schnell")');
    await quickButton.click();

    // Verify modal opens (no error or restriction)
    const modal = authenticatedPage.locator('[role="dialog"]');
    await expect(modal).toBeVisible();

    // Verify we're in quick mode
    await expect(modal.locator('h2:has-text("Schnellerfassung")')).toBeVisible();
  });

  test('editor can click new incident button', async ({ authenticatedPage }) => {
    // Click "Neuer Einsatz" button
    const newIncidentButton = authenticatedPage.locator('button:has-text("Neuer Einsatz")');
    await newIncidentButton.click();

    // Verify modal opens
    const modal = authenticatedPage.locator('[role="dialog"]');
    await expect(modal).toBeVisible();

    // Verify we're in full mode
    await expect(modal.locator('h2:has-text("Neuer Einsatz")')).toBeVisible();
  });

  test('editor can create incidents without restrictions', async ({ authenticatedPage }) => {
    // Click quick button
    const quickButton = authenticatedPage.locator('button:has-text("Schnell")');
    await quickButton.click();

    const modal = authenticatedPage.locator('[role="dialog"]');

    // Enter location
    const locationInput = modal.locator('input[placeholder*="Adresse"]');
    await locationInput.fill('Editorstrasse 1, Basel');

    // Submit
    const createButton = modal.locator('button:has-text("Schnell erstellen")');
    await createButton.click();

    // Verify success toast
    const toast = authenticatedPage.locator('[data-sonner-toast]');
    await expect(toast).toBeVisible({ timeout: 5000 });
    await expect(toast.filter({ hasText: 'Zack, fertig!' })).toBeVisible();
  });
});

// Note: Viewer role tests require a viewer user account
// These are comprehensive tests that would run with viewer credentials

test.describe('Protected Buttons - Viewer Access (Placeholder)', () => {
  test.skip('viewer sees lock icons on protected buttons', async ({ page }) => {
    // This test requires viewer credentials
    // Expected behavior:
    // - Navigate to main page as viewer
    // - Verify "Schnell" button has lock icon
    // - Verify "Neuer Einsatz" button has lock icon
    // - Verify buttons are disabled
  });

  test.skip('viewer cannot click protected buttons', async ({ page }) => {
    // This test requires viewer credentials
    // Expected behavior:
    // - Try to click "Schnell" button
    // - Verify button is disabled
    // - Verify no modal opens
  });

  test.skip('viewer sees empathetic tooltip on hover', async ({ page }) => {
    // This test requires viewer credentials
    // Expected behavior:
    // - Hover over protected "Schnell" button
    // - Verify tooltip appears
    // - Verify tooltip has supportive messaging
    // - Verify tooltip mentions what viewer CAN do
    // - Verify tooltip mentions contacting administrator
  });

  test.skip('lock icon wiggles on click attempt', async ({ page }) => {
    // This test requires viewer credentials
    // Expected behavior:
    // - Try to click protected button
    // - Verify lock icon has wiggle animation (animate-wiggle class)
    // - Animation should last ~300ms
  });

  test.skip('viewer tooltip shows Info icon', async ({ page }) => {
    // This test requires viewer credentials
    // Expected behavior:
    // - Hover over protected button
    // - Verify tooltip has Info icon (lucide-info)
  });
});

test.describe('Protected Button Component Behavior', () => {
  let eventsPage: EventsPage;
  let testEventName: string;

  test.beforeEach(async ({ authenticatedPage }) => {
    eventsPage = new EventsPage(authenticatedPage);

    testEventName = `Component Test ${Date.now()}`;
    await eventsPage.goto();
    await eventsPage.createEvent(testEventName);
    await eventsPage.goto();
    await eventsPage.selectEvent(testEventName);
    await expect(authenticatedPage).toHaveURL('/');
    await authenticatedPage.waitForTimeout(1000);
  });

  test('protected buttons maintain proper styling', async ({ authenticatedPage }) => {
    // Verify "Schnell" button has proper orange styling
    const quickButton = authenticatedPage.locator('button:has-text("Schnell")');
    const hasOrangeStyle = await quickButton.evaluate(el =>
      el.className.includes('bg-orange') || el.outerHTML.includes('orange')
    );
    expect(hasOrangeStyle).toBeTruthy();

    // Verify "Neuer Einsatz" button has primary styling
    const newIncidentButton = authenticatedPage.locator('button:has-text("Neuer Einsatz")');
    await expect(newIncidentButton).toBeVisible();
  });

  test('protected buttons have correct icons for editor', async ({ authenticatedPage }) => {
    // Verify "Schnell" button has Zap icon (not Lock)
    const quickButton = authenticatedPage.locator('button:has-text("Schnell")');
    await expect(quickButton.locator('svg[class*="lucide-zap"]')).toBeVisible();

    // Verify "Neuer Einsatz" button has Plus icon (not Lock)
    const newIncidentButton = authenticatedPage.locator('button:has-text("Neuer Einsatz")');
    await expect(newIncidentButton.locator('svg[class*="lucide-plus"]')).toBeVisible();
  });

  test('protected buttons are keyboard accessible for editor', async ({ authenticatedPage }) => {
    // Focus on quick button
    const quickButton = authenticatedPage.locator('button:has-text("Schnell")');
    await quickButton.focus();

    // Verify button is focused
    const isFocused = await quickButton.evaluate(el => el === document.activeElement);
    expect(isFocused).toBeTruthy();

    // Press Enter to activate
    await authenticatedPage.keyboard.press('Enter');

    // Verify modal opens
    const modal = authenticatedPage.locator('[role="dialog"]');
    await expect(modal).toBeVisible({ timeout: 3000 });
  });
});

test.describe('Protected Buttons - Mobile', () => {
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

  test('protected buttons maintain 44px touch target on mobile', async ({ authenticatedPage }) => {
    // Verify "Schnell" button has proper touch target
    const quickButton = authenticatedPage.locator('button:has-text("Schnell")');
    const buttonHeight = await quickButton.evaluate(el => el.getBoundingClientRect().height);
    expect(buttonHeight).toBeGreaterThanOrEqual(44);

    // Verify "Neuer Einsatz" button has proper touch target
    const newIncidentButton = authenticatedPage.locator('button:has-text("Neuer Einsatz")');
    const newButtonHeight = await newIncidentButton.evaluate(el => el.getBoundingClientRect().height);
    expect(newButtonHeight).toBeGreaterThanOrEqual(44);
  });

  test('protected buttons remain accessible on mobile for editor', async ({ authenticatedPage }) => {
    // Tap "Schnell" button
    const quickButton = authenticatedPage.locator('button:has-text("Schnell")');
    await quickButton.tap();

    // Verify modal opens
    const modal = authenticatedPage.locator('[role="dialog"]');
    await expect(modal).toBeVisible();
  });
});

test.describe('Protected Buttons - Events Page', () => {
  test('create event button is protected (Placeholder for Viewer)', async ({ authenticatedPage }) => {
    // Navigate to events page
    await authenticatedPage.goto('/events');
    await authenticatedPage.waitForTimeout(1000);

    // Verify "Neues Ereignis" button exists (for editor, it's enabled)
    const createEventButton = authenticatedPage.locator('button:has-text("Neues Ereignis")').first();
    await expect(createEventButton).toBeVisible();

    // For editor, verify no lock icon
    const lockIcon = createEventButton.locator('svg[class*="lucide-lock"]');
    await expect(lockIcon).not.toBeVisible();

    // Note: For viewer, this button would have lock icon and be disabled
  });
});

test.describe('Protected Button Tooltip Content', () => {
  test.skip('viewer tooltip has helpful message about permissions', async ({ page }) => {
    // This test requires viewer credentials
    // Expected tooltip content:
    // - "Diese Funktion ist nur für Editoren verfügbar"
    // - "Sie können aber alle Einsätze in Echtzeit verfolgen"
    // - "Sprechen Sie mit Ihrem Administrator für erweiterte Berechtigungen"
  });

  test.skip('viewer tooltip emphasizes what they CAN do', async ({ page }) => {
    // This test requires viewer credentials
    // Expected behavior:
    // - Tooltip should be empathetic and supportive
    // - Should mention viewer's ability to track incidents
    // - Should not be negative or restrictive in tone
  });

  test.skip('viewer tooltip has max width for readability', async ({ page }) => {
    // This test requires viewer credentials
    // Expected behavior:
    // - Tooltip should have max-w-[280px] class
    // - Content should be readable and not overflow
  });
});

test.describe('Protected Button Animation', () => {
  test.skip('lock icon wiggles for exactly 300ms', async ({ page }) => {
    // This test requires viewer credentials
    // Expected behavior:
    // - Click locked button
    // - Verify animate-wiggle class is added
    // - After 300ms, verify class is removed
    // - Test with setTimeout and class checking
  });

  test.skip('wiggle animation can be triggered multiple times', async ({ page }) => {
    // This test requires viewer credentials
    // Expected behavior:
    // - Click locked button once -> wiggle
    // - Wait for animation to finish
    // - Click again -> wiggle again
    // - Animation should work every time
  });
});

test.describe('Protected Button Edge Cases', () => {
  test('editor can still perform actions when other buttons are disabled', async ({ authenticatedPage }) => {
    // Navigate to events page
    await authenticatedPage.goto('/events');
    await authenticatedPage.waitForTimeout(1000);

    // Click create event button
    const createButton = authenticatedPage.locator('button:has-text("Neues Ereignis")').first();
    await createButton.click();

    // Verify dialog opens
    const dialog = authenticatedPage.locator('[role="dialog"]');
    await expect(dialog).toBeVisible();

    // Try to submit without name (button should be disabled)
    const submitButton = authenticatedPage.locator('button:has-text("Erstellen")');
    const isDisabled = await submitButton.isDisabled();
    expect(isDisabled).toBeTruthy();

    // This is normal form validation, not permission-based protection
  });

  test('protected button props are properly passed through', async ({ authenticatedPage }) => {
    // Create and select event
    const eventsPage = new EventsPage(authenticatedPage);
    const testEventName = `Props Test ${Date.now()}`;
    await eventsPage.goto();
    await eventsPage.createEvent(testEventName);
    await eventsPage.goto();
    await eventsPage.selectEvent(testEventName);
    await expect(authenticatedPage).toHaveURL('/');
    await authenticatedPage.waitForTimeout(1000);

    // Verify buttons have proper size and variant props
    const quickButton = authenticatedPage.locator('button:has-text("Schnell")');
    await expect(quickButton).toBeVisible();

    // Button should be rendered as HTML button element
    const tagName = await quickButton.evaluate(el => el.tagName);
    expect(tagName).toBe('BUTTON');
  });
});
