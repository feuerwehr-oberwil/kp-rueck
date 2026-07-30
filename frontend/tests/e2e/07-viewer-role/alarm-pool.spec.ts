import { test, expect } from '../../fixtures/auth.fixture';

/**
 * Viewer role — the alarm intake pool.
 *
 * Not one of the three surfaces the plan named, and included anyway, because it
 * is the only page in the app where a viewer actually executes an `isEditor`
 * branch: `/divera-pool` is not wrapped in `ProtectedRoute`, so the role reaches
 * it instead of being redirected. Everywhere else the gate that fires is the
 * redirect, and the ~130 `isEditor` call sites behind it never run for a viewer.
 *
 * Drop this file and the suite asserts a great deal about where a viewer cannot
 * go and nothing about what the role flag does when it is read.
 */

test.describe('Viewer role — alarm intake pool', () => {
  test('the pool is readable by both roles', async ({
    authenticatedPage,
    viewerPage,
  }) => {
    await authenticatedPage.goto('/divera-pool');
    await viewerPage.goto('/divera-pool');

    const heading = { name: 'Alarmeingang' };
    await expect(
      authenticatedPage.getByRole('heading', heading),
    ).toBeVisible({ timeout: 15_000 });
    await expect(viewerPage.getByRole('heading', heading)).toBeVisible({
      timeout: 15_000,
    });

    // No redirect: this page is outside ProtectedRoute.
    expect(new URL(viewerPage.url()).pathname).toBe('/divera-pool');

    // Both roles get the entry counter the page renders from the pool it just
    // loaded. Matched by shape rather than compared between the two pages: the
    // pool is shared state that a webhook can add to at any moment, and an
    // equality assertion there would be a race, not a check.
    const counter = /\d+ Einträge/;
    await expect(authenticatedPage.getByText(counter).first()).toBeVisible();
    await expect(viewerPage.getByText(counter).first()).toBeVisible();
  });

  test('only an editor can attach a pool entry to the event', async ({
    authenticatedPage,
    viewerPage,
  }) => {
    await authenticatedPage.goto('/divera-pool');
    await viewerPage.goto('/divera-pool');

    // app/divera-pool/page.tsx renders the attach button (and the per-row
    // selection checkboxes) behind `{isEditor && …}`. It is present but disabled
    // until rows are selected, which is why this asserts visibility, not enabled.
    const attach = { name: 'Anhängen' };
    await expect(authenticatedPage.getByRole('button', attach)).toBeVisible({
      timeout: 15_000,
    });

    await expect(viewerPage.getByRole('heading', { name: 'Alarmeingang' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(viewerPage.getByRole('button', attach)).toHaveCount(0);
  });
});
