import { test, expect } from '../../fixtures/auth.fixture';
import { MOBILE_VIEWPORT, incidentCards, setupBoard } from '../../helpers/api.helper';
import type { Locator } from '@playwright/test';

/**
 * Sprint 3 Integration
 *
 * 14-priority and 15-time-indicators each own one indicator. What is left for this
 * file is the only thing neither of them can say: that all of it lands on the SAME
 * card at the same time, and stays there while the operator works — priority, the
 * location, the incident type and the age, readable in one look, on the board and
 * on the phone.
 *
 * Everything else this file used to contain was a Tailwind class string —
 * `p-4`, `backdrop-blur`, `space-y-3`, `-500`, `transition`, `text-muted-foreground`,
 * four of them via `el.className.includes()` on an `<svg>` — plus one
 * `expect(true).toBeTruthy()` and three cases whose setup could not run at all
 * because they shrank the viewport to 375px and then looked for the desktop card.
 * 14 of its 20 cases failed; the rest asserted stylesheet contents, not behaviour.
 */

/** `getTimeSince`: minutes with an apostrophe, or `Xh Y'` past the hour. */
const ELAPSED = /^(\d+'|\d+h \d+')$/;

/** The four things an operator must be able to take in at a glance. */
function facets(card: Locator) {
  return {
    location: card.getByRole('heading').first(),
    priority: card.locator('[aria-label*="Priorität"]'),
    type: card.getByText('Elementarereignis'),
    age: card.getByText(ELAPSED),
  };
}

async function expectAllVisible(card: Locator) {
  const { location, priority, type, age } = facets(card);
  await expect(location).toBeVisible();
  await expect(priority).toBeVisible();
  await expect(type).toBeVisible();
  await expect(age).toBeVisible();
}

test.describe('Sprint 3 Integration - All Features Together', () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    await setupBoard(authenticatedPage, 'Integration Test');
  });

  test('one card shows location, priority, type and age simultaneously', async ({
    authenticatedPage,
  }) => {
    const card = incidentCards(authenticatedPage).first();
    await expectAllVisible(card);
  });

  test('all four fit inside the card, so none of it needs scrolling', async ({
    authenticatedPage,
  }) => {
    const card = incidentCards(authenticatedPage).first();
    const cardBox = (await card.boundingBox())!;

    for (const part of Object.values(facets(card))) {
      const box = (await part.boundingBox())!;
      expect(box.y).toBeGreaterThanOrEqual(cardBox.y);
      expect(box.y + box.height).toBeLessThanOrEqual(cardBox.y + cardBox.height + 1);
      expect(box.x + box.width).toBeLessThanOrEqual(cardBox.x + cardBox.width + 1);
    }
  });

  test('the indicators do not interfere with each other', async ({ authenticatedPage }) => {
    const card = incidentCards(authenticatedPage).first();

    // Hover (drag affordance), open the detail view, close it again — the card must
    // come back intact rather than losing an indicator to a re-render.
    await card.hover();
    await expectAllVisible(card);

    await card.click();
    await expect(authenticatedPage.getByRole('dialog')).toBeVisible();
    await authenticatedPage.keyboard.press('Escape');
    await expect(authenticatedPage.getByRole('dialog')).toHaveCount(0);

    await expectAllVisible(card);
  });

  test('repeated hovering does not disturb the layout', async ({ authenticatedPage }) => {
    const card = incidentCards(authenticatedPage).first();
    const before = (await card.boundingBox())!;

    for (let i = 0; i < 3; i += 1) {
      await card.hover();
      await authenticatedPage.mouse.move(0, 0);
    }

    const after = (await card.boundingBox())!;
    expect(after.width).toBe(before.width);
    expect(after.height).toBe(before.height);
    await expectAllVisible(card);
  });
});

test.describe('Sprint 3 Integration - Rapid triage', () => {
  test('a board of several incidents shows priority and age on every one', async ({
    authenticatedPage,
  }) => {
    await setupBoard(authenticatedPage, 'Triage', { count: 3 });

    const cards = incidentCards(authenticatedPage);
    await expect(cards).toHaveCount(3);

    for (let i = 0; i < 3; i += 1) {
      await expectAllVisible(cards.nth(i));
    }
  });
});

test.describe('Sprint 3 Integration - Phone layout', () => {
  test('the phone list carries the same four facets', async ({ authenticatedPage }) => {
    await authenticatedPage.setViewportSize(MOBILE_VIEWPORT);
    await setupBoard(authenticatedPage, 'Mobile Integration', { layout: 'mobile' });

    const card = incidentCards(authenticatedPage, 'mobile').first();
    await expectAllVisible(card);
  });
});
