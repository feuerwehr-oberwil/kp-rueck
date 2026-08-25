import { Page, Locator } from '@playwright/test';
import { BasePage } from './base.page';

/**
 * Login Page Object Model
 * Handles login page interactions and authentication
 */
export class LoginPage extends BasePage {
  readonly usernameInput: Locator;
  readonly passwordInput: Locator;
  readonly loginButton: Locator;
  readonly errorMessage: Locator;
  readonly loadingText: Locator;
  readonly passwordLoginToggle: Locator;

  constructor(page: Page) {
    super(page);
    this.usernameInput = page.locator('input#username');
    this.passwordInput = page.locator('input#password');
    this.loginButton = page.locator('button[type="submit"]');
    this.errorMessage = page.locator('.text-destructive');
    this.loadingText = page.locator('text=Wird angemeldet …');
    // The password form is collapsed behind "Mit Passwort anmelden" when
    // Microsoft auth is enabled. Clicking the toggle expands it.
    this.passwordLoginToggle = page.locator('button', { hasText: /Mit Passwort anmelden/i });
  }

  /**
   * Navigate to login page
   */
  async goto() {
    await super.goto('/login');
  }

  /**
   * Reveal the username/password form (no-op if it's already visible).
   */
  async revealPasswordForm() {
    if (await this.usernameInput.isVisible().catch(() => false)) return;
    if (await this.passwordLoginToggle.isVisible().catch(() => false)) {
      await this.passwordLoginToggle.click();
    }
    await this.usernameInput.waitFor({ state: 'visible', timeout: 5000 });
  }

  /**
   * Perform login with credentials
   */
  async login(username: string, password: string) {
    await this.revealPasswordForm();
    await this.usernameInput.fill(username);
    await this.passwordInput.fill(password);
    await this.loginButton.click();
  }

  /**
   * Wait for login to complete. Accepts any post-auth landing — the app
   * sends you to /events when you have an event picker, or to / if you
   * don't, depending on the current selectedEvent cookie.
   */
  async waitForLoginSuccess() {
    await this.page.waitForURL(
      (url) => !url.pathname.startsWith('/login'),
      { timeout: 10000 },
    );
  }

  /**
   * Assert login error is displayed
   */
  async expectLoginError(message?: string) {
    await this.errorMessage.waitFor({ state: 'visible' });
    if (message) {
      await this.expectText('.text-destructive', message);
    }
  }

  /**
   * Check if login button is disabled
   */
  async isLoginButtonDisabled(): Promise<boolean> {
    return await this.loginButton.isDisabled();
  }
}
