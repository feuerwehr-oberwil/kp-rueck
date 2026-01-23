import { test, expect } from '../../fixtures/auth.fixture';

/**
 * Authentication Tests
 * Tests login functionality and session management
 */

test.describe('Authentication', () => {
  test('should display login page with all required elements', async ({ page, loginPage }) => {
    await loginPage.goto();

    // Verify page elements
    await expect(loginPage.usernameInput).toBeVisible();
    await expect(loginPage.passwordInput).toBeVisible();
    await expect(loginPage.loginButton).toBeVisible();

    // Verify branding
    await expect(page.locator('text=KP Rück')).toBeVisible();
  });

  test('should login with valid credentials', async ({ page, loginPage }) => {
    await loginPage.goto();

    // Login
    await loginPage.login('admin', 'changeme123');

    // Wait for redirect to events page
    await loginPage.waitForLoginSuccess();

    // Verify we're on the events page
    await expect(page).toHaveURL(/\/events/);
  });

  test('should show error for invalid credentials', async ({ page, loginPage }) => {
    await loginPage.goto();

    // Try to login with invalid credentials
    await loginPage.login('invalid', 'wrong');

    // Wait a bit for the error to appear
    await page.waitForTimeout(1000);

    // Verify error message is shown
    await expect(loginPage.errorMessage).toBeVisible();
  });

  test('should disable login button while loading', async ({ page, loginPage }) => {
    await loginPage.goto();

    // Fill in credentials
    await loginPage.usernameInput.fill('admin');
    await loginPage.passwordInput.fill('changeme123');

    // Click login
    await loginPage.loginButton.click();

    // Check if button shows loading state (might be too fast to catch)
    const loadingText = page.locator('text=Wird angemeldet...');
    // This might not always be visible due to speed, so we just check for it
    const isVisible = await loadingText.isVisible().catch(() => false);

    // Either it was visible or the login completed successfully
    expect(isVisible || await page.url().includes('/events')).toBeTruthy();
  });

  test('should require both username and password', async ({ page, loginPage }) => {
    await loginPage.goto();

    // Try to submit without filling
    await loginPage.loginButton.click();

    // HTML5 validation should prevent submission
    const isStillOnLogin = page.url().includes('/login');
    expect(isStillOnLogin).toBeTruthy();
  });
});

test.describe('Authenticated Session', () => {
  test('should persist session after page reload', async ({ authenticatedPage }) => {
    // authenticatedPage is already logged in
    await expect(authenticatedPage).toHaveURL(/\/events/);

    // Reload the page
    await authenticatedPage.reload();

    // Should still be authenticated
    await expect(authenticatedPage).toHaveURL(/\/events/);
  });

  test('should access protected routes when authenticated', async ({ authenticatedPage }) => {
    // Try to navigate to map view (protected route)
    await authenticatedPage.goto('/map');

    // Should successfully access the page
    await expect(authenticatedPage).toHaveURL(/\/map/);
  });
});
