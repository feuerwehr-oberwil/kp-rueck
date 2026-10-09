import { test, expect, settle, variableParts, DESKTOP } from './visual.fixture';

/**
 * Settings, light: the form vocabulary (rows, inputs, selects, the section nav) in the
 * scheme the board shots do not already cover twice.
 */
test.use({ viewport: DESKTOP, colorScheme: 'light' });

test('settings', async ({ page }) => {
  await page.goto('/settings');
  await settle(page, page.getByText('Stationslogo').first());
  // The values arrive after the rows: wait for the stored settings, not just the labels.
  await expect
    .poll(() => page.locator('input').evaluateAll((els) => els.some((el) => (el as HTMLInputElement).value === 'Ackermann Reto')))
    .toBe(true);
  await expect(page).toHaveScreenshot('settings.png', { mask: variableParts(page) });
});
