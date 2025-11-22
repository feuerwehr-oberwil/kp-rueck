import { Page, Locator } from '@playwright/test';
import { BasePage } from './base.page';

/**
 * Dashboard Page Object Model
 * Handles the main combined view dashboard interactions
 */
export class DashboardPage extends BasePage {
  readonly newIncidentButton: Locator;
  readonly searchInput: Locator;
  readonly dateTimeDisplay: Locator;
  readonly personnelSidebar: Locator;
  readonly materialSidebar: Locator;

  constructor(page: Page) {
    super(page);
    this.newIncidentButton = page.locator('[data-testid="new-incident-btn"]');
    this.searchInput = page.locator('#search-input');
    this.dateTimeDisplay = page.locator('[data-testid="datetime-display"]');
    this.personnelSidebar = page.locator('aside').first();
    this.materialSidebar = page.locator('aside').last();
  }

  /**
   * Navigate to combined dashboard
   */
  async goto() {
    await super.goto('/combined');
  }

  /**
   * Create a new incident
   */
  async createNewIncident() {
    await this.newIncidentButton.click();
    await this.page.waitForSelector('[data-testid="incident-dialog"]', { timeout: 5000 });
  }

  /**
   * Get incident card by location
   */
  incidentCard(location: string): Locator {
    return this.page.locator('[data-testid="incident-card"]', {
      hasText: location
    });
  }

  /**
   * Get all incident cards
   */
  allIncidentCards(): Locator {
    return this.page.locator('[data-testid="incident-card"]');
  }

  /**
   * Get available personnel by name (green status indicator)
   */
  getAvailablePersonnel(name: string): Locator {
    return this.personnelSidebar
      .locator('[data-testid="personnel-card"]', { hasText: name })
      .filter({ has: this.page.locator('.bg-emerald-500') });
  }

  /**
   * Get any personnel by name
   */
  getPersonnel(name: string): Locator {
    return this.personnelSidebar.locator('[data-testid="personnel-card"]', {
      hasText: name
    });
  }

  /**
   * Get available material by name (green status indicator)
   */
  getAvailableMaterial(name: string): Locator {
    return this.materialSidebar
      .locator('[data-testid="material-card"]', { hasText: name })
      .filter({ has: this.page.locator('.bg-emerald-500') });
  }

  /**
   * Get any material by name
   */
  getMaterial(name: string): Locator {
    return this.materialSidebar.locator('[data-testid="material-card"]', {
      hasText: name
    });
  }

  /**
   * Get personnel card with status indicator
   */
  personnel(name: string) {
    const card = this.personnelSidebar.locator('[data-testid="personnel-card"]', {
      hasText: name
    });
    return {
      card,
      statusIndicator: card.locator('[data-testid="status-indicator"]')
    };
  }

  /**
   * Get vehicle card with status indicator
   */
  vehicle(name: string) {
    const card = this.page.locator('[data-testid="vehicle-card"]', {
      hasText: name
    });
    return {
      card,
      statusIndicator: card.locator('[data-testid="status-indicator"]')
    };
  }

  /**
   * Get material card with status indicator
   */
  material(name: string) {
    const card = this.materialSidebar.locator('[data-testid="material-card"]', {
      hasText: name
    });
    return {
      card,
      statusIndicator: card.locator('[data-testid="status-indicator"]')
    };
  }

  /**
   * Get kanban column by name
   */
  column(name: string): Locator {
    return this.page.locator('[data-testid="kanban-column"]', { hasText: name });
  }

  /**
   * Search for incidents
   */
  async search(query: string) {
    await this.searchInput.fill(query);
    await this.page.waitForTimeout(300); // Debounce delay
  }

  /**
   * Clear search
   */
  async clearSearch() {
    await this.searchInput.clear();
    await this.page.waitForTimeout(300);
  }
}
