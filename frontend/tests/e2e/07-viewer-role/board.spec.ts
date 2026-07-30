import { test, expect } from '../../fixtures/auth.fixture';
import {
  cookieHeaderFor,
  createEventWithIncident,
  dismissOverlays,
  expectBouncedToDisplayBoard,
  selectEvent,
  VIEWER_LANDING,
  type BoardFixture,
} from './viewer-role.helpers';

/**
 * Viewer role — the operations board.
 *
 * Every test holds BOTH roles at once (`authenticatedPage` = editor,
 * `viewerPage` = the seeded read-only account) and asserts the control on both.
 * That is deliberate: this directory replaces `07-protected-buttons/`, which was
 * deleted for asserting absences that no version of the app could have produced.
 * A lone "the viewer cannot see X" passes just as well when X was renamed, moved
 * or deleted — so nothing is asserted absent here without the editor half of the
 * same test proving it exists.
 *
 * What it turns out to cover: the ~130 `isEditor` call sites in `app/page.tsx`
 * never run for a `viewer`, because `ProtectedRoute` redirects the role to
 * /display/board before the board renders. The gate that actually holds is the
 * redirect, so that is what these tests pin down.
 */

test.describe('Viewer role — operations board', () => {
  let fixture: BoardFixture;

  test.beforeEach(async ({ authenticatedPage, viewerPage, request }) => {
    fixture = await createEventWithIncident(
      request,
      await cookieHeaderFor(authenticatedPage),
      'Board',
    );
    await selectEvent(authenticatedPage, '/', fixture.eventId);
    await selectEvent(viewerPage, VIEWER_LANDING, fixture.eventId);
  });

  test('the editor board renders for an editor and is closed to a viewer', async ({
    authenticatedPage,
    viewerPage,
  }) => {
    // Editor: the board itself, not a redirect target.
    await expect(
      authenticatedPage.getByRole('button', { name: 'Neuer Einsatz' }),
    ).toBeVisible({ timeout: 15_000 });
    expect(new URL(authenticatedPage.url()).pathname).toBe('/');

    // Viewer: bounced before the board can render.
    await expectBouncedToDisplayBoard(viewerPage, '/');
  });

  test('the board mutation controls exist for an editor and on no surface a viewer reaches', async ({
    authenticatedPage,
    viewerPage,
  }) => {
    const mutating = ['Neuer Einsatz', 'Übungs-Steuerung'];

    for (const name of mutating) {
      await expect(
        authenticatedPage.getByRole('button', { name, exact: true }),
      ).toBeVisible({ timeout: 15_000 });
    }

    // The viewer's own board is the display board — the editor footer never
    // reaches it, redirect or not.
    await viewerPage.goto('/');
    await viewerPage.waitForURL(`**${VIEWER_LANDING}`, { timeout: 15_000 });
    for (const name of mutating) {
      await expect(
        viewerPage.getByRole('button', { name, exact: true }),
      ).toHaveCount(0);
    }
  });

  test('the same incident is readable to both roles', async ({
    authenticatedPage,
    viewerPage,
  }) => {
    await expect(
      authenticatedPage.getByText(fixture.address).first(),
    ).toBeVisible({ timeout: 15_000 });

    await expect(viewerPage.getByText(fixture.address).first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test('the incident detail is editable for an editor and read-only for a viewer', async ({
    authenticatedPage,
    viewerPage,
  }) => {
    // --- Editor: components/kanban/operation-detail-content.tsx with canEdit ---
    await expect(
      authenticatedPage.getByText(fixture.address).first(),
    ).toBeVisible({ timeout: 15_000 });
    await dismissOverlays(authenticatedPage);
    await authenticatedPage.getByText(fixture.address).first().click();

    const editorDialog = authenticatedPage.locator('[role="dialog"]:visible').first();
    await expect(editorDialog).toBeVisible({ timeout: 10_000 });
    await expect(
      editorDialog.getByRole('button', { name: 'Löschen', exact: true }),
    ).toBeVisible();
    await expect(
      editorDialog.getByRole('button', { name: 'Disponiert / Anfahrt' }),
    ).toBeVisible();
    await expect(
      editorDialog.getByRole('button', { name: 'Ressourcen übertragen' }),
    ).toBeVisible();
    await expect(editorDialog.locator('textarea').first()).toBeEditable();

    // --- Viewer: components/display/incident-detail-modal.tsx, no edit path ---
    await expect(viewerPage.getByText(fixture.address).first()).toBeVisible({
      timeout: 15_000,
    });
    await viewerPage.getByText(fixture.address).first().click();

    const viewerDialog = viewerPage.locator('[role="dialog"]:visible').first();
    await expect(viewerDialog).toBeVisible({ timeout: 10_000 });
    // Same data, no way to change it.
    await expect(viewerDialog).toContainText(fixture.address);
    await expect(
      viewerDialog.getByRole('button', { name: 'Löschen', exact: true }),
    ).toHaveCount(0);
    await expect(
      viewerDialog.getByRole('button', { name: 'Disponiert / Anfahrt' }),
    ).toHaveCount(0);
    await expect(
      viewerDialog.getByRole('button', { name: 'Ressourcen übertragen' }),
    ).toHaveCount(0);
    await expect(viewerDialog.locator('input, textarea, select')).toHaveCount(0);
  });
});
