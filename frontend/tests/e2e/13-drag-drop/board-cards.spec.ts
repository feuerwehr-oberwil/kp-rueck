import { test, expect } from '../../fixtures/auth.fixture';
import { incidentCards, setupBoard } from '../../helpers/api.helper';
import { MainPage } from '../../pages/main.page';

/**
 * The board's cards as an operator meets them: a column counts what it holds, a card
 * opens its detail, and an Einsatz typed into «Neuer Einsatz» lands on the board.
 * Dragging one is `column-move.spec.ts`.
 *
 * This file used to be «visual affordances»: computed cursors, `className.includes
 * ('transition')`, «cards have border», a 200px min-height, gaps between cards. The nine
 * visual screens (`tests/visual/`) carry how the board looks; what is left here is what
 * it does.
 */

test.describe('Board cards', () => {
  test('a column header counts the cards in that column', async ({ authenticatedPage }) => {
    await setupBoard(authenticatedPage, 'Tally', { count: 2 });
    const incoming = authenticatedPage.locator('[data-column="incoming"]');
    await expect(incoming.getByTestId('incident-card')).toHaveCount(2);
    await expect(incoming.locator('h2 + div > span').first()).toHaveText('2');
  });

  test('clicking a card opens its detail', async ({ authenticatedPage }) => {
    await setupBoard(authenticatedPage, 'Detail');
    await incidentCards(authenticatedPage).first().click();
    await expect(authenticatedPage.getByRole('dialog')).toBeVisible();
  });

  // Driven through the «Neuer Einsatz» modal on purpose: the modal – geocoder popover and
  // all – is the subject here, so arranging over REST would leave the operator's path
  // covered by nothing.
  test('an Einsatz created in «Neuer Einsatz» appears on the board', async ({
    authenticatedPage,
  }) => {
    await setupBoard(authenticatedPage, 'Create');
    const cards = incidentCards(authenticatedPage);
    const before = await cards.count();

    await new MainPage(authenticatedPage).createIncident(`New Incident ${Date.now()}`);

    await expect(cards).toHaveCount(before + 1, { timeout: 15_000 });
  });
});
