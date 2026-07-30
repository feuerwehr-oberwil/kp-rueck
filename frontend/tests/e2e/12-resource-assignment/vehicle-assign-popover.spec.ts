import { test, expect } from '../../fixtures/auth.fixture';
import { EventsPage } from '../../pages/events.page';
import { MainPage } from '../../pages/main.page';

/**
 * Regressions for the vehicle "Hinzufügen" popover in the incident detail modal.
 *
 * The popover rendered the whole fleet as one unbounded column: Radix grew the
 * popper to fit its content and then shifted it to fit the viewport, so at
 * 1280x720 with the seeded fleet it opened at y = -348 — the first six entries
 * ("Zu Fuss" among them) sat above the top edge with nothing to scroll.
 *
 * That is a geometry fact, so it is asserted against real bounding boxes rather
 * than against classnames.
 */

const VEHICLE_ADD_BUTTON = 'button[title="Fahrzeug zuweisen"]';

test.describe('Vehicle assignment popover', () => {
  let eventsPage: EventsPage;
  let mainPage: MainPage;

  test.beforeEach(async ({ authenticatedPage }) => {
    eventsPage = new EventsPage(authenticatedPage);
    mainPage = new MainPage(authenticatedPage);

    const eventName = `Vehicle Popover ${Date.now()}`;
    await eventsPage.goto();
    await eventsPage.createEvent(eventName);
    await eventsPage.goto();
    await eventsPage.selectEvent(eventName);
    await expect(authenticatedPage).toHaveURL('/');

    await mainPage.createIncident(`Fahrzeugstrasse ${Date.now()}`);

    // Open the incident's detail modal — the popover lives in its resource column.
    const card = authenticatedPage.locator('[data-testid="incident-card"]').first();
    await card.waitFor({ state: 'visible' });
    await card.click();
    await expect(detailModal(authenticatedPage)).toBeVisible();
    await expect(authenticatedPage.locator(VEHICLE_ADD_BUTTON)).toBeVisible();
  });

  test('the fleet list stays inside the viewport and every vehicle is reachable', async ({
    authenticatedPage: page,
  }) => {
    await page.locator(VEHICLE_ADD_BUTTON).click();
    const popover = page.locator('[data-slot="popover-content"][data-state="open"]');
    await expect(popover).toBeVisible();

    const viewport = page.viewportSize();
    expect(viewport).not.toBeNull();
    const box = await popover.boundingBox();
    expect(box).not.toBeNull();

    // The whole popper must sit on screen. Before the fix it was 779px tall and
    // opened at y = -348, which is what put rows out of reach.
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height);

    // And every entry must be reachable — by scrolling inside the popover when
    // the fleet is longer than the list is tall.
    const rows = popover.locator('button');
    const count = await rows.count();
    expect(count).toBeGreaterThan(1);

    for (let i = 0; i < count; i++) {
      const row = rows.nth(i);
      await row.scrollIntoViewIfNeeded();
      const rowBox = await row.boundingBox();
      expect(rowBox, `row ${i} has no box`).not.toBeNull();
      expect(rowBox!.y, `row ${i} is above the viewport`).toBeGreaterThanOrEqual(0);
      expect(
        rowBox!.y + rowBox!.height,
        `row ${i} is below the viewport`,
      ).toBeLessThanOrEqual(viewport!.height);
    }
  });
});

function detailModal(page: import('@playwright/test').Page) {
  return page
    .locator('[role="dialog"][data-slot="dialog-content"][data-state="open"]')
    .filter({ hasText: 'Zugewiesene Ressourcen' });
}
