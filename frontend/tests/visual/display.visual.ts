import type { Page } from '@playwright/test';
import { test, expect, settle, variableParts } from './visual.fixture';

/**
 * The wall (`/display/*`): read from across a room, on a 1080p screen, never touched.
 */
test.use({ viewport: { width: 1920, height: 1080 } });

/**
 * The back arrow and the search fade after 10 s without input (components/display/
 * use-wall-idle.ts). A load can take longer than that, so wake them right before the
 * shot – at an empty spot of the top bar, so nothing hovers – and the baseline never
 * depends on how long the load took.
 */
async function wakeChrome(page: Page) {
  await page.mouse.move(960, 20);
}

test('display board', async ({ page }) => {
  await page.goto('/display/board');
  await settle(page, page.getByText('Mühlemattstrasse 12').first(), page.getByText('Bättwilerstrasse 7').first());
  await wakeChrome(page);
  await expect(page).toHaveScreenshot('display-board.png', { mask: variableParts(page) });
});

test('display status', async ({ page }) => {
  await page.goto('/display/status');
  // One fact from each of the four columns: they load from four different requests.
  await settle(
    page,
    page.getByText('Therwilerstrasse 25').first(),
    page.getByText('Kaufmann Nico').first(),
    page.getByText('Zimmermann Fabian').first(),
    page.getByText('Tauchpumpe S-Gr.').first(),
  );
  await wakeChrome(page);
  await expect(page).toHaveScreenshot('display-status.png', { mask: variableParts(page) });
});
