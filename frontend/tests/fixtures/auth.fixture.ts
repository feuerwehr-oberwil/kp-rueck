import { test as base, expect, Page } from '@playwright/test';
import { LoginPage } from '../pages/login.page';
import { DashboardPage } from '../pages/dashboard.page';

/**
 * Test fixtures for authentication
 * Provides authenticated page context for tests
 */

type AuthFixtures = {
  authenticatedPage: Page;
  loginPage: LoginPage;
  dashboardPage: DashboardPage;
};

/**
 * Extended test with authentication fixtures
 */
export const test = base.extend<AuthFixtures>({
  /**
   * Provides a page that is already authenticated
   */
  authenticatedPage: async ({ page }, use) => {
    const loginPage = new LoginPage(page);

    // Navigate to login
    await loginPage.goto();

    // Login with test credentials
    const username = process.env.TEST_USERNAME || 'admin';
    const password = process.env.TEST_PASSWORD || 'changeme123';

    await loginPage.login(username, password);

    // Wait for successful login (redirect to events)
    await loginPage.waitForLoginSuccess();

    // Use the authenticated page
    await use(page);
  },

  /**
   * Login page object
   */
  loginPage: async ({ page }, use) => {
    const loginPage = new LoginPage(page);
    await use(loginPage);
  },

  /**
   * Dashboard page object
   */
  dashboardPage: async ({ page }, use) => {
    const dashboardPage = new DashboardPage(page);
    await use(dashboardPage);
  },
});

export { expect };
