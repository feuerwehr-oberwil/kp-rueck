import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './base.page';

/**
 * Events Page Object Model
 * Handles interactions with the Events management page
 */
export class EventsPage extends BasePage {
  // Header elements
  readonly newEventButton: Locator;
  readonly newEventButtonMobile: Locator;
  readonly searchInput: Locator;

  // Dialog elements
  readonly createDialog: Locator;
  readonly eventNameInput: Locator;
  // Mode is a two-button toggle (Einsatz / Übung); auto-attach Divera is derived
  // from the mode (Einsatz = on, Übung = off), no independent control.
  readonly liveModeButton: Locator;
  readonly trainingModeButton: Locator;
  readonly createButton: Locator;
  readonly cancelButton: Locator;

  // Archive dialog elements
  readonly archiveDialog: Locator;
  readonly archiveConfirmButton: Locator;

  // Delete dialog elements
  readonly deleteDialog: Locator;
  readonly deleteConfirmButton: Locator;

  // Page sections
  readonly activeEventsSection: Locator;
  readonly archivedEventsSection: Locator;

  constructor(page: Page) {
    super(page);

    // Header elements
    this.newEventButton = page.locator('button:has-text("Neues Ereignis")').first();
    this.newEventButtonMobile = page.locator('button[class*="sm:hidden"]').filter({ has: page.locator('svg') }).first();
    this.searchInput = page.locator('input[placeholder*="Ereignisse durchsuchen"]');

    // Dialog elements
    this.createDialog = page.locator('div[role="dialog"]', { hasText: 'Neues Ereignis erstellen' });
    this.eventNameInput = page.locator('input#event-name');
    this.liveModeButton = this.createDialog.getByRole('button', { name: 'Einsatz' });
    this.trainingModeButton = this.createDialog.getByRole('button', { name: 'Übung' });
    // Scope to the dialog: "Erstellen" also substring-matches "Wiederherstellen".
    this.createButton = this.createDialog.getByRole('button', { name: /Erstellen/ });
    this.cancelButton = this.createDialog.getByRole('button', { name: 'Abbrechen' });

    // Archive dialog
    this.archiveDialog = page.locator('div[role="dialog"]', { hasText: 'Ereignis archivieren?' });
    this.archiveConfirmButton = this.archiveDialog.getByRole('button', { name: 'Archivieren' });

    // Delete dialog
    this.deleteDialog = page.locator('div[role="dialog"]', { hasText: 'Ereignis dauerhaft löschen?' });
    this.deleteConfirmButton = this.deleteDialog.getByRole('button', { name: 'Dauerhaft löschen' });

    // Page sections
    this.activeEventsSection = page.locator('text=Aktive Ereignisse').locator('..');
    this.archivedEventsSection = page.locator('text=Archivierte Ereignisse').locator('..');
  }

  /**
   * Navigate to events page
   */
  async goto() {
    await super.goto('/events');
  }

  /**
   * Click the new event button (handles both desktop and mobile)
   */
  async clickNewEvent() {
    // Try desktop button first, fallback to mobile
    const isDesktopVisible = await this.newEventButton.isVisible().catch(() => false);
    if (isDesktopVisible) {
      await this.newEventButton.click();
    } else {
      await this.newEventButtonMobile.click();
    }
    await this.waitForDialog();
  }

  /**
   * Wait for create dialog to be visible
   */
  async waitForDialog() {
    await expect(this.createDialog).toBeVisible({ timeout: 5000 });
  }

  /**
   * Fill in event name
   */
  async fillEventName(name: string) {
    await this.eventNameInput.fill(name);
  }

  /**
   * Select the event mode. Clicking a mode button sets it directly (and sets
   * auto-attach Divera accordingly: Einsatz = on, Übung = off).
   */
  async toggleTrainingMode(enabled: boolean) {
    await (enabled ? this.trainingModeButton : this.liveModeButton).click();
  }

  /**
   * Enable/disable auto-attach Divera. There is no independent control anymore —
   * it follows the event mode — so this maps to selecting the corresponding mode.
   */
  async toggleAutoAttachDivera(enabled: boolean) {
    await (enabled ? this.liveModeButton : this.trainingModeButton).click();
  }

  /**
   * Submit event creation
   */
  async submitEvent() {
    await this.createButton.click();
    await this.page.waitForTimeout(500); // Wait for dialog to close
  }

  /**
   * Cancel event creation
   */
  async cancelEventCreation() {
    await this.cancelButton.click();
  }

  /**
   * Create a new event with all options
   */
  async createEvent(name: string, training: boolean = false) {
    await this.clickNewEvent();
    await this.fillEventName(name);
    // Mode fully determines auto-attach, so a single toggle is enough.
    await this.toggleTrainingMode(training);
    await this.submitEvent();
  }

  /**
   * Get an event card by name
   * Finds the card by locating the event name and its associated "Auswählen" or "Wiederherstellen" button
   */
  eventCard(name: string): Locator {
    return this.page.getByTestId('event-card').filter({ hasText: name }).first();
  }

  /**
   * Select an event by clicking its "Auswählen" button
   */
  async selectEvent(name: string) {
    const card = this.eventCard(name);
    const selectButton = card.locator('button:has-text("Auswählen")');
    await selectButton.click();
  }

  /**
   * Archive an event
   */
  async archiveEvent(name: string) {
    const card = this.eventCard(name);
    const archiveButton = card.locator('button[title="Archivieren"]');
    await archiveButton.click();

    // Confirm in dialog
    await expect(this.archiveDialog).toBeVisible();
    await this.archiveConfirmButton.click();
  }

  /**
   * Unarchive an event
   */
  async unarchiveEvent(name: string) {
    const card = this.eventCard(name);
    const unarchiveButton = card.locator('button:has-text("Wiederherstellen")');
    await unarchiveButton.click();
    await this.page.waitForTimeout(500);
  }

  /**
   * Delete an event
   */
  async deleteEvent(name: string) {
    const card = this.eventCard(name);
    const deleteButton = card.locator('button[title="Löschen"]');
    await deleteButton.click();

    // Confirm in dialog
    await expect(this.deleteDialog).toBeVisible();
    await this.deleteConfirmButton.click();
  }

  /**
   * Search for events
   */
  async searchEvents(query: string) {
    await this.searchInput.fill(query);
    await this.page.waitForTimeout(300); // Debounce
  }

  /**
   * Clear search
   */
  async clearSearch() {
    await this.searchInput.clear();
    await this.page.waitForTimeout(300);
  }

  /**
   * Check if event card is visible
   */
  async isEventVisible(name: string): Promise<boolean> {
    return await this.eventCard(name).isVisible().catch(() => false);
  }

  /**
   * Check if event has training flag icon
   */
  async hasTrainingFlag(name: string): Promise<boolean> {
    const card = this.eventCard(name);
    const trainingIcon = card.locator('svg[class*="lucide-graduation-cap"]');
    return await trainingIcon.isVisible().catch(() => false);
  }

  /**
   * Get event incident count
   */
  async getEventIncidentCount(name: string): Promise<number> {
    const card = this.eventCard(name);
    const countText = await card.locator('text=/Einsätze: \\d+/').textContent();
    if (!countText) return 0;
    const match = countText.match(/Einsätze: (\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  }

  /**
   * Wait for event to appear after creation
   */
  async waitForEventCreation(name: string) {
    await expect(this.eventCard(name)).toBeVisible({ timeout: 10000 });
  }
}
