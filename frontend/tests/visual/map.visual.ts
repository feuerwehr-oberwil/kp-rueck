import { test, expect, settle, variableParts, DESKTOP } from './visual.fixture';

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
