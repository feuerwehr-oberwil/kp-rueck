import { Page, expect } from '@playwright/test';

/**
 * Base Page Object Model class
 * Provides common functionality for all page objects
 */
export class BasePage {
  constructor(public readonly page: Page) {}

  /**
   * Navigate to a specific path
   */
  async goto(path: string = '') {
    await this.page.goto(`${process.env.BASE_URL || 'http://localhost:3000'}${path}`);
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

  /**
   * Click element and wait for optional selector
   */
  async clickAndWait(selector: string, waitFor?: string) {
    await this.page.click(selector);
    if (waitFor) {
      await this.page.waitForSelector(waitFor);
    }
  }

  /**
   * Assert element is visible
   */
  async expectVisible(selector: string) {
    await expect(this.page.locator(selector)).toBeVisible();
  }

  /**
   * Assert element contains text
   */
  async expectText(selector: string, text: string) {
    await expect(this.page.locator(selector)).toContainText(text);
  }

  /**
   * Wait for notification to appear
   */
  async waitForNotification(message: string) {
    await expect(
      this.page.locator('[role="alert"]', { hasText: message })
    ).toBeVisible({ timeout: 5000 });
  }

  /**
   * Wait for toast notification
   */
  async waitForToast(message?: string) {
    const toast = this.page.locator('[data-sonner-toast]');
    if (message) {
      await expect(toast.filter({ hasText: message })).toBeVisible({ timeout: 5000 });
    } else {
      await expect(toast).toBeVisible({ timeout: 5000 });
    }
  }
}
