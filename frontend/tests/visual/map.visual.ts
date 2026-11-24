import { test, expect, settle, variableParts, DESKTOP, PHONE } from './visual.fixture';

/**
 * The Lagekarte on a flat basemap: every tile request is answered with one even colour
 * (visual.fixture.ts), so what is compared is ours — markers, labels, the Auftrag route,
 * the legend, the list beside it — and never OpenStreetMap's latest edit.
 */
test.use({ viewport: DESKTOP });

test('map', async ({ page }) => {
  await page.goto('/map');
  await settle(
    page,
    page.getByText('Mühlemattstrasse 12').first(),
    // a marker label: drawn only once MapLibre has loaded and placed the markers
    page.locator('.maplibregl-marker').getByText('Bättwilerstrasse (Waldrand)', { exact: true }),
  );
  await expect(page).toHaveScreenshot('map-desktop.png', { mask: variableParts(page) });
});

// The phone Lagekarte (owner pick 3A): the map full screen, its floating chrome, and the peek of
// the featured fire – reached through the search, as an operator without the list finds it.
test('map, phone', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto('/map');
  await settle(page, page.getByTestId('map-count-chip'), page.locator('.maplibregl-marker').first());
  await page.getByPlaceholder('Einsatz suchen …').fill('Langegasse 28');
  await page.getByRole('list', { name: 'Suchtreffer' }).getByRole('button', { name: /Langegasse 28/ }).first().click();
  await settle(page, page.getByTestId('map-incident-peek').getByRole('heading', { name: /Langegasse 28/ }));
  await expect(page).toHaveScreenshot('map-phone.png', { mask: variableParts(page) });
});
