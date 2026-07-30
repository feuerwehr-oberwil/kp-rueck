import { test as base, expect, Page } from '@playwright/test';
import type { Cookie } from '@playwright/test';
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

type AuthWorkerFixtures = {
  /**
   * Auth cookies captured once per worker by performing exactly one
   * UI login. Subsequent tests inject them into a fresh context
   * instead of hitting POST /api/auth/login again — the dev backend
   * rate-limits aggressive login bursts.
   */
  authCookies: Cookie[];
};

/**
 * Extended test with authentication fixtures
 */
export const test = base.extend<AuthFixtures, AuthWorkerFixtures>({
  authCookies: [
    async ({ browser }, use) => {
      const context = await browser.newContext();
      const page = await context.newPage();
      const loginPage = new LoginPage(page);
      await loginPage.goto();

      const username = process.env.TEST_USERNAME || 'admin';
      const password = process.env.TEST_PASSWORD || 'changeme123';

      await loginPage.login(username, password);
      await loginPage.waitForLoginSuccess();

      const cookies = await context.cookies();
      await context.close();
      await use(cookies);
    },
    { scope: 'worker' },
  ],

  /**
   * Provides a page that is already authenticated by replaying the
   * worker-scoped session cookies — no per-test login.
   */
  authenticatedPage: async ({ page, authCookies }, use) => {
    await page.context().addCookies(authCookies);
    // eslint-disable-next-line react-hooks/rules-of-hooks
    await use(page);
  },

  /**
   * Login page object
   */
  loginPage: async ({ page }, use) => {
    const loginPage = new LoginPage(page);
    // eslint-disable-next-line react-hooks/rules-of-hooks
    await use(loginPage);
  },

  /**
   * Dashboard page object
   */
  dashboardPage: async ({ page }, use) => {
    const dashboardPage = new DashboardPage(page);
    // eslint-disable-next-line react-hooks/rules-of-hooks
    await use(dashboardPage);
  },
});

export { expect };
