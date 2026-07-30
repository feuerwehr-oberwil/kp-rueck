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
  viewerPage: Page;
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

  /**
   * Same, for the seeded read-only `viewer` account (backend/app/seed.py).
   * Password comes from VIEWER_PASSWORD, which both CI workflows already
   * set; the dev seed default is `viewer`.
   */
  viewerCookies: Cookie[];
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
      // eslint-disable-next-line react-hooks/rules-of-hooks
      await use(cookies);
    },
    { scope: 'worker' },
  ],

  viewerCookies: [
    async ({ browser }, use) => {
      const context = await browser.newContext();
      const page = await context.newPage();
      const loginPage = new LoginPage(page);
      await loginPage.goto();

      await loginPage.login('viewer', process.env.VIEWER_PASSWORD || 'viewer');
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
   * A page logged in as the read-only `viewer` account.
   *
   * Deliberately its own browser context rather than the shared `page`:
   * the session lives in one `access_token` cookie, so an editor page and a
   * viewer page in the same context would overwrite each other. Separate
   * contexts let a single test hold both roles at once, which is what makes
   * "editor sees it / viewer does not" one assertion instead of two specs
   * that can drift apart (and a lone negative that passes trivially).
   */
  viewerPage: async ({ browser, viewerCookies }, use) => {
    const context = await browser.newContext();
    await context.addCookies(viewerCookies);
    const page = await context.newPage();
    // eslint-disable-next-line react-hooks/rules-of-hooks
    await use(page);
    await context.close();
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
