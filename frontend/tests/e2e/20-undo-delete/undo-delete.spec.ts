import { test, expect } from '../../fixtures/auth.fixture';
import { setupBoard } from '../../helpers/api.helper';

/**
 * Undo Incident Deletion (Plan 08)
 *
 * Covers the "Rückgängig" affordance: deleting an incident shows an undo toast
 * that restores the soft-deleted card via POST /api/incidents/{id}/restore.
 */

/** Create a fresh event, select it, and add one incident tagged for lookup. */
async function setupIncident(page: import('@playwright/test').Page, tag: string) {
  // The tag lives in the street name so it survives home-city display formatting.
  const board = await setupBoard(page, tag);
  const card = page
    .locator('[data-testid="incident-card"]')
    .filter({ hasText: board.address })
    .first();
  await expect(card).toBeVisible({ timeout: 8000 });
  return card;
}

async function deleteViaCard(
  page: import('@playwright/test').Page,
  card: import('@playwright/test').Locator,
) {
  await card.click();
  const detail = page.locator('[role="dialog"]');
  await expect(detail).toBeVisible();
  // `exact`, because the detail modal also carries a disabled "Standort löschen"
  // and a substring match picked that one — invisible for as long as this suite
  // was skipped.
  // No «wirklich löschen?» any more: the click deletes, the toast is the way back.
  await detail.getByRole('button', { name: 'Löschen', exact: true }).first().click();
  await expect(page.locator('[role="alertdialog"]')).toHaveCount(0);
}

// Was skipped because setup needed a created incident and the board's "Neuer
// Einsatz" modal keeps its submit button disabled until the typed address has been
// geocoded by the external geocoder. That is exactly the coordinate-free incident
// factory the old comment asked for: `setupBoard` posts the incident with its
// coordinates, so nothing here touches the geocoder and the suite runs again.
test.describe('Undo incident deletion', () => {
  test('delete shows the "Einsatz gelöscht" toast with a "Rückgängig" action', async ({ authenticatedPage }) => {
    const tag = `UndoA${Date.now()}`;
    const card = await setupIncident(authenticatedPage, tag);

    await deleteViaCard(authenticatedPage, card);

    // Card disappears
    await expect(authenticatedPage.locator('[data-testid="incident-card"]').filter({ hasText: tag })).toHaveCount(0);

    // Undo toast with the action button
    const toast = authenticatedPage.locator('[data-sonner-toast]').filter({ hasText: 'Einsatz gelöscht' });
    await expect(toast).toBeVisible({ timeout: 5000 });
    await expect(toast.getByRole('button', { name: 'Rückgängig' })).toBeVisible();
  });

  test('clicking "Rückgängig" restores the card and confirms', async ({ authenticatedPage }) => {
    const tag = `UndoB${Date.now()}`;
    const card = await setupIncident(authenticatedPage, tag);

    await deleteViaCard(authenticatedPage, card);

    const toast = authenticatedPage.locator('[data-sonner-toast]').filter({ hasText: 'Einsatz gelöscht' });
    await expect(toast).toBeVisible({ timeout: 5000 });
    await toast.getByRole('button', { name: 'Rückgängig' }).click();

    // Card reappears
    await expect(authenticatedPage.locator('[data-testid="incident-card"]').filter({ hasText: tag })).toBeVisible({
      timeout: 5000,
    });
    await expect(
      authenticatedPage.locator('[data-sonner-toast]').filter({ hasText: 'Einsatz wiederhergestellt' }),
    ).toBeVisible({ timeout: 5000 });
  });

  test('letting the toast expire keeps the incident deleted after reload', async ({ authenticatedPage: page }) => {
    const tag = `UndoC${Date.now()}`;
    const board = await setupBoard(page, tag, { count: 2 });
    const cards = page.locator('[data-testid="incident-card"]');
    const doomed = cards.filter({ hasText: `${board.address} 1` });
    const kept = cards.filter({ hasText: `${board.address} 2` });
    await expect(doomed).toBeVisible({ timeout: 8000 });

    await deleteViaCard(page, doomed);

    const toast = page.locator('[data-sonner-toast]').filter({ hasText: 'Einsatz gelöscht' });
    await expect(toast).toBeVisible({ timeout: 5000 });
    // A hovered toast intentionally stays open. Let the real display timer (6–10 s
    // at the default setting) and dismissal animation finish as they would at the board.
    await page.mouse.move(0, 0);
    await expect(toast).toBeHidden({ timeout: 15_000 });

    await page.reload();
    // The other card proves the board has loaded, so the absence below means something.
    await expect(kept).toBeVisible({ timeout: 8000 });
    await expect(doomed).toHaveCount(0);
  });
});
