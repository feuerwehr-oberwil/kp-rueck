import { test, expect } from '../../fixtures/auth.fixture';
import { cookieHeaderFor, createEventWithIncident, dismissOverlays, selectEvent } from '../../helpers/api.helper';

/**
 * Opening the Lagekarte with an Einsatz selected (feedback 19.11.2026 #16).
 *
 * The board hands its selection to the map as `?highlight=` (page-navigation.tsx), and
 * the map flies to it. On a desktop that flight was `flyTo({ offset: undefined })`;
 * MapLibre spreads the options over its own `offset: [0, 0]`, so the explicit undefined
 * won and `Point.convert(undefined)` threw – «Kartenfehler» when the operator went from
 * a selected card to the map. Only on the client-side hop from the board: a fresh load
 * of /map has no incidents yet when the map is ready, so there is nothing to fly to.
 */
test('the map opens on a selected Einsatz instead of the error screen', async ({ authenticatedPage, request }) => {
  const fixture = await createEventWithIncident(request, await cookieHeaderFor(authenticatedPage), 'Kartenflug');
  // The board with the Einsatz selected (its card clicked), then its own «Lagekarte» link,
  // which carries ?highlight=.
  await selectEvent(authenticatedPage, '/', fixture.eventId);
  await dismissOverlays(authenticatedPage);
  const mapLink = authenticatedPage.getByRole('navigation').getByRole('link', { name: 'Lagekarte' });

  // Three hops: whether the flight fires depends on the map getting ready after the
  // incidents, so a single hop went red only about every other run.
  for (let hop = 0; hop < 3; hop++) {
    await authenticatedPage.getByText(fixture.address).first().click();
    // The detail opened over the board; closing it keeps the card selected.
    await authenticatedPage.keyboard.press('Escape');
    await expect(mapLink).toHaveAttribute('href', `/map?highlight=${fixture.incidents[0].id}`);
    await mapLink.click();
    await authenticatedPage.waitForURL('**/map?highlight=*');
    await expect(authenticatedPage.locator('[data-testid="base-map"]')).toBeVisible({ timeout: 20_000 });
    // The flight starts once the map has loaded; give it the time to throw.
    await authenticatedPage.waitForTimeout(1_500);
    await expect(authenticatedPage.getByRole('heading', { name: 'Kartenfehler', exact: true })).toHaveCount(0);
    await authenticatedPage.getByRole('navigation').getByRole('link', { name: 'Board' }).click();
    await authenticatedPage.waitForURL((url) => url.pathname === '/');
  }
});
