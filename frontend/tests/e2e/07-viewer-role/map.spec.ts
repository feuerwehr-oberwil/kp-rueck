import { test, expect } from '../../fixtures/auth.fixture';
import {
  cookieHeaderFor,
  createEventWithIncident,
  expectBouncedToDisplayBoard,
  selectEvent,
  VIEWER_LANDING,
  type BoardFixture,
} from './viewer-role.helpers';

/**
 * Viewer role — the map.
 *
 * `/map` carries 15 `isEditor` call sites; none of them run for a viewer, who is
 * redirected to /display/board like everywhere else. The read-only map a viewer
 * does get is /display/map, so the pairing is "editor tools on /map" against
 * "same incident, no tools, on /display/map".
 */

test.describe('Viewer role — map', () => {
  let fixture: BoardFixture;

  test.beforeEach(async ({ authenticatedPage, viewerPage, request }) => {
    fixture = await createEventWithIncident(
      request,
      await cookieHeaderFor(authenticatedPage),
      'Map',
    );
    await selectEvent(authenticatedPage, '/map', fixture.eventId);
    await selectEvent(viewerPage, '/display/map', fixture.eventId);
  });

  test('the editor map renders for an editor and is closed to a viewer', async ({
    authenticatedPage,
    viewerPage,
  }) => {
    await expect(authenticatedPage.locator('.leaflet-container')).toBeVisible({
      timeout: 20_000,
    });
    expect(new URL(authenticatedPage.url()).pathname).toBe('/map');

    await expectBouncedToDisplayBoard(viewerPage, '/map');
  });

  test('the map editor tools exist for an editor and not on the viewer map', async ({
    authenticatedPage,
    viewerPage,
  }) => {
    // app/map/page.tsx: the "Modus" dropdown (route planning / Reko mode) is the
    // one control on this page rendered behind a bare `{isEditor && …}`.
    await expect(
      authenticatedPage.getByRole('button', { name: 'Modus' }),
    ).toBeVisible({ timeout: 20_000 });

    await expect(viewerPage.locator('.leaflet-container')).toBeVisible({
      timeout: 20_000,
    });
    await expect(viewerPage.getByRole('button', { name: 'Modus' })).toHaveCount(0);
  });

  test('the incident is on both maps', async ({ authenticatedPage, viewerPage }) => {
    // The event holds exactly one incident, and it is active — so the status
    // filter counts are a readable-data assertion that does not depend on
    // whatever else lives in the shared database.
    await expect(
      authenticatedPage.getByRole('button', { name: 'Aktiv (1)' }),
    ).toBeVisible({ timeout: 20_000 });

    await expect(viewerPage.getByRole('button', { name: 'Aktiv (1)' })).toBeVisible({
      timeout: 20_000,
    });
    expect(new URL(viewerPage.url()).pathname).toBe('/display/map');
  });

  test('the map highlight deep link does not let a viewer in', async ({
    authenticatedPage,
    viewerPage,
  }) => {
    // `?highlight=` is the only query parameter /map reads, and it is how the
    // board hands an incident over to the map — so it is the one URL that could
    // plausibly be a second door. It opens for an editor and not for a viewer.
    await authenticatedPage.goto(`/map?highlight=${fixture.eventId}`);
    await expect(authenticatedPage.locator('.leaflet-container')).toBeVisible({
      timeout: 20_000,
    });
    expect(new URL(authenticatedPage.url()).pathname).toBe('/map');

    await expectBouncedToDisplayBoard(viewerPage, `/map?highlight=${fixture.eventId}`);
    expect(new URL(viewerPage.url()).pathname).toBe(VIEWER_LANDING);
  });
});
