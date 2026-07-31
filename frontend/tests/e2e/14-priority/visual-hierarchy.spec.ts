import { test, expect } from '../../fixtures/auth.fixture';
import { MOBILE_VIEWPORT, incidentCards, setupBoard } from '../../helpers/api.helper';
import type { Page } from '@playwright/test';

/**
 * Priority Visual Hierarchy (Sprint 3)
 *
 * What the board owes the operator here is design principle 4: priority must be
 * readable at a glance, "never by colour alone". So that is what this spec checks —
 * one labelled indicator per card, a different shape and a different tint per level,
 * and a card that stands out when the level is high.
 *
 * The previous version of this file checked Tailwind class *strings*
 * (`[class*="h-2.5"][class*="w-2.5"][class*="rounded-full"]`, `text-red-`,
 * `dark:text-`) and 13 of its cases failed against the shipped card: the desktop
 * card has no priority dot at all (it is icon-only — see the comment in
 * `draggable-operation.tsx`), the tints are semantic tokens rather than palette
 * names, and `el.className` on an `<svg>` is an SVGAnimatedString with no
 * `.includes`. Several of the cases that "passed" were `expect(true).toBeTruthy()`
 * or `expect(await x.count() >= 0)`, which hold no matter what the app does.
 */

const BY_PRIORITY = {
  high: { address: 'Hochprio 1, 4104 Oberwil', label: 'Hohe Priorität' },
  medium: { address: 'Mittelprio 2, 4104 Oberwil', label: 'Mittlere Priorität' },
  low: { address: 'Tiefprio 3, 4104 Oberwil', label: 'Niedrige Priorität' },
} as const;

type Level = keyof typeof BY_PRIORITY;
const LEVELS = Object.keys(BY_PRIORITY) as Level[];

function priorityIncidents() {
  return LEVELS.map((level) => ({
    priority: level,
    location_address: BY_PRIORITY[level].address,
  }));
}

function cardFor(page: Page, level: Level, layout: 'desktop' | 'mobile' = 'desktop') {
  const street = BY_PRIORITY[level].address.split(',')[0];
  return incidentCards(page, layout).filter({ hasText: street });
}

test.describe('Priority Visual Hierarchy - Indicators', () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    await setupBoard(authenticatedPage, 'Priority Test', { incidents: priorityIncidents() });
  });

  test('every card carries exactly one priority indicator, labelled for its level', async ({
    authenticatedPage,
  }) => {
    for (const level of LEVELS) {
      const indicators = cardFor(authenticatedPage, level).locator('[aria-label*="Priorität"]');
      await expect(indicators).toHaveCount(1);
      await expect(indicators).toHaveAttribute('aria-label', BY_PRIORITY[level].label);
    }
  });

  test('each priority uses its own icon shape, not only a colour', async ({
    authenticatedPage,
  }) => {
    // ChevronUp / Minus / ChevronDown: the shape alone tells the levels apart on a
    // monochrome display, or for an operator who cannot separate red from amber.
    const shapes = await Promise.all(
      LEVELS.map((level) =>
        cardFor(authenticatedPage, level)
          .locator('[aria-label*="Priorität"]')
          .evaluate((el) => el.querySelector('path,polyline,line')?.getAttribute('d') ?? el.innerHTML),
      ),
    );

    expect(new Set(shapes).size).toBe(LEVELS.length);
  });

  test('each priority uses its own tint', async ({ authenticatedPage }) => {
    const colours = await Promise.all(
      LEVELS.map((level) =>
        cardFor(authenticatedPage, level)
          .locator('[aria-label*="Priorität"]')
          .evaluate((el) => window.getComputedStyle(el).color),
      ),
    );

    expect(new Set(colours).size).toBe(LEVELS.length);
  });

  test('a high-priority card is set apart from a low-priority one', async ({
    authenticatedPage,
  }) => {
    const edge = (level: Level) =>
      cardFor(authenticatedPage, level).evaluate(
        (el) => window.getComputedStyle(el).borderLeftColor,
      );

    expect(await edge('high')).not.toBe(await edge('low'));
  });
});

test.describe('Priority Visual Hierarchy - Layout and Placement', () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    await setupBoard(authenticatedPage, 'Layout Test', { incidents: priorityIncidents() });
  });

  test('the indicator leads the card, ahead of the location', async ({ authenticatedPage }) => {
    const card = cardFor(authenticatedPage, 'high');
    const indicator = card.locator('[aria-label*="Priorität"]');
    const heading = card.getByRole('heading').first();

    const indicatorBox = (await indicator.boundingBox())!;
    const headingBox = (await heading.boundingBox())!;

    // Left of the heading and clear of it — the two must not sit on top of each other.
    expect(indicatorBox.x + indicatorBox.width).toBeLessThanOrEqual(headingBox.x);
  });

  test('the indicator survives hover and an opened-then-closed detail view', async ({
    authenticatedPage,
  }) => {
    const card = cardFor(authenticatedPage, 'medium');
    const indicator = card.locator('[aria-label*="Priorität"]');

    await card.hover();
    await expect(indicator).toBeVisible();

    await card.click();
    await expect(authenticatedPage.getByRole('dialog')).toBeVisible();
    await authenticatedPage.keyboard.press('Escape');
    await expect(authenticatedPage.getByRole('dialog')).toHaveCount(0);

    await expect(indicator).toHaveAttribute('aria-label', BY_PRIORITY.medium.label);
  });
});

test.describe('Priority Visual Hierarchy - Phone layout', () => {
  // The phone is a viewing surface for this product, and the list it shows is its own
  // component (`MobileIncidentCard`). Priority has to survive that translation — this
  // is deliberately about what renders, not about how large it is to tap.
  test('the phone list keeps the priority indicator', async ({ authenticatedPage }) => {
    await authenticatedPage.setViewportSize(MOBILE_VIEWPORT);
    await setupBoard(authenticatedPage, 'Mobile Priority Test', {
      layout: 'mobile',
      incidents: priorityIncidents(),
    });

    for (const level of LEVELS) {
      const indicator = cardFor(authenticatedPage, level, 'mobile').locator(
        '[aria-label*="Priorität"]',
      );
      await expect(indicator).toHaveCount(1);
      await expect(indicator).toHaveAttribute('aria-label', BY_PRIORITY[level].label);
    }

    // The phone card pairs the chevron with a coloured dot; two levels must not land
    // on the same colour.
    const dot = (level: Level) =>
      cardFor(authenticatedPage, level, 'mobile')
        .locator('[aria-hidden="true"]')
        .first()
        .evaluate((el) => window.getComputedStyle(el).backgroundColor);

    expect(await dot('high')).not.toBe(await dot('low'));
  });
});
