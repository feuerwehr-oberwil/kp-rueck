import { test, expect, settle, variableParts, DESKTOP, PHONE } from './visual.fixture';

/**
 * The board — the screen the KP lives on. Desktop in both schemes (dark is the default
 * at a command post, light is what a daylight room switches to), the detail panel open on
 * the one featured fire, and the phone list (a phone is for looking, not for running it).
 */

test.describe('desktop', () => {
  test.use({ viewport: DESKTOP });

  for (const scheme of ['dark', 'light'] as const) {
    test(`board, ${scheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto('/');
      // The first card of the first column and the last of the last one: the whole
      // snapshot has arrived, not just its first column.
      await settle(page, page.getByText('Mühlemattstrasse 12').first(), page.getByText('Bättwilerstrasse 7').first());
      await expect(page).toHaveScreenshot(`board-desktop-${scheme}.png`, { mask: variableParts(page) });
    });
  }

  test('board, detail panel open', async ({ page }) => {
    await page.goto('/');
    const card = page.getByTestId('incident-card').filter({ hasText: 'Langegasse 28' }).first();
    await settle(page, card);
    await card.click();
    // Off the card: the panel scrolls the board, and whether the pointer still hovers the
    // card afterwards depends on when Chromium next re-checks hover.
    await page.mouse.move(0, 0);
    // The detail's own heading + the field that loads last (the Meldung text area).
    await settle(page, page.getByRole('tab', { name: 'Übersicht' }), page.getByText('Löschangriff über die Fassade läuft.').last());
    await expect(page).toHaveScreenshot('board-desktop-detail.png', { mask: variableParts(page) });
  });
});

test('board, phone', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto('/');
  await settle(page, page.getByText('Langegasse 28').first(), page.getByRole('button', { name: 'Neuer Einsatz' }));
  await expect(page).toHaveScreenshot('board-phone.png', { mask: variableParts(page) });
});
