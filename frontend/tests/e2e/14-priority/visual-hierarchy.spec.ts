import { test, expect } from '../../fixtures/auth.fixture';
import { MOBILE_VIEWPORT, incidentCards, setupBoard } from '../../helpers/api.helper';
import type { Page } from '@playwright/test';

/**
 * Priority Visual Hierarchy (Sprint 3)
 *
 * What the board owes the operator here is design principle 4: priority must be
 * readable at a glance, "never by colour alone". The part a browser test can say without
 * reading styles is that every card, desktop and phone, carries exactly one indicator that
 * NAMES its level. Shape, tint, the Hoch card's edge and where the chevron sits are on the
 * visual screens (the storm evening has all three levels); they left this file in the
 * 2026-10 sweep.
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
  });
});
