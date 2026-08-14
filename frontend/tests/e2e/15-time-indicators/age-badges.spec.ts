import { test, expect } from '../../fixtures/auth.fixture';
import { MOBILE_VIEWPORT, incidentCards, setupBoard } from '../../helpers/api.helper';
import type { Locator, Page } from '@playwright/test';

/**
 * Time-Based Indicators — one number per card, and which one is a choice.
 *
 * A card used to carry two numbers side by side, the dispatch time (HH:MM) and
 * the age. Since `f48b3d9b` it carries ONE: a chip whose mode the operator
 * picks — «In diesem Status» (the default), «Startzeit» (HH:MM) or «Seit
 * Alarmierung». So "the card shows both" is no longer a fact about the board,
 * and the assertions that measured the two against each other have no referent
 * left; what replaces them is that the chip *becomes* the other number.
 *
 * The mode is board-wide by design: two cards showing different measures would
 * be incomparable at a glance, which is the bug the chip exists to fix. That is
 * asserted here rather than assumed. The choice is per-device (localStorage,
 * `lib/hooks/use-incident-time-mode.ts`), so it dies with the browser context
 * each test gets and no case can leak its mode into the next.
 *
 * Everything is read through rendered text and the mode's own icon. An earlier
 * version of this file asserted Tailwind class names — `font-mono`, `gap-`,
 * `justify-between` — several through `el.className.includes(...)` on an
 * `<svg>`, where `className` is an `SVGAnimatedString` and has no `.includes`.
 */

/** `HH:MM`, 24-hour — what «Startzeit» renders. */
const DISPATCH_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
/** `getTimeSince`: minutes with an apostrophe, or `Xh Y'` past the hour. */
const ELAPSED = /^(\d+'|\d+h \d+')$/;

/** Every mode label, so the chip can be found whichever one is active. */
const ANY_MODE = /^(Startzeit|In diesem Status|Seit Alarmierung):/;

/** A distinct icon per mode, so the chip itself says which of the three it is. */
const CLOCK = 'svg.lucide-clock'; // start
const TIMER = 'svg.lucide-timer'; // column — the default

/** The chip is a button: it opens the mode menu (`components/ui/incident-time.tsx`). */
const timeChip = (card: Locator) => card.getByRole('button', { name: ANY_MODE });

/**
 * The same number where the chip is `readOnly` and therefore not a button —
 * the phone list, which is for looking: a dropdown inside a tappable row
 * fights the tap that opens the incident (`components/mobile/mobile-incident-card.tsx`).
 */
const elapsed = (card: Locator) => card.getByText(ELAPSED);

/** Switch the board-wide mode through the chip itself, the way an operator does. */
async function chooseTimeMode(page: Page, card: Locator, label: string) {
  await timeChip(card).click();
  await page.getByRole('menuitem', { name: new RegExp(`^${label}`) }).click();
}

test.describe('Time-Based Indicators - Display and Formatting', () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    await setupBoard(authenticatedPage, 'Time Test');
  });

  test('a card shows how long the incident has been in its status', async ({
    authenticatedPage,
  }) => {
    const card = incidentCards(authenticatedPage).first();
    await expect(timeChip(card)).toHaveText(ELAPSED);
    await expect(card.locator(TIMER)).toBeVisible();
  });

  test('a just-created incident reads as minutes old, not hours', async ({
    authenticatedPage,
  }) => {
    const card = incidentCards(authenticatedPage).first();
    await expect(timeChip(card)).toHaveText(/^[0-5]'$/);
  });

  test('«Startzeit» turns that same chip into the dispatch time', async ({
    authenticatedPage,
  }) => {
    const card = incidentCards(authenticatedPage).first();
    await chooseTimeMode(authenticatedPage, card, 'Startzeit');

    // Replaced, not added — the whole point of one chip instead of two numbers.
    await expect(timeChip(card)).toHaveText(DISPATCH_TIME);
    await expect(card.locator(CLOCK)).toBeVisible();
    await expect(card.locator(TIMER)).toHaveCount(0);
  });
});

test.describe('Time-Based Indicators - Layout and Position', () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    await setupBoard(authenticatedPage, 'Layout Test');
  });

  test('the chip shares the Einsatzart row, pushed to the far end of it', async ({
    authenticatedPage,
  }) => {
    const card = incidentCards(authenticatedPage).first();

    const sirenBox = (await card.locator('svg.lucide-siren').boundingBox())!;
    const chipBox = (await timeChip(card).boundingBox())!;

    // One row: the type reads on the left, the number answers on the right.
    expect(Math.abs(chipBox.y - sirenBox.y)).toBeLessThan(chipBox.height);
    expect(chipBox.x).toBeGreaterThan(sirenBox.x);
  });
});

test.describe('Time-Based Indicators - Multiple Incidents', () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    await setupBoard(authenticatedPage, 'Multiple Time Test', { count: 3 });
  });

  test('every card carries the chip, and they all switch together', async ({
    authenticatedPage,
  }) => {
    const cards = incidentCards(authenticatedPage);
    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(3);

    for (let i = 0; i < count; i += 1) {
      await expect(timeChip(cards.nth(i))).toHaveText(ELAPSED);
    }

    // The mode is board-wide, so switching one card switches the board. A card
    // left behind would put two incomparable numbers next to each other.
    await chooseTimeMode(authenticatedPage, cards.first(), 'Startzeit');

    for (let i = 0; i < count; i += 1) {
      await expect(timeChip(cards.nth(i))).toHaveText(DISPATCH_TIME);
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
      await expect(card.locator(TIMER)).toBeVisible();
      await expect(elapsed(card)).toBeVisible();
      // No mode menu to open here — see `elapsed`.
      await expect(timeChip(card)).toHaveCount(0);
    }
  });
});
