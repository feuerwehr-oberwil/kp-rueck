import { test, expect } from '../../fixtures/auth.fixture';
import { expectBouncedToDisplayBoard } from './viewer-role.helpers';

/**
 * Viewer role — the alarm intake pool.
 *
 * `/divera-pool` used to be the one page a viewer reached without being redirected, and this
 * file pinned the `isEditor` branch inside it. The RBAC sweep (6fecc78a) put the page behind
 * `ProtectedRoute`, so the gate that holds is now the redirect, as on the board, map and
 * settings: the editor half proves the page and its attach action exist, the viewer half that
 * the role never gets there.
 */

test.describe('Viewer role — alarm intake pool', () => {
  test('the pool opens for an editor, with its attach action, and is closed to a viewer', async ({
    authenticatedPage,
    viewerPage,
  }) => {
    await authenticatedPage.goto('/divera-pool');
    await expect(authenticatedPage.getByRole('heading', { name: 'Alarmeingang' })).toBeVisible({
      timeout: 15_000,
    });
    // Present but disabled until rows are selected, hence visible rather than enabled.
    await expect(authenticatedPage.getByRole('button', { name: 'Anhängen' })).toBeVisible();

    await expectBouncedToDisplayBoard(viewerPage, '/divera-pool');
  });
});
