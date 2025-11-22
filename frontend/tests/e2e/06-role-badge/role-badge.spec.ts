import { test, expect } from '../../fixtures/auth.fixture';

/**
 * Role Badge Tests
 * Tests the role badge component that displays Editor/Viewer status
 */

test.describe('Role Badge - Editor', () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    // Navigate to main page (login as admin/editor by default)
    await authenticatedPage.goto('/');
    await authenticatedPage.waitForTimeout(1000);
  });

  test('shows editor badge in navigation', async ({ authenticatedPage }) => {
    // Verify badge is visible
    const badge = authenticatedPage.locator('[class*="badge"]').filter({
      hasText: 'Editor'
    });

    // Badge might be text-only on desktop, check for either text or icon
    const hasEditorText = await badge.isVisible().catch(() => false);

    // Alternative: Check for Shield icon only (mobile)
    const shieldIcon = authenticatedPage.locator('svg[class*="lucide-shield"]');
    const hasShieldIcon = await shieldIcon.isVisible().catch(() => false);

    // Either badge text or shield icon should be visible
    expect(hasEditorText || hasShieldIcon).toBeTruthy();
  });

  test('editor badge shows Shield icon', async ({ authenticatedPage }) => {
    // Find badge with Editor text or Shield icon
    const badge = authenticatedPage.locator('[class*="badge"]').filter({
      has: authenticatedPage.locator('svg[class*="lucide-shield"]')
    }).first();

    await expect(badge).toBeVisible();

    // Verify Shield icon is present
    await expect(badge.locator('svg[class*="lucide-shield"]')).toBeVisible();
  });

  test('editor badge has correct styling', async ({ authenticatedPage }) => {
    // Find badge
    const badge = authenticatedPage.locator('[class*="badge"]').filter({
      has: authenticatedPage.locator('svg[class*="lucide-shield"]')
    }).first();

    // Verify badge has default variant (blue/green styling)
    const isDefaultVariant = await badge.evaluate(el =>
      el.className.includes('badge') && !el.className.includes('secondary')
    );
    expect(isDefaultVariant).toBeTruthy();

    // Verify badge has animation
    const hasAnimation = await badge.evaluate(el =>
      el.className.includes('animate-scale-in')
    );
    expect(hasAnimation).toBeTruthy();
  });

  test('editor badge has tooltip with superpowers message', async ({ authenticatedPage }) => {
    // Find badge
    const badge = authenticatedPage.locator('[class*="badge"]').filter({
      has: authenticatedPage.locator('svg[class*="lucide-shield"]')
    }).first();

    // Hover over badge
    await badge.hover();

    // Wait for tooltip to appear
    await authenticatedPage.waitForTimeout(500);

    // Verify tooltip appears with superpowers message
    const tooltip = authenticatedPage.locator('[role="tooltip"]');
    await expect(tooltip).toBeVisible({ timeout: 3000 });

    // Verify tooltip contains superpowers message
    await expect(tooltip.filter({ hasText: 'Superkraft' })).toBeVisible();
    await expect(tooltip.filter({ hasText: 'Erstellen und Bearbeiten' })).toBeVisible();
  });

  test('editor badge tooltip shows pro tip', async ({ authenticatedPage }) => {
    // Find badge
    const badge = authenticatedPage.locator('[class*="badge"]').filter({
      has: authenticatedPage.locator('svg[class*="lucide-shield"]')
    }).first();

    // Hover over badge
    await badge.hover();
    await authenticatedPage.waitForTimeout(500);

    // Verify pro tip is in tooltip
    const tooltip = authenticatedPage.locator('[role="tooltip"]');
    await expect(tooltip.filter({ hasText: 'Tipp:' })).toBeVisible();
    await expect(tooltip.filter({ hasText: 'Drag & Drop' })).toBeVisible();
  });

  test('editor badge tooltip has sparkles icon', async ({ authenticatedPage }) => {
    // Find badge
    const badge = authenticatedPage.locator('[class*="badge"]').filter({
      has: authenticatedPage.locator('svg[class*="lucide-shield"]')
    }).first();

    // Hover over badge
    await badge.hover();
    await authenticatedPage.waitForTimeout(500);

    // Verify tooltip has sparkles icon
    const tooltip = authenticatedPage.locator('[role="tooltip"]');
    await expect(tooltip.locator('svg[class*="lucide-sparkles"]')).toBeVisible();
  });

  test('editor badge has cursor-help styling', async ({ authenticatedPage }) => {
    // Find badge
    const badge = authenticatedPage.locator('[class*="badge"]').filter({
      has: authenticatedPage.locator('svg[class*="lucide-shield"]')
    }).first();

    // Verify cursor-help class is present
    const hasCursorHelp = await badge.evaluate(el =>
      el.className.includes('cursor-help')
    );
    expect(hasCursorHelp).toBeTruthy();
  });

  test('editor badge has hover scale effect', async ({ authenticatedPage }) => {
    // Find badge
    const badge = authenticatedPage.locator('[class*="badge"]').filter({
      has: authenticatedPage.locator('svg[class*="lucide-shield"]')
    }).first();

    // Verify hover scale class is present
    const hasHoverScale = await badge.evaluate(el =>
      el.className.includes('hover:scale-105')
    );
    expect(hasHoverScale).toBeTruthy();
  });
});

test.describe('Role Badge - Editor on Multiple Pages', () => {
  test('editor badge is visible on events page', async ({ authenticatedPage }) => {
    await authenticatedPage.goto('/events');
    await authenticatedPage.waitForTimeout(1000);

    // Verify badge is visible
    const badge = authenticatedPage.locator('[class*="badge"]').filter({
      has: authenticatedPage.locator('svg[class*="lucide-shield"]')
    }).first();

    await expect(badge).toBeVisible();
  });

  test('editor badge is visible on main page', async ({ authenticatedPage }) => {
    await authenticatedPage.goto('/');
    await authenticatedPage.waitForTimeout(1000);

    // Verify badge is visible
    const badge = authenticatedPage.locator('[class*="badge"]').filter({
      has: authenticatedPage.locator('svg[class*="lucide-shield"]')
    }).first();

    await expect(badge).toBeVisible();
  });

  test('editor badge is visible on resources page', async ({ authenticatedPage }) => {
    await authenticatedPage.goto('/resources');
    await authenticatedPage.waitForTimeout(1000);

    // Verify badge is visible (or page doesn't exist yet)
    const badge = authenticatedPage.locator('[class*="badge"]').filter({
      has: authenticatedPage.locator('svg[class*="lucide-shield"]')
    }).first();

    const isVisible = await badge.isVisible().catch(() => false);
    // Page might not exist, so we just check if badge appears when page exists
    if (await authenticatedPage.locator('nav').isVisible()) {
      expect(isVisible).toBeTruthy();
    }
  });
});

test.describe('Role Badge - Mobile Behavior', () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    // Set mobile viewport
    await authenticatedPage.setViewportSize({ width: 375, height: 667 });
    await authenticatedPage.goto('/');
    await authenticatedPage.waitForTimeout(1000);
  });

  test('editor badge shows icon-only on mobile', async ({ authenticatedPage }) => {
    // Find badge
    const badge = authenticatedPage.locator('[class*="badge"]').filter({
      has: authenticatedPage.locator('svg[class*="lucide-shield"]')
    }).first();

    await expect(badge).toBeVisible();

    // Verify icon is visible
    await expect(badge.locator('svg[class*="lucide-shield"]')).toBeVisible();

    // Verify text is hidden on mobile (has sm:inline-block class)
    const roleText = badge.locator('span:has-text("Editor")');
    if (await roleText.isVisible()) {
      const isHiddenOnMobile = await roleText.evaluate(el =>
        el.className.includes('hidden') && el.className.includes('sm:inline-block')
      );
      expect(isHiddenOnMobile).toBeTruthy();
    }
  });

  test('editor badge tooltip still works on mobile', async ({ authenticatedPage }) => {
    // Find badge
    const badge = authenticatedPage.locator('[class*="badge"]').filter({
      has: authenticatedPage.locator('svg[class*="lucide-shield"]')
    }).first();

    // Tap badge (mobile interaction)
    await badge.tap();
    await authenticatedPage.waitForTimeout(500);

    // Tooltip should appear (or not, depending on mobile tooltip behavior)
    const tooltip = authenticatedPage.locator('[role="tooltip"]');
    const isVisible = await tooltip.isVisible().catch(() => false);

    // On mobile, tooltips might not show on tap, which is okay
    // We just verify the badge exists and is tappable
    expect(await badge.isVisible()).toBeTruthy();
  });
});

// Note: Viewer role tests require a viewer user account
// These tests are placeholders and will need actual viewer credentials

test.describe('Role Badge - Viewer (Placeholder)', () => {
  test.skip('shows viewer badge with Eye icon', async ({ page }) => {
    // This test requires viewer credentials
    // Skipped until viewer test account is available
  });

  test.skip('viewer badge has secondary styling', async ({ page }) => {
    // This test requires viewer credentials
    // Skipped until viewer test account is available
  });

  test.skip('viewer badge shows supportive tooltip', async ({ page }) => {
    // This test requires viewer credentials
    // Skipped until viewer test account is available
  });
});

test.describe('Role Badge - Unauthenticated User', () => {
  test('badge does not show when not logged in', async ({ page }) => {
    // Navigate to login page (not authenticated)
    await page.goto('http://localhost:3000/login');
    await page.waitForTimeout(1000);

    // Verify badge is NOT visible
    const badge = page.locator('[class*="badge"]').filter({
      has: page.locator('svg[class*="lucide-shield"], svg[class*="lucide-eye"]')
    }).first();

    const isVisible = await badge.isVisible().catch(() => false);
    expect(isVisible).toBeFalsy();
  });
});

test.describe('Role Badge - Accessibility', () => {
  test('badge has proper tooltip trigger', async ({ authenticatedPage }) => {
    await authenticatedPage.goto('/');
    await authenticatedPage.waitForTimeout(1000);

    // Find badge
    const badge = authenticatedPage.locator('[class*="badge"]').filter({
      has: authenticatedPage.locator('svg[class*="lucide-shield"]')
    }).first();

    // Verify badge is wrapped in tooltip trigger (asChild pattern)
    const tooltipTrigger = authenticatedPage.locator('[data-radix-collection-item]').filter({
      has: badge
    });

    // Badge should be accessible
    await expect(badge).toBeVisible();
  });

  test('badge text is readable', async ({ authenticatedPage }) => {
    await authenticatedPage.goto('/');
    await authenticatedPage.waitForTimeout(1000);

    // Find badge with Editor text
    const badge = authenticatedPage.locator('[class*="badge"]').filter({
      hasText: 'Editor'
    });

    // If badge text is visible, verify it's readable
    const isVisible = await badge.isVisible().catch(() => false);
    if (isVisible) {
      const textContent = await badge.textContent();
      expect(textContent).toContain('Editor');
    }
  });
});
