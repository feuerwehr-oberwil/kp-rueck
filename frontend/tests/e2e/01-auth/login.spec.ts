import { test, expect } from '../../fixtures/auth.fixture';
import { DEV_ADMIN_PASSWORD, DEV_ADMIN_USERNAME } from '../../constants';

/**
 * Authentication Tests
 * Tests login functionality and session management
 */

// Same defaults as the auth fixture. Hardcoding 'admin' here meant the spec
// authenticated as a different user than the fixture did, so it failed
// wherever the seeded account differs (CI, and any dev DB seeded via
// TEST_USERNAME).
const USERNAME = DEV_ADMIN_USERNAME;
const PASSWORD = DEV_ADMIN_PASSWORD;

test.describe('Authentication', () => {
  test('should display login page with all required elements', { tag: '@smoke' }, async ({ page, loginPage }) => {
    await loginPage.goto();

    // With Microsoft auth configured the credential form starts collapsed
    // behind a "Mit Passwort anmelden" toggle, so it has to be revealed
    // before the inputs exist. No-op when the toggle isn't rendered.
    await loginPage.revealPasswordForm();

    // Verify page elements
    await expect(loginPage.usernameInput).toBeVisible();
    await expect(loginPage.passwordInput).toBeVisible();
    await expect(loginPage.loginButton).toBeVisible();

    // Verify branding
    await expect(page.locator('text=KP Rück')).toBeVisible();
  });

  test('should login with valid credentials', { tag: '@smoke' }, async ({ page, loginPage }) => {
    await loginPage.goto();

    // Login (reveals the password form itself)
    await loginPage.login(USERNAME, PASSWORD);

    await loginPage.waitForLoginSuccess();

    // Assert we left /login rather than pinning a landing route: the app
    // sends you to /events or to /, depending on the selectedEvent cookie.
    // That is exactly the contract waitForLoginSuccess documents.
    await expect(page).not.toHaveURL(/\/login/);
  });

  test('should show error for invalid credentials', async ({ page, loginPage }) => {
    await loginPage.goto();

    // Try to login with invalid credentials
    await loginPage.login('invalid', 'wrong');

    // Wait a bit for the error to appear
    await page.waitForTimeout(1000);

    // Verify error message is shown. Repeated runs can trip the per-username
    // failure throttle, which surfaces in the same place as a wrong password.
    await expect(loginPage.errorMessage).toBeVisible();
  });

  test('should disable login button while loading', async ({ page, loginPage }) => {
    await loginPage.goto();
    await loginPage.revealPasswordForm();

    // Fill in credentials
    await loginPage.usernameInput.fill(USERNAME);
    await loginPage.passwordInput.fill(PASSWORD);

    // Click login
    await loginPage.loginButton.click();

    // Check if button shows loading state (might be too fast to catch)
    const loadingText = page.locator('text=Wird angemeldet …');
    // This might not always be visible due to speed, so we just check for it
    const isVisible = await loadingText.isVisible().catch(() => false);

    // Either it was visible or the login completed and we left /login.
    expect(isVisible || !page.url().includes('/login')).toBeTruthy();
  });

  test('should require both username and password', async ({ page, loginPage }) => {
    await loginPage.goto();
    // The submit button only exists inside the credential form.
    await loginPage.revealPasswordForm();

    // Try to submit without filling
    await loginPage.loginButton.click();

    // HTML5 validation should prevent submission
    const isStillOnLogin = page.url().includes('/login');
    expect(isStillOnLogin).toBeTruthy();
  });
});

test.describe('Authenticated Session', () => {
  test('should persist session after page reload', async ({ authenticatedPage }) => {
    // authenticatedPage only injects the session cookies — it does not
    // navigate, so the page starts blank and must be pointed somewhere
    // before any URL can be asserted.
    await authenticatedPage.goto('/events');
    await expect(authenticatedPage).toHaveURL(/\/events/);

    // Reload the page
    await authenticatedPage.reload();

    // Should still be authenticated, i.e. not bounced to the login page
    await expect(authenticatedPage).toHaveURL(/\/events/);
  });

  test('should access protected routes when authenticated', async ({ authenticatedPage }) => {
    // Try to navigate to map view (protected route)
    await authenticatedPage.goto('/map');

    // Should successfully access the page
    await expect(authenticatedPage).toHaveURL(/\/map/);
  });
});
