import { expect, type Page } from '@playwright/test';

/**
 * Shared setup for the viewer-role specs.
 *
 * Not a `.spec.ts`, so Playwright's default testMatch leaves it alone.
 *
 * The REST factories that used to live here now live in `tests/helpers/api.helper.ts`,
 * because they stopped being viewer-specific the moment other suites needed the same
 * arrangement — `09-resource-badges` was already importing them from this file, which
 * is a strange place for a spec about resource badges to look.
 */

export {
  API_BASE,
  SELECTED_EVENT_KEY,
  cookieHeaderFor,
  createEventWithIncident,
  dismissOverlays,
  selectEvent,
} from '../../helpers/api.helper';

export type { BoardFixture } from '../../helpers/api.helper';

/** Where ProtectedRoute sends every `viewer` account (components/protected-route.tsx). */
export const VIEWER_LANDING = '/display/board';

/** Assert that `page` (a viewer) was bounced out of an editor-only route. */
export async function expectBouncedToDisplayBoard(page: Page, path: string) {
  await page.goto(path);
  await page.waitForURL(`**${VIEWER_LANDING}`, { timeout: 15_000 });
  expect(new URL(page.url()).pathname).toBe(VIEWER_LANDING);
}
