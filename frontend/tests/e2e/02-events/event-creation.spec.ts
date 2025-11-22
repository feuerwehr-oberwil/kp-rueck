import { test, expect } from '../../fixtures/auth.fixture';
import { EventsPage } from '../../pages/events.page';

/**
 * Event Creation & Management Tests
 * Tests event CRUD operations and filtering
 */

test.describe('Event Creation', () => {
  let eventsPage: EventsPage;

  test.beforeEach(async ({ authenticatedPage }) => {
    eventsPage = new EventsPage(authenticatedPage);
    await eventsPage.goto();
  });

  test('should display events page with header and new event button', async ({ authenticatedPage }) => {
    // Verify page title
    await expect(authenticatedPage.locator('h1:has-text("Ereignisse")')).toBeVisible();

    // Verify new event button (desktop or mobile)
    const hasDesktopButton = await eventsPage.newEventButton.isVisible().catch(() => false);
    const hasMobileButton = await eventsPage.newEventButtonMobile.isVisible().catch(() => false);

    expect(hasDesktopButton || hasMobileButton).toBeTruthy();
  });

  test('should open create event dialog when clicking new event button', async () => {
    await eventsPage.clickNewEvent();

    // Verify dialog is visible
    await expect(eventsPage.createDialog).toBeVisible();
    await expect(eventsPage.eventNameInput).toBeVisible();
    await expect(eventsPage.trainingModeSwitch).toBeVisible();
    await expect(eventsPage.autoAttachDiveraSwitch).toBeVisible();
  });

  test('should create new event with custom name', async () => {
    const eventName = `Test Event ${Date.now()}`;

    await eventsPage.clickNewEvent();
    await eventsPage.fillEventName(eventName);
    await eventsPage.submitEvent();

    // Dialog should close and event should be created
    await expect(eventsPage.createDialog).not.toBeVisible();

    // Navigate back to events page to verify
    await eventsPage.goto();
    await expect(eventsPage.eventCard(eventName)).toBeVisible();
  });

  test('should create event with training flag enabled', async () => {
    const eventName = `Training Event ${Date.now()}`;

    await eventsPage.clickNewEvent();
    await eventsPage.fillEventName(eventName);
    await eventsPage.toggleTrainingMode(true);
    await eventsPage.submitEvent();

    // Navigate back to events page
    await eventsPage.goto();

    // Verify event exists and has training flag icon
    await expect(eventsPage.eventCard(eventName)).toBeVisible();
    const hasTrainingFlag = await eventsPage.hasTrainingFlag(eventName);
    expect(hasTrainingFlag).toBeTruthy();
  });

  test('should create event with Divera auto-attach enabled', async () => {
    const eventName = `Divera Event ${Date.now()}`;

    await eventsPage.clickNewEvent();
    await eventsPage.fillEventName(eventName);
    await eventsPage.toggleAutoAttachDivera(true);
    await eventsPage.submitEvent();

    // Navigate back to events page
    await eventsPage.goto();
    await expect(eventsPage.eventCard(eventName)).toBeVisible();
  });

  test('should not allow creating event with empty name', async () => {
    await eventsPage.clickNewEvent();

    // Try to submit without name
    const isDisabled = await eventsPage.createButton.isDisabled();
    expect(isDisabled).toBeTruthy();
  });

  test('should cancel event creation', async () => {
    await eventsPage.clickNewEvent();
    await eventsPage.fillEventName('This should not be created');
    await eventsPage.cancelEventCreation();

    // Dialog should close
    await expect(eventsPage.createDialog).not.toBeVisible();

    // Event should not be created
    const exists = await eventsPage.isEventVisible('This should not be created');
    expect(exists).toBeFalsy();
  });

  test('should training mode and Divera auto-attach be mutually exclusive', async () => {
    await eventsPage.clickNewEvent();

    // Enable training mode
    await eventsPage.toggleTrainingMode(true);
    let trainingChecked = await eventsPage.trainingModeSwitch.isChecked();
    let diveraChecked = await eventsPage.autoAttachDiveraSwitch.isChecked();
    expect(trainingChecked).toBeTruthy();
    expect(diveraChecked).toBeFalsy();

    // Enable Divera auto-attach (should disable training mode)
    await eventsPage.toggleAutoAttachDivera(true);
    trainingChecked = await eventsPage.trainingModeSwitch.isChecked();
    diveraChecked = await eventsPage.autoAttachDiveraSwitch.isChecked();
    expect(trainingChecked).toBeFalsy();
    expect(diveraChecked).toBeTruthy();
  });
});

test.describe('Event Management', () => {
  let eventsPage: EventsPage;
  let testEventName: string;

  test.beforeEach(async ({ authenticatedPage }) => {
    eventsPage = new EventsPage(authenticatedPage);
    await eventsPage.goto();

    // Create a test event
    testEventName = `Management Test ${Date.now()}`;
    await eventsPage.createEvent(testEventName);
    await eventsPage.goto(); // Go back to events page
  });

  test('should display event card with correct information', async () => {
    const card = eventsPage.eventCard(testEventName);

    await expect(card).toBeVisible();
    await expect(card.locator('text=/Einsätze:/i')).toBeVisible();
    await expect(card.locator('text=/Erstellt:/i')).toBeVisible();
    await expect(card.locator('text=/Letzte Aktivität:/i')).toBeVisible();
  });

  test('should select an event', async () => {
    await eventsPage.selectEvent(testEventName);

    // Should redirect to main page
    await expect(eventsPage.page).toHaveURL('/');
  });

  test('should archive an event', async () => {
    await eventsPage.archiveEvent(testEventName);

    // Wait for archive operation
    await eventsPage.page.waitForTimeout(1000);

    // Event should no longer be in active events
    // It should appear in archived events section
    const archivedSection = eventsPage.page.locator('text=Archivierte Ereignisse');
    await expect(archivedSection).toBeVisible();
  });

  test('should unarchive an event', async () => {
    // First archive it
    await eventsPage.archiveEvent(testEventName);
    await eventsPage.page.waitForTimeout(1000);

    // Then unarchive it
    await eventsPage.unarchiveEvent(testEventName);
    await eventsPage.page.waitForTimeout(1000);

    // Should be back in active events
    const activeSection = eventsPage.page.locator('text=Aktive Ereignisse');
    await expect(activeSection).toBeVisible();
  });

  test('should delete an archived event', async () => {
    // First archive it
    await eventsPage.archiveEvent(testEventName);
    await eventsPage.page.waitForTimeout(1000);

    // Then delete it
    await eventsPage.deleteEvent(testEventName);
    await eventsPage.page.waitForTimeout(1000);

    // Event should no longer exist
    const exists = await eventsPage.isEventVisible(testEventName);
    expect(exists).toBeFalsy();
  });
});

test.describe('Event Search & Filtering', () => {
  let eventsPage: EventsPage;
  let searchableEventName: string;

  test.beforeEach(async ({ authenticatedPage }) => {
    eventsPage = new EventsPage(authenticatedPage);
    await eventsPage.goto();

    // Create a uniquely named event
    searchableEventName = `Searchable XYZ ${Date.now()}`;
    await eventsPage.createEvent(searchableEventName);
    await eventsPage.goto();
  });

  test('should filter events by search query', async () => {
    // Search for specific part of the name
    await eventsPage.searchEvents('XYZ');

    // Should find the event
    await expect(eventsPage.eventCard(searchableEventName)).toBeVisible();
  });

  test('should show no results for non-matching search', async () => {
    await eventsPage.searchEvents('NonExistentEvent12345');

    // Should show no events
    await expect(eventsPage.page.locator('text=Keine Ereignisse gefunden')).toBeVisible();
  });

  test('should clear search and show all events', async () => {
    // First search for something
    await eventsPage.searchEvents('NonExistentEvent12345');

    // Clear search
    await eventsPage.clearSearch();

    // Should show events again
    const exists = await eventsPage.isEventVisible(searchableEventName);
    expect(exists).toBeTruthy();
  });
});
