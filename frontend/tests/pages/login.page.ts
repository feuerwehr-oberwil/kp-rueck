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

  constructor(page: Page) {
    super(page);
    this.usernameInput = page.locator('input#username');
    this.passwordInput = page.locator('input#password');
    this.loginButton = page.locator('button[type="submit"]');
    this.errorMessage = page.locator('.text-destructive');
    this.loadingText = page.locator('text=Wird angemeldet...');
  }

  /**
   * Navigate to login page
   */
  async goto() {
    await super.goto('/login');
  }

  /**
   * Perform login with credentials
   */
  async login(username: string, password: string) {
    await this.usernameInput.fill(username);
    await this.passwordInput.fill(password);
    await this.loginButton.click();
  }

  /**
   * Wait for login to complete
   */
  async waitForLoginSuccess() {
    // Wait for redirect to events page
    await this.page.waitForURL(/\/events/, { timeout: 10000 });
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
