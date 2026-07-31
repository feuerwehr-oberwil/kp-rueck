import { test, expect } from '../../fixtures/auth.fixture';
import { MOBILE_VIEWPORT, incidentCards, setupBoard } from '../../helpers/api.helper';
import type { Locator } from '@playwright/test';

/**
 * Time-Based Indicators (Sprint 3)
 *
 * Two numbers live on every card: when the incident came in (HH:MM, 24h) and how
 * long it has been in its current status (`getTimeSince`: `12'`, or `1h 23'` past
 * the hour). Both are what let an operator spot a stale incident, so both are
 * asserted through their rendered text.
 *
 * The old file mostly asserted Tailwind class names — `font-mono`,
 * `text-muted-foreground`, `h-4`+`w-4`, `gap-`, `justify-between` — several of them
 * through `el.className.includes(...)` on an `<svg>`, where `className` is an
 * `SVGAnimatedString` and has no `.includes`. Those cases could not pass against an
 * icon. The mobile ones failed earlier still, in setup: below 768px the board is
 * `MobileIncidentListView` and `[data-testid="incident-card"]` never appears.
 */

/** `HH:MM`, 24-hour. */
const DISPATCH_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
/** `getTimeSince`: minutes with an apostrophe, or `Xh Y'` past the hour. */
const ELAPSED = /^(\d+'|\d+h \d+')$/;

const dispatchTime = (card: Locator) => card.getByText(DISPATCH_TIME);
const elapsed = (card: Locator) => card.getByText(ELAPSED);

test.describe('Time-Based Indicators - Display and Formatting', () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    await setupBoard(authenticatedPage, 'Time Test');
  });

  test('incident shows dispatch time in 24-hour format', async ({ authenticatedPage }) => {
    const card = incidentCards(authenticatedPage).first();
    await expect(dispatchTime(card)).toBeVisible();
  });

  test('incident shows elapsed time', async ({ authenticatedPage }) => {
    const card = incidentCards(authenticatedPage).first();
    await expect(elapsed(card)).toBeVisible();
  });

  test('a just-created incident reads as minutes old, not hours', async ({
    authenticatedPage,
  }) => {
    const card = incidentCards(authenticatedPage).first();
    await expect(elapsed(card)).toHaveText(/^[0-5]'$/);
  });

  test('clock icon accompanies time display', async ({ authenticatedPage }) => {
    const card = incidentCards(authenticatedPage).first();
    await expect(card.locator('svg.lucide-clock')).toBeVisible();
  });
});

test.describe('Time-Based Indicators - Layout and Position', () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    await setupBoard(authenticatedPage, 'Layout Test');
  });

  test('dispatch time sits next to the clock icon, elapsed time opposite it', async ({
    authenticatedPage,
  }) => {
    const card = incidentCards(authenticatedPage).first();

    const clockBox = (await card.locator('svg.lucide-clock').boundingBox())!;
    const dispatchBox = (await dispatchTime(card).boundingBox())!;
    const elapsedBox = (await elapsed(card).boundingBox())!;

    // Same row as the icon, immediately to its right.
    expect(dispatchBox.x).toBeGreaterThan(clockBox.x);
    expect(Math.abs(dispatchBox.y - clockBox.y)).toBeLessThan(dispatchBox.height);

    // Age pushed to the far end of that row — the two never overlap.
    expect(elapsedBox.x).toBeGreaterThan(dispatchBox.x + dispatchBox.width);
  });

  test('time section is below incident type', async ({ authenticatedPage }) => {
    const card = incidentCards(authenticatedPage).first();

    const sirenBox = (await card.locator('svg.lucide-siren').boundingBox())!;
    const clockBox = (await card.locator('svg.lucide-clock').boundingBox())!;

    expect(clockBox.y).toBeGreaterThan(sirenBox.y);
  });
});

test.describe('Time-Based Indicators - Multiple Incidents', () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    await setupBoard(authenticatedPage, 'Multiple Time Test', { count: 3 });
  });

  test('every incident shows both its dispatch time and its age', async ({
    authenticatedPage,
  }) => {
    const cards = incidentCards(authenticatedPage);
    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(3);

    for (let i = 0; i < count; i += 1) {
      const card = cards.nth(i);
      await expect(dispatchTime(card)).toBeVisible();
      await expect(elapsed(card)).toBeVisible();
    }
  });
});

test.describe('Time-Based Indicators - Phone layout', () => {
  test('the phone list shows the age of each incident', async ({ authenticatedPage }) => {
    await authenticatedPage.setViewportSize(MOBILE_VIEWPORT);
    await setupBoard(authenticatedPage, 'Mobile Time Test', { count: 2, layout: 'mobile' });

    const cards = incidentCards(authenticatedPage, 'mobile');
    await expect(cards).toHaveCount(2);

    for (let i = 0; i < 2; i += 1) {
      const card = cards.nth(i);
      await expect(card.locator('svg.lucide-clock')).toBeVisible();
      await expect(elapsed(card)).toBeVisible();
    }
  });
});
