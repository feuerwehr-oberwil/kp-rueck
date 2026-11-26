import { Page } from '@playwright/test';

/**
 * Base Page Object Model class
 * Provides common functionality for all page objects
 */
export class BasePage {
  constructor(public readonly page: Page) {}

  /**
   * Navigate to a path on the app under test – relative to Playwright's `baseURL`
   * (playwright.config.ts: E2E_BASE_URL, default http://localhost:3000).
   */
  async goto(path: string = '') {
    await this.page.goto(path || '/');
    await this.waitForPageLoad();
  }

  /**
   * Wait for page to fully load
   * Note: We use 'load' instead of 'networkidle' because the app has continuous polling
   */
  async waitForPageLoad() {
    await this.page.waitForLoadState('load');
    // Give the page a moment to render
    await this.page.waitForTimeout(500);
  }

  /**
   * Take a screenshot
   */
  async screenshot(name: string) {
    await this.page.screenshot({
      path: `screenshots/${name}.png`,
      fullPage: true
    });
  }
}
