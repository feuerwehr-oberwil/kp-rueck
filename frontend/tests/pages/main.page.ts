import { Page, Locator } from '@playwright/test';
import { BasePage } from './base.page';

/**
 * Main Page Object Model
 * Handles interactions with the main dashboard page including Sprint 1 components:
 * - Event Selection Empty State
 * - Quick Incident Creation Modal
 * - Role Badge
 * - Protected Buttons
 */
export class MainPage extends BasePage {
  // Empty State Elements
  readonly emptyStateContainer: Locator;
  readonly emptyStateHeading: Locator;
  readonly createEventButton: Locator;
  readonly viewEventsButton: Locator;
  readonly quickStartGuide: Locator;

  // Quick Incident Creation Elements
  readonly quickAddButton: Locator;
  readonly newIncidentButton: Locator;
  readonly incidentModal: Locator;
  readonly quickModeToggle: Locator;
  readonly fullModeToggle: Locator;

  // Role Badge Elements
  readonly roleBadge: Locator;
  readonly roleBadgeTooltip: Locator;

  // Modal Elements
  readonly modalLocationInput: Locator;
  readonly modalNotesInput: Locator;
  readonly modalCreateButton: Locator;
  readonly modalCancelButton: Locator;

  constructor(page: Page) {
    super(page);

    // Empty State Elements
    this.emptyStateContainer = page.locator('text=Noch kein Ereignis ausgewählt?').locator('..');
    this.emptyStateHeading = page.locator('h1:has-text("Noch kein Ereignis ausgewählt?")');
    this.createEventButton = page.locator('button:has-text("Neues Ereignis erstellen")');
    this.viewEventsButton = page.locator('button:has-text("Ereignisse anzeigen")');
    this.quickStartGuide = page.locator('text=Erste Schritte').locator('..');

    // Quick Incident Creation Elements
    this.quickAddButton = page.locator('button:has-text("Schnell")');
    this.newIncidentButton = page.locator('button:has-text("Neuer Einsatz")');
    this.incidentModal = page.locator('[role="dialog"]');
    this.quickModeToggle = page.locator('button:has-text("Alle Details")');
    this.fullModeToggle = page.locator('button:has-text("Schnellmodus")');

    // Role Badge Elements
    this.roleBadge = page.locator('[class*="badge"]').filter({
      has: page.locator('svg[class*="lucide-shield"], svg[class*="lucide-eye"]')
    }).first();
    this.roleBadgeTooltip = page.locator('[role="tooltip"]');

    // Modal Elements
    this.modalLocationInput = page.locator('[role="dialog"] input[placeholder*="Adresse"]');
    this.modalNotesInput = page.locator('[role="dialog"] textarea[placeholder*="Notizen"]');
    this.modalCreateButton = page.locator('[role="dialog"] button:has-text("erstellen")');
    this.modalCancelButton = page.locator('[role="dialog"] button:has-text("Abbrechen")');
  }

  /**
   * Navigate to main page
   */
  async goto() {
    await super.goto('/');
  }

  /**
   * Check if empty state is visible
   */
  async isEmptyStateVisible(): Promise<boolean> {
    return await this.emptyStateHeading.isVisible().catch(() => false);
  }

  /**
   * Click "Create New Event" button from empty state
   */
  async clickCreateEventFromEmptyState() {
    await this.createEventButton.click();
    await this.page.waitForURL(/\/events\?action=create/);
  }

  /**
   * Click "View Events" button from empty state
   */
  async clickViewEventsFromEmptyState() {
    await this.viewEventsButton.click();
    await this.page.waitForURL(/\/events/);
  }

  /**
   * Get quick start step by index (1-4)
   */
  getQuickStartStep(index: number): Locator {
    return this.page.locator(`text=${index}.`).locator('..');
  }

  /**
   * Open quick incident creation modal
   */
  async openQuickIncidentModal() {
    await this.quickAddButton.click();
    await this.incidentModal.waitFor({ state: 'visible', timeout: 5000 });
  }

  /**
   * Open full incident creation modal
   */
  async openFullIncidentModal() {
    await this.newIncidentButton.click();
    await this.incidentModal.waitFor({ state: 'visible', timeout: 5000 });
  }

  /**
   * Check if modal is in quick mode
   */
  async isModalInQuickMode(): Promise<boolean> {
    const title = this.incidentModal.locator('h2:has-text("Schnellerfassung")');
    return await title.isVisible().catch(() => false);
  }

  /**
   * Check if modal is in full mode
   */
  async isModalInFullMode(): Promise<boolean> {
    const title = this.incidentModal.locator('h2:has-text("Neuer Einsatz")');
    return await title.isVisible().catch(() => false);
  }

  /**
   * Toggle from quick mode to full mode
   */
  async toggleToFullMode() {
    await this.quickModeToggle.click();
    await this.page.waitForTimeout(300);
  }

  /**
   * Toggle from full mode to quick mode
   */
  async toggleToQuickMode() {
    await this.fullModeToggle.click();
    await this.page.waitForTimeout(300);
  }

  /**
   * Create incident in quick mode
   */
  async createQuickIncident(location: string) {
    await this.openQuickIncidentModal();
    await this.modalLocationInput.fill(location);
    await this.modalCreateButton.click();
    await this.waitForToast();
  }

  /**
   * Create incident in full mode
   */
  async createFullIncident(location: string, notes?: string) {
    await this.openFullIncidentModal();
    await this.modalLocationInput.fill(location);
    if (notes) {
      await this.modalNotesInput.fill(notes);
    }
    await this.modalCreateButton.click();
    await this.waitForToast();
  }

  /**
   * Hover over role badge to show tooltip
   */
  async hoverRoleBadge() {
    await this.roleBadge.hover();
    await this.page.waitForTimeout(500);
  }

  /**
   * Get role badge text (Editor/Viewer)
   */
  async getRoleBadgeText(): Promise<string | null> {
    return await this.roleBadge.textContent();
  }

  /**
   * Check if role badge has shield icon (Editor)
   */
  async hasShieldIcon(): Promise<boolean> {
    const icon = this.roleBadge.locator('svg[class*="lucide-shield"]');
    return await icon.isVisible().catch(() => false);
  }

  /**
   * Check if role badge has eye icon (Viewer)
   */
  async hasEyeIcon(): Promise<boolean> {
    const icon = this.roleBadge.locator('svg[class*="lucide-eye"]');
    return await icon.isVisible().catch(() => false);
  }

  /**
   * Check if button has lock icon (viewer restriction)
   */
  async hasLockIcon(button: Locator): Promise<boolean> {
    const lockIcon = button.locator('svg[class*="lucide-lock"]');
    return await lockIcon.isVisible().catch(() => false);
  }

  /**
   * Get incidents on the page
   */
  allIncidents(): Locator {
    return this.page.locator('[data-testid="incident-card"]');
  }

  /**
   * Find incident by location
   */
  findIncidentByLocation(location: string): Locator {
    return this.page.locator('[data-testid="incident-card"]', { hasText: location });
  }

  /**
   * Wait for incident to appear
   */
  async waitForIncident(location: string) {
    await this.findIncidentByLocation(location).waitFor({ state: 'visible', timeout: 5000 });
  }

  /**
   * Sprint 2 Helper Methods
   */

  /**
   * Click bottom navigation tab (mobile only)
   */
  async clickBottomTab(tab: 'kanban' | 'map' | 'combined' | 'events' | 'more') {
    const bottomNav = this.page.locator('nav.fixed.bottom-0');

    if (tab === 'more') {
      // Click More button to open sheet
      const moreButton = bottomNav.locator('button[aria-label="Mehr Optionen"]');
      await moreButton.click();
    } else {
      // Click navigation link
      const tabMap = {
        kanban: '/',
        map: '/map',
        combined: '/combined',
        events: '/events',
      };
      const tabLink = bottomNav.locator(`a[href="${tabMap[tab]}"]`);
      await tabLink.click();
    }

    await this.page.waitForTimeout(500);
  }

  /**
   * Open resource assignment dialog from incident card
   */
  async openResourceAssignmentDialog(
    resourceType: 'crew' | 'vehicles' | 'materials',
    incidentLocation?: string
  ) {
    // Find the incident card
    const incidentCard = incidentLocation
      ? this.findIncidentByLocation(incidentLocation)
      : this.page.locator('[data-testid="incident-card"]').first();

    // Map resource type to German text
    const resourceMap = {
      crew: 'Crew',
      vehicles: 'Fahrzeuge',
      materials: 'Material',
    };

    // Find the resource section and click plus button
    const resourceSection = incidentCard.locator(`text=${resourceMap[resourceType]}`).locator('..');
    const plusButton = resourceSection.locator('button').filter({
      has: this.page.locator('svg[class*="lucide-plus"]')
    });

    await plusButton.click();

    // Wait for dialog to open
    const dialogTitles = {
      crew: 'Mannschaft zuweisen',
      vehicles: 'Fahrzeuge zuweisen',
      materials: 'Material zuweisen',
    };

    const dialog = this.page.locator('[role="dialog"]', { hasText: dialogTitles[resourceType] });
    await dialog.waitFor({ state: 'visible', timeout: 3000 });
  }

  /**
   * Assign resource via dialog
   */
  async assignResourceViaDialog(resourceName: string) {
    const dialog = this.page.locator('[role="dialog"]');

    // Find resource by name and click
    const resourceButton = dialog.locator('button', { hasText: resourceName }).first();
    await resourceButton.click();

    // Wait for success toast
    await this.waitForToast('zugewiesen');
  }

  /**
   * Search for resource in assignment dialog
   */
  async searchResourceInDialog(searchTerm: string) {
    const dialog = this.page.locator('[role="dialog"]');
    const searchInput = dialog.locator('input[placeholder*="Suchen"]');
    await searchInput.fill(searchTerm);
    await this.page.waitForTimeout(300);
  }

  /**
   * Open command palette with ? key
   */
  async openCommandPalette() {
    await this.page.keyboard.press('Shift+/'); // ? is Shift+/

    // Wait for command palette to open
    const modal = this.page.locator('[role="dialog"]', { hasText: 'Befehl suchen' });
    await modal.waitFor({ state: 'visible', timeout: 3000 });
  }

  /**
   * Close command palette
   */
  async closeCommandPalette() {
    await this.page.keyboard.press('Escape');

    const modal = this.page.locator('[role="dialog"]', { hasText: 'Befehl suchen' });
    await modal.waitFor({ state: 'hidden', timeout: 2000 });
  }

  /**
   * Click check-in widget
   */
  async clickCheckInWidget() {
    const checkInWidget = this.page.locator('button').filter({
      has: this.page.locator('svg[class*="lucide-user-check"]')
    });

    await checkInWidget.click();

    // Wait for navigation to check-in page
    await this.page.waitForURL(/\/check-in/);
  }

  /**
   * Get check-in count from widget
   */
  async getCheckInCount(): Promise<{ checkedIn: number; total: number } | null> {
    const checkInWidget = this.page.locator('button').filter({
      has: this.page.locator('svg[class*="lucide-user-check"]')
    });

    const text = await checkInWidget.textContent();
    if (!text) return null;

    const match = text.match(/(\d+)\/(\d+)/);
    if (!match) return null;

    return {
      checkedIn: parseInt(match[1]),
      total: parseInt(match[2])
    };
  }

  /**
   * Open More sheet in mobile navigation
   */
  async openMobileMoreSheet() {
    const bottomNav = this.page.locator('nav.fixed.bottom-0');
    const moreButton = bottomNav.locator('button[aria-label="Mehr Optionen"]');
    await moreButton.click();

    // Wait for sheet to open
    const sheet = this.page.locator('[role="dialog"]', { hasText: 'Weitere Funktionen' });
    await sheet.waitFor({ state: 'visible', timeout: 3000 });
  }

  /**
   * Navigate from More sheet
   */
  async navigateFromMoreSheet(item: string) {
    const sheet = this.page.locator('[role="dialog"]', { hasText: 'Weitere Funktionen' });
    const itemButton = sheet.locator('button', { hasText: item });
    await itemButton.click();

    await this.page.waitForTimeout(500);
  }

  /**
   * Get resource status badge count from incident card
   */
  async getResourceBadgeCount(
    incidentLocation: string,
    resourceType: 'crew' | 'vehicles' | 'materials'
  ): Promise<number | null> {
    const incidentCard = this.findIncidentByLocation(incidentLocation);

    const resourceMap = {
      crew: 'Crew',
      vehicles: 'Fahrzeuge',
      materials: 'Material',
    };

    const badge = incidentCard.locator(`text=${resourceMap[resourceType]} (`);
    const text = await badge.textContent();
    if (!text) return null;

    const match = text.match(/\((\d+)\)/);
    if (!match) return null;

    return parseInt(match[1]);
  }

  /**
   * Check if resource badge shows checkmark (assigned)
   */
  async resourceBadgeHasCheckmark(
    incidentLocation: string,
    resourceType: 'crew' | 'vehicles' | 'materials'
  ): Promise<boolean> {
    const incidentCard = this.findIncidentByLocation(incidentLocation);

    const resourceMap = {
      crew: 'Crew',
      vehicles: 'Fahrzeuge',
      materials: 'Material',
    };

    const resourceSection = incidentCard.locator(`text=${resourceMap[resourceType]}`).locator('..');
    const checkIcon = resourceSection.locator('svg[class*="lucide-check-circle"]');

    return await checkIcon.isVisible().catch(() => false);
  }

  /**
   * Sprint 3 Helper Methods - Drag-Drop Visual Affordances
   */

  /**
   * Check if incident card has drag cursor on hover
   */
  async incidentHasDragCursor(incidentLocation?: string): Promise<boolean> {
    const incidentCard = incidentLocation
      ? this.findIncidentByLocation(incidentLocation)
      : this.page.locator('[data-testid="incident-card"]').first();

    await incidentCard.hover();
    await this.page.waitForTimeout(300);

    const cursor = await incidentCard.evaluate(el => window.getComputedStyle(el).cursor);
    return ['pointer', 'move', 'grab', '-webkit-grab'].includes(cursor);
  }

  /**
   * Check if incident card has transition classes
   */
  async incidentHasTransitions(incidentLocation?: string): Promise<boolean> {
    const incidentCard = incidentLocation
      ? this.findIncidentByLocation(incidentLocation)
      : this.page.locator('[data-testid="incident-card"]').first();

    return await incidentCard.evaluate(el => el.className.includes('transition'));
  }

  /**
   * Get incident card opacity
   */
  async getIncidentOpacity(incidentLocation?: string): Promise<number> {
    const incidentCard = incidentLocation
      ? this.findIncidentByLocation(incidentLocation)
      : this.page.locator('[data-testid="incident-card"]').first();

    const opacity = await incidentCard.evaluate(el =>
      window.getComputedStyle(el).opacity
    );

    return parseFloat(opacity);
  }

  /**
   * Sprint 3 Helper Methods - Priority Visual Hierarchy
   */

  /**
   * Get incident priority indicator color
   */
  async getIncidentPriorityColor(incidentLocation?: string): Promise<'red' | 'yellow' | 'green' | 'unknown'> {
    const incidentCard = incidentLocation
      ? this.findIncidentByLocation(incidentLocation)
      : this.page.locator('[data-testid="incident-card"]').first();

    const priorityDot = incidentCard.locator('[class*="h-2.5"][class*="w-2.5"][class*="rounded-full"]').first();
    const classes = await priorityDot.getAttribute('class') || '';

    if (classes.includes('red')) return 'red';
    if (classes.includes('yellow')) return 'yellow';
    if (classes.includes('green')) return 'green';
    return 'unknown';
  }

  /**
   * Get incident priority icon type
   */
  async getIncidentPriorityIcon(incidentLocation?: string): Promise<'chevron-up' | 'minus' | 'chevron-down' | 'none'> {
    const incidentCard = incidentLocation
      ? this.findIncidentByLocation(incidentLocation)
      : this.page.locator('[data-testid="incident-card"]').first();

    const hasChevronUp = await incidentCard.locator('svg[class*="lucide-chevron-up"]').count() > 0;
    if (hasChevronUp) return 'chevron-up';

    const hasMinus = await incidentCard.locator('svg[class*="lucide-minus"]').count() > 0;
    if (hasMinus) return 'minus';

    const hasChevronDown = await incidentCard.locator('svg[class*="lucide-chevron-down"]').count() > 0;
    if (hasChevronDown) return 'chevron-down';

    return 'none';
  }

  /**
   * Check if incident has priority dot visible
   */
  async incidentHasPriorityDot(incidentLocation?: string): Promise<boolean> {
    const incidentCard = incidentLocation
      ? this.findIncidentByLocation(incidentLocation)
      : this.page.locator('[data-testid="incident-card"]').first();

    const priorityDot = incidentCard.locator('[class*="rounded-full"]').first();
    return await priorityDot.isVisible().catch(() => false);
  }

  /**
   * Check if incident has priority icon visible
   */
  async incidentHasPriorityIcon(incidentLocation?: string): Promise<boolean> {
    const incidentCard = incidentLocation
      ? this.findIncidentByLocation(incidentLocation)
      : this.page.locator('[data-testid="incident-card"]').first();

    const priorityIcon = incidentCard.locator('svg[class*="lucide-chevron-up"], svg[class*="lucide-minus"], svg[class*="lucide-chevron-down"]').first();
    return await priorityIcon.isVisible().catch(() => false);
  }

  /**
   * Check if priority icon has aria-label
   */
  async priorityIconHasAriaLabel(incidentLocation?: string): Promise<boolean> {
    const incidentCard = incidentLocation
      ? this.findIncidentByLocation(incidentLocation)
      : this.page.locator('[data-testid="incident-card"]').first();

    const priorityIcon = incidentCard.locator('[aria-label*="Priorität"]').first();

    if (await priorityIcon.count() === 0) return false;

    const ariaLabel = await priorityIcon.getAttribute('aria-label');
    return ariaLabel !== null && ariaLabel.includes('Priorität');
  }

  /**
   * Sprint 3 Helper Methods - Time-Based Indicators
   */

  /**
   * Get incident dispatch time
   */
  async getIncidentDispatchTime(incidentLocation?: string): Promise<string | null> {
    const incidentCard = incidentLocation
      ? this.findIncidentByLocation(incidentLocation)
      : this.page.locator('[data-testid="incident-card"]').first();

    const timeElement = incidentCard.locator('[class*="font-mono"]').filter({ hasText: /:/ }).first();

    if (await timeElement.count() === 0) return null;

    return await timeElement.textContent();
  }

  /**
   * Get incident elapsed time
   */
  async getIncidentElapsedTime(incidentLocation?: string): Promise<string | null> {
    const incidentCard = incidentLocation
      ? this.findIncidentByLocation(incidentLocation)
      : this.page.locator('[data-testid="incident-card"]').first();

    const elapsedTime = incidentCard.locator('[class*="font-mono"]').last();

    if (await elapsedTime.count() === 0) return null;

    return await elapsedTime.textContent();
  }

  /**
   * Check if incident has clock icon visible
   */
  async incidentHasClockIcon(incidentLocation?: string): Promise<boolean> {
    const incidentCard = incidentLocation
      ? this.findIncidentByLocation(incidentLocation)
      : this.page.locator('[data-testid="incident-card"]').first();

    const clockIcon = incidentCard.locator('svg[class*="lucide-clock"]').first();
    return await clockIcon.isVisible().catch(() => false);
  }

  /**
   * Check if time display uses monospace font
   */
  async timeDisplayUsesMonospace(incidentLocation?: string): Promise<boolean> {
    const incidentCard = incidentLocation
      ? this.findIncidentByLocation(incidentLocation)
      : this.page.locator('[data-testid="incident-card"]').first();

    const timeElement = incidentCard.locator('[class*="font-mono"]').first();

    if (await timeElement.count() === 0) return false;

    return await timeElement.evaluate(el => el.className.includes('font-mono'));
  }

  /**
   * Check if time elements use muted color
   */
  async timeElementsUseMutedColor(incidentLocation?: string): Promise<boolean> {
    const incidentCard = incidentLocation
      ? this.findIncidentByLocation(incidentLocation)
      : this.page.locator('[data-testid="incident-card"]').first();

    const timeElement = incidentCard.locator('[class*="font-mono"]').first();

    if (await timeElement.count() === 0) return false;

    return await timeElement.evaluate(el =>
      el.className.includes('text-muted-foreground')
    );
  }

  /**
   * Parse elapsed time to minutes
   */
  parseElapsedTimeToMinutes(elapsedTimeString: string): number {
    // Format: "5'" or "1h 23'"
    const hourMatch = elapsedTimeString.match(/(\d+)h/);
    const minuteMatch = elapsedTimeString.match(/(\d+)'/);

    const hours = hourMatch ? parseInt(hourMatch[1]) : 0;
    const minutes = minuteMatch ? parseInt(minuteMatch[1]) : 0;

    return hours * 60 + minutes;
  }

  /**
   * Sprint 3 Helper Methods - Combined Features
   */

  /**
   * Check if incident has all Sprint 3 features visible
   */
  async incidentHasAllSpring3Features(incidentLocation?: string): Promise<{
    hasDragAffordance: boolean;
    hasPriorityIndicators: boolean;
    hasTimeIndicators: boolean;
  }> {
    const incidentCard = incidentLocation
      ? this.findIncidentByLocation(incidentLocation)
      : this.page.locator('[data-testid="incident-card"]').first();

    const hasDragAffordance = await this.incidentHasTransitions(incidentLocation);
    const hasPriorityIndicators = await this.incidentHasPriorityDot(incidentLocation) &&
                                   await this.incidentHasPriorityIcon(incidentLocation);
    const hasTimeIndicators = await this.incidentHasClockIcon(incidentLocation);

    return {
      hasDragAffordance,
      hasPriorityIndicators,
      hasTimeIndicators,
    };
  }

  /**
   * Get incident card data-incident-id attribute
   */
  async getIncidentId(incidentLocation?: string): Promise<string | null> {
    const incidentCard = incidentLocation
      ? this.findIncidentByLocation(incidentLocation)
      : this.page.locator('[data-testid="incident-card"]').first();

    return await incidentCard.getAttribute('data-incident-id');
  }

  /**
   * Count total visible incidents
   */
  async countVisibleIncidents(): Promise<number> {
    return await this.allIncidents().count();
  }

  /**
   * Get all column headers
   */
  async getColumnHeaders(): Promise<string[]> {
    const headers = this.page.locator('h2').filter({
      hasText: /EINGEGANGEN|REKO|DISPONIERT|EINSATZ|BEENDET|ABGESCHLOSSEN/
    });

    const count = await headers.count();
    const headerTexts: string[] = [];

    for (let i = 0; i < count; i++) {
      const text = await headers.nth(i).textContent();
      if (text) headerTexts.push(text.trim());
    }

    return headerTexts;
  }
}
