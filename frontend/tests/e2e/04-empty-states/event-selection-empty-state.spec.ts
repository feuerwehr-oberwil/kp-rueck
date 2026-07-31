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
    await expect(authenticatedPage.locator('text=Kein Problem! Erstelle ein neues Ereignis')).toBeVisible();
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
    await expect(authenticatedPage.locator('text=Bereit für deinen ersten Einsatz')).toBeVisible();
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




  test('empty state is responsive on mobile', async ({ authenticatedPage }) => {
    // Set viewport to mobile size
    await authenticatedPage.setViewportSize({ width: 375, height: 667 });

    // Verify empty state is still visible
    const emptyState = authenticatedPage.locator('h1:has-text("Noch kein Ereignis ausgewählt?")');
    await expect(emptyState).toBeVisible();

    // The two actions stack instead of sitting side by side (`flex-col sm:flex-row`).
    // Asserted through the geometry the operator actually sees, not through the class
    // name: the old version filtered `locator('div')` down to "every ancestor that
    // contains both buttons", which is a strict-mode violation by construction — the
    // card, its content and the page wrapper all qualify.
    const createButton = authenticatedPage.getByRole('button', { name: 'Neues Ereignis erstellen' });
    const viewButton = authenticatedPage.getByRole('button', { name: 'Ereignisse anzeigen' });
    await expect(createButton).toBeVisible();
    await expect(viewButton).toBeVisible();

    const createBox = (await createButton.boundingBox())!;
    const viewBox = (await viewButton.boundingBox())!;
    expect(viewBox.y).toBeGreaterThanOrEqual(createBox.y + createBox.height);
    expect(viewBox.x).toBe(createBox.x);
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
    const createButton = authenticatedPage.getByRole('button', { name: 'Neues Ereignis', exact: true });
    await createButton.click();

    // Fill in event name
    const dialog = authenticatedPage.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.locator('input#event-name').fill(eventName);

    // Submit. Scoped to the dialog and exact: the page behind it also carries the
    // word "erstellen" ("Neues Ereignis erstellen" is the dialog's own title), so
    // an unscoped substring match resolves to more than one element.
    await dialog.getByRole('button', { name: 'Erstellen', exact: true }).click();

    // `handleCreateEvent` selects the new event and pushes to '/' by itself, so the
    // events list is already on its way out here. Reaching for an "Auswählen" button
    // at this moment is a race — it is what made this test fail on a second run,
    // clicking a card that detached mid-click.
    await expect(authenticatedPage).toHaveURL('/');
    await expect(authenticatedPage.getByRole('heading', { name: eventName }).first()).toBeVisible();
    await expect(
      authenticatedPage.getByRole('heading', { name: 'Noch kein Ereignis ausgewählt?' }),
    ).toHaveCount(0);

    // And picking that same event out of the list behaves the same way. Located by
    // name, not "the first Auswählen on the page" — the list is shared with every
    // other spec's events.
    await authenticatedPage.goto('/events');
    const eventCard = authenticatedPage
      .getByTestId('event-card')
      .filter({ hasText: eventName })
      .first();
    await expect(eventCard).toBeVisible();
    await eventCard.getByRole('button', { name: 'Auswählen' }).click();

    await expect(authenticatedPage).toHaveURL('/');
    await expect(authenticatedPage.getByRole('heading', { name: eventName }).first()).toBeVisible();
    await expect(
      authenticatedPage.getByRole('heading', { name: 'Noch kein Ereignis ausgewählt?' }),
    ).toHaveCount(0);
  });
});
