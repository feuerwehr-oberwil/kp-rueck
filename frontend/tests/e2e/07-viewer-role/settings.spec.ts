import { test, expect } from '../../fixtures/auth.fixture';
import { expectBouncedToDisplayBoard, VIEWER_LANDING } from './viewer-role.helpers';

/**
 * Viewer role — settings.
 *
 * `app/settings/page.tsx` is the densest `isEditor` surface in the app: the
 * section list is filtered by role, every input carries `disabled={!isEditor}`,
 * and `updateSetting` refuses non-editors outright. None of that runs for a
 * `viewer` — ProtectedRoute redirects the role away first — so what is worth
 * pinning down is that the redirect covers the deep links too, since
 * `activeSection` is read straight from `?section=` and is NOT filtered by the
 * role-aware `visibleSections`.
 *
 * The editor-side list deliberately names only `editorOnly` sections. Two more
 * (Synchronisation, Benutzer) are `adminOnly`, and the editor account differs
 * between CI (admin) and a local dev run (editor) — asserting on those would
 * pass in one environment and fail in the other.
 */

const EDITOR_ONLY_SECTIONS = [
  'Ausalarmierung',
  'Alarm-Eingang',
  'GPS',
  'Drucker',
  'Ausfallsicherheit',
  'Personal',
  'Fahrzeuge',
  'Material',
  'Import/Export',
  'Audit-Protokoll',
];

test.describe('Viewer role — settings', () => {
  test('settings open for an editor and are closed to a viewer', async ({
    authenticatedPage,
    viewerPage,
  }) => {
    await authenticatedPage.goto('/settings');
    await expect(
      authenticatedPage.getByRole('button', { name: 'Allgemein' }),
    ).toBeVisible({ timeout: 15_000 });
    expect(new URL(authenticatedPage.url()).pathname).toBe('/settings');

    await expectBouncedToDisplayBoard(viewerPage, '/settings');
  });

  test('the editor-only sections exist for an editor and reach no viewer', async ({
    authenticatedPage,
    viewerPage,
  }) => {
    await authenticatedPage.goto('/settings');
    const sidebar = authenticatedPage.locator('aside nav');
    await expect(sidebar).toBeVisible({ timeout: 15_000 });

    for (const section of EDITOR_ONLY_SECTIONS) {
      await expect(
        sidebar.getByRole('button', { name: section, exact: true }),
      ).toBeVisible();
    }

    await viewerPage.goto('/settings');
    await viewerPage.waitForURL(`**${VIEWER_LANDING}`, { timeout: 15_000 });
    for (const section of EDITOR_ONLY_SECTIONS) {
      await expect(
        viewerPage.getByRole('button', { name: section, exact: true }),
      ).toHaveCount(0);
    }
  });

  test('deep-linking a settings section does not let a viewer in', async ({
    authenticatedPage,
    viewerPage,
  }) => {
    // `personnel` and `audit` are editorOnly, `users` is adminOnly, `general` is
    // open to everyone who can render the page at all. Each is a real section id
    // in SECTIONS, and `activeSection` accepts any of them from the URL.
    for (const section of ['general', 'personnel', 'audit', 'users']) {
      await expectBouncedToDisplayBoard(viewerPage, `/settings?section=${section}`);
    }

    // The editor half: the same deep link is a working route, so the absence
    // above is the role and not a dead URL.
    await authenticatedPage.goto('/settings?section=personnel');
    await expect(
      authenticatedPage.locator('aside nav').getByRole('button', {
        name: 'Personal',
        exact: true,
      }),
    ).toBeVisible({ timeout: 15_000 });
    expect(new URL(authenticatedPage.url()).pathname).toBe('/settings');
    expect(new URL(authenticatedPage.url()).searchParams.get('section')).toBe(
      'personnel',
    );
  });
});
