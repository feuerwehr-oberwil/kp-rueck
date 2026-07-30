import { test, expect } from '../../fixtures/auth.fixture';
import { EventsPage } from '../../pages/events.page';
import { MainPage } from '../../pages/main.page';

/**
 * Regressions for the vehicle "Hinzufügen" popover in the incident detail modal.
 *
 * Two defects lived here, both in a flow an operator touches constantly:
 *
 *  1. The popover rendered the whole fleet as one unbounded column: Radix grew
 *     the popper to fit its content and then shifted it to fit the viewport, so
 *     at 1280x720 with the seeded fleet it opened at y = -348 — the first six
 *     entries ("Zu Fuss" among them) sat above the top edge with nothing to
 *     scroll.
 *  2. The dismissed popover stayed mounted for the length of its exit animation
 *     and went on receiving pointer events, so the next click landed in an
 *     invisible panel instead of on what it was aimed at.
 *
 * Both are geometry/pointer facts, so they are asserted against real bounding
 * boxes and hit tests rather than against classnames.
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

  test('a dismissed popover leaves no invisible layer behind', async ({
    authenticatedPage: page,
  }) => {
    await page.locator(VEHICLE_ADD_BUTTON).click();
    await expect(page.locator('[data-slot="popover-content"][data-state="open"]')).toBeVisible();

    await page.keyboard.press('Escape');

    // Deliberately a non-retrying count(): the old behaviour kept the closed
    // content mounted (and hit-testable) for the length of its exit animation,
    // so an auto-retrying assertion would simply have waited the bug away.
    expect(await page.locator('[data-slot="popover-content"]').count()).toBe(0);
  });

  test('the click after dismissing the popover reaches what it was aimed at', async ({
    authenticatedPage: page,
  }) => {
    await page.locator(VEHICLE_ADD_BUTTON).click();
    const popover = page.locator('[data-slot="popover-content"][data-state="open"]');
    await expect(popover).toBeVisible();

    // Aim at the middle of the panel itself — whatever the popover happens to
    // overlap, that point is by definition where a dismissed-but-still-mounted
    // layer would intercept. Deriving it from the live box keeps the test honest
    // when the modal's layout moves.
    const popoverBox = await popover.boundingBox();
    expect(popoverBox).not.toBeNull();
    const targetX = popoverBox!.x + popoverBox!.width / 2;
    const targetY = popoverBox!.y + popoverBox!.height / 2;

    await page.keyboard.press('Escape');

    // Non-retrying hit test, taken straight after the dismissal: the old
    // behaviour left the closed panel mounted and hit-testable for the length of
    // its exit animation, so this reported the popover instead of the modal.
    const ownerAfterDismiss = await page.evaluate(
      ([x, y]) => {
        const el = document.elementFromPoint(x, y);
        if (!el) return 'nothing';
        if (el.closest('[data-slot="popover-content"]')) return 'popover';
        if (el.closest('[data-slot="dialog-content"]')) return 'modal';
        return 'other';
      },
      [targetX, targetY],
    );
    expect(ownerAfterDismiss).toBe('modal');

    // page.mouse.click, not locator.click: a locator click re-tries until the
    // element is hittable, which would paper over precisely the swallowed click
    // this test exists to catch. One click, one chance — and it must land in the
    // modal, not read as a stray click outside it.
    await page.mouse.click(targetX, targetY);
    await expect(detailModal(page)).toBeVisible();
  });

  test('an open popover never covers the modal\'s close button', async ({
    authenticatedPage: page,
  }) => {
    const modal = detailModal(page);
    const closeButton = modal.locator('[data-slot="dialog-close"]').first();
    await expect(closeButton).toBeVisible();

    await page.locator(VEHICLE_ADD_BUTTON).click();
    const popover = page.locator('[data-slot="popover-content"][data-state="open"]');
    await expect(popover).toBeVisible();

    // Geometry first — the panel and the X must not share a single pixel. The
    // popover is anchored in the modal's right-hand resource column, and when
    // the fleet list is taller than the space below its trigger Radix flips it
    // upwards; at 1280x720 that put it at y = 93 with the X spanning y 71..103,
    // i.e. straight over the operator's way out.
    const closeBox = await closeButton.boundingBox();
    const popBox = await popover.boundingBox();
    expect(closeBox).not.toBeNull();
    expect(popBox).not.toBeNull();
    const overlaps =
      popBox!.x < closeBox!.x + closeBox!.width &&
      popBox!.x + popBox!.width > closeBox!.x &&
      popBox!.y < closeBox!.y + closeBox!.height &&
      popBox!.y + popBox!.height > closeBox!.y;
    expect(
      overlaps,
      `popover ${JSON.stringify(popBox)} overlaps the close button ${JSON.stringify(closeBox)}`,
    ).toBe(false);

    // And the hit test agrees: the X owns its own centre.
    const cx = closeBox!.x + closeBox!.width / 2;
    const cy = closeBox!.y + closeBox!.height / 2;
    const owner = await page.evaluate(
      ([x, y]) => {
        const el = document.elementFromPoint(x, y);
        if (!el) return 'nothing';
        if (el.closest('[data-slot="popover-content"]')) return 'popover';
        if (el.closest('[data-slot="dialog-close"]')) return 'close button';
        return 'other';
      },
      [cx, cy],
    );
    expect(owner).toBe('close button');

    // One real click, no retry: the operator aims at the X and gets what they
    // aimed at — the modal closes, and nothing is assigned behind their back.
    // A click that landed in the popover instead would silently add a vehicle.
    await page.mouse.click(cx, cy);
    await expect(modal).toBeHidden();
    await expect(
      page.locator('[data-sonner-toast]').filter({ hasText: 'zugewiesen' }),
    ).toHaveCount(0);

    const card = page.locator('[data-testid="incident-card"]').first();
    await card.click();
    await expect(detailModal(page)).toBeVisible();
    await expect(detailModal(page).getByText('Fahrzeuge (0)')).toBeVisible();
  });
});

function detailModal(page: import('@playwright/test').Page) {
  return page
    .locator('[role="dialog"][data-slot="dialog-content"][data-state="open"]')
    .filter({ hasText: 'Zugewiesene Ressourcen' });
}
