import { test, expect } from '../../fixtures/auth.fixture';
import { setupBoard } from '../../helpers/api.helper';
import { MainPage } from '../../pages/main.page';

/**
 * Drag-Drop Visual Affordances Tests (Sprint 3)
 * Tests the visual feedback and accessibility features of drag-and-drop operations
 * Ensures users understand what is draggable and receive clear feedback
 */

test.describe('Drag-Drop Visual Affordances - Cursor States', () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    await setupBoard(authenticatedPage, 'Drag Test');
  });

  test('draggable incident cards show grab cursor on hover', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();

    // Hover over incident card
    await incidentCard.hover();
    await authenticatedPage.waitForTimeout(300);

    // Check for grab cursor or similar draggable styling
    const cursor = await incidentCard.evaluate(el => window.getComputedStyle(el).cursor);

    // Should have pointer or move cursor (indicating interactivity)
    expect(['pointer', 'move', 'grab', '-webkit-grab']).toContain(cursor);
  });

  test('incident card has visual draggable indicator', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();

    // Check for draggable visual cues (the card itself is draggable)
    await expect(incidentCard).toBeVisible();

    // Card should have transition classes for smooth interactions
    const hasTransition = await incidentCard.evaluate(el =>
      el.className.includes('transition')
    );
    expect(hasTransition).toBeTruthy();
  });

  test('active drag state reduces opacity', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();

    // Get initial opacity
    const initialOpacity = await incidentCard.evaluate(el =>
      window.getComputedStyle(el).opacity
    );

    // Initial opacity should be 1 (fully visible)
    expect(parseFloat(initialOpacity)).toBe(1);
  });
});

test.describe('Drag-Drop Visual Affordances - Drop Zones', () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    await setupBoard(authenticatedPage, 'Drop Zone Test');
  });

  test('empty columns show drop zone affordance', async ({ authenticatedPage }) => {
    // `[data-column]` is the attribute the columns are actually built with
    // (`droppable-column.tsx`); the old `[class*="min-w-[320px]"]` was a Tailwind
    // width that had already moved to `min-w-[320px] max-w-[420px]` on a different
    // element, so the locator resolved to nothing.
    const columns = authenticatedPage.locator('[data-column]');

    // Should have at least 3 columns
    expect(await columns.count()).toBeGreaterThanOrEqual(3);

    // Columns should be visible and ready to receive drops
    await expect(columns.first()).toBeVisible();
    await expect(columns.first().locator('[data-board-scroll]')).toBeVisible();
  });

  test('drop zones have minimum height for visibility', async ({ authenticatedPage }) => {
    const dropZone = authenticatedPage.locator('[class*="min-h-[200px]"]').first();

    // Should have minimum height class
    await expect(dropZone).toBeVisible();

    const height = await dropZone.evaluate(el => el.getBoundingClientRect().height);
    expect(height).toBeGreaterThanOrEqual(200);
  });

  test('columns show count of incidents', async ({ authenticatedPage }) => {
    // The header no longer spells out "N Einsätze"; it carries a bare tally badge
    // next to the title. Asserted against the cards actually in the column, so the
    // test says something ("the tally matches the board") rather than "some digits
    // exist somewhere".
    const incoming = authenticatedPage.locator('[data-column="incoming"]');
    const tally = incoming.locator('h2 + div > span').first();

    await expect(tally).toBeVisible();
    await expect(tally).toHaveText(
      String(await incoming.getByTestId('incident-card').count()),
    );
  });
});

test.describe('Drag-Drop Visual Affordances - Hover States', () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    await setupBoard(authenticatedPage, 'Hover Test');
  });

  test('incident cards show hover effect', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();
    const background = () =>
      incidentCard.evaluate((el) => window.getComputedStyle(el).backgroundColor);

    // The card's hover style is `hover:bg-muted/30`, not the `hover:border-primary` /
    // `hover:shadow` this used to grep for — and grepping a class name proves nothing
    // about what renders anyway. Measure the effect instead: the background changes
    // under the pointer and changes back when it leaves.
    const resting = await background();
    await incidentCard.hover();
    await expect.poll(background).not.toBe(resting);

    await authenticatedPage.mouse.move(0, 0);
    await expect.poll(background).toBe(resting);
  });

  // FLAKY, seen 2026-07-30: passed in two of three identical full runs and failed in
  // the third — the only test in the suite that changed result between two runs of an
  // unchanged tree. It reads `className` off whatever card is first at that instant,
  // with nothing waiting for the card to have settled. Not `@smoke` (nothing here is),
  // so it keeps running nightly and keeps reporting; it must not be promoted into the
  // gate until it waits for a condition instead of sampling one.
  test('incident cards have transition for smooth hover', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();

    // Verify transition classes
    const hasTransition = await incidentCard.evaluate(el =>
      el.className.includes('transition')
    );

    expect(hasTransition).toBeTruthy();
  });
});

test.describe('Drag-Drop Visual Affordances - Drop Indicators', () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    await setupBoard(authenticatedPage, 'Drop Indicator Test', { count: 2 });
  });

  test('multiple incidents exist in same column for reordering', async ({ authenticatedPage }) => {
    const incidents = authenticatedPage.locator('[data-testid="incident-card"]');
    const count = await incidents.count();

    // Should have at least 2 incidents
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test('incident cards are spaced for drop indicators', async ({ authenticatedPage }) => {
    const firstIncident = authenticatedPage.locator('[data-testid="incident-card"]').first();
    const secondIncident = authenticatedPage.locator('[data-testid="incident-card"]').nth(1);

    if (await secondIncident.count() > 0) {
      const firstRect = await firstIncident.boundingBox();
      const secondRect = await secondIncident.boundingBox();

      if (firstRect && secondRect) {
        // Should have gap between incidents
        const gap = secondRect.y - (firstRect.y + firstRect.height);
        expect(gap).toBeGreaterThan(0);
      }
    }
  });
});

test.describe('Drag-Drop Visual Affordances - Accessibility', () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    await setupBoard(authenticatedPage, 'A11y Test');
  });

  test('incident cards have data-incident-id attribute', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();

    // Should have data-incident-id for drag operations
    const incidentId = await incidentCard.getAttribute('data-incident-id');
    expect(incidentId).toBeTruthy();
    expect(incidentId).toMatch(/^[0-9a-f-]+$/); // UUID format
  });

  test('incident cards are clickable for details', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();

    // Click should open detail modal
    await incidentCard.click();
    await authenticatedPage.waitForTimeout(500);

    const modal = authenticatedPage.locator('[role="dialog"]');
    await expect(modal).toBeVisible({ timeout: 3000 });
  });

  test('priority indicators have aria-labels', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();

    // Every card renders exactly one priority chevron, and it is always labelled —
    // the `if (count > 0)` guard this used to sit behind meant the assertions ran
    // only by luck, and reported green when the indicator was missing entirely.
    const priorityIcon = incidentCard.locator('[aria-label*="Priorität"]');

    await expect(priorityIcon).toHaveCount(1);
    await expect(priorityIcon).toHaveAttribute('aria-label', /Priorität/i);
  });
});

test.describe('Drag-Drop Visual Affordances - Mobile', () => {
  // "incident cards are tappable on mobile" removed. It asserted a >40px touch
  // target on `[data-testid="incident-card"]`, an element the phone layout does not
  // render at all (it renders `MobileIncidentCard`), so it could only ever fail — and
  // what it was reaching for, a touch-target size, is a requirement KP Rück
  // deliberately rejects (CLAUDE.md: "Do not size KP Rück's UI around touch targets").
  // Mobile rendering of the incident list is covered in 15-time-indicators and
  // 16-sprint3-integration.

  test('columns are horizontally scrollable on mobile', async ({ authenticatedPage }) => {
    await authenticatedPage.setViewportSize({ width: 375, height: 667 });

    await setupBoard(authenticatedPage, 'Mobile Scroll Test', { count: 0 });
    const scrollContainer = authenticatedPage.locator('[class*="overflow-x-auto"]').first();
    await expect(scrollContainer).toBeVisible();
  });
});

test.describe('Drag-Drop Visual Affordances - Animation', () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    await setupBoard(authenticatedPage, 'Animation Test');
  });

  test('incident cards have smooth transitions', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();

    // Check for transition-all class
    const hasTransition = await incidentCard.evaluate(el =>
      el.className.includes('transition')
    );

    expect(hasTransition).toBeTruthy();
  });

  // Deliberately still driven through the "Neuer Einsatz" modal, unlike the rest of
  // this suite: here the *subject* is that creating an incident puts a card on the
  // board, so arranging it over REST would leave the modal — the operator's actual
  // path, geocoder popover and all — covered by nothing.
  test('newly created incidents appear smoothly', async ({ authenticatedPage }) => {
    const mainPage = new MainPage(authenticatedPage);
    const initialCount = await authenticatedPage.locator('[data-testid="incident-card"]').count();

    // Create new incident
    await mainPage.createIncident(`New Incident ${Date.now()}`);

    await expect(authenticatedPage.locator('[data-testid="incident-card"]')).toHaveCount(
      initialCount + 1,
      { timeout: 15_000 },
    );
  });
});

test.describe('Drag-Drop Visual Affordances - Visual Feedback', () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    await setupBoard(authenticatedPage, 'Feedback Test');
  });

  test('incident cards have border for visual separation', async ({ authenticatedPage }) => {
    const incidentCard = authenticatedPage.locator('[data-testid="incident-card"]').first();

    const hasBorder = await incidentCard.evaluate(el =>
      el.className.includes('border')
    );

    expect(hasBorder).toBeTruthy();
  });

  // "incident cards have shadow for depth" removed: its assertion was
  // `expect(hasShadow || true).toBeTruthy()`, which holds for every possible input.
  // It reported green while checking nothing, and there is no shadow rule on the
  // card to check — the separation it was after is the border, asserted above.

  test('column headers have visual distinction', async ({ authenticatedPage }) => {
    // Headers stay ALL-CAPS (Bastian's field-round verdict: a label must not
    // read like an item); the column's identity additionally comes from the
    // accent rule instead of a background wash.
    const columnHeader = authenticatedPage
      .locator('[data-column="incoming"]')
      .getByRole('heading', { name: 'Eingegangen' });

    await expect(columnHeader).toBeVisible();
    await expect(columnHeader).toHaveCSS('text-transform', 'uppercase');
  });
});
