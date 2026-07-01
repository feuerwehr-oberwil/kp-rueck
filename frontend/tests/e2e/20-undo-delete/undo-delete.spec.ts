import { test, expect } from '../../fixtures/auth.fixture';
import { EventsPage } from '../../pages/events.page';

/**
 * Undo Incident Deletion (Plan 08)
 *
 * Covers the "Rückgängig" affordance: deleting an incident shows an undo toast
 * that restores the soft-deleted card via POST /api/incidents/{id}/restore.
 */

async function createEventAndIncident(page: import('@playwright/test').Page, location: string) {
  const eventsPage = new EventsPage(page);
  const eventName = `Undo Test Event ${Date.now()}`;

  await eventsPage.goto();
  await eventsPage.createEvent(eventName);
  await eventsPage.goto();
  await eventsPage.selectEvent(eventName);
  await expect(page).toHaveURL('/');
  await page.waitForTimeout(1000);

  // Create an incident via quick mode
  await page.locator('button:has-text("Schnell")').click();
  const modal = page.locator('[role="dialog"]');
  await modal.locator('input[placeholder*="Adresse"]').fill(location);
  await modal.locator('button:has-text("Schnell erstellen")').click();

  // Wait for the card to render
  await page.waitForTimeout(1000);
  const card = page.locator('[data-testid="incident-card"]', { hasText: location });
  await expect(card).toBeVisible({ timeout: 5000 });
  return card;
}

async function deleteViaDetailModal(page: import('@playwright/test').Page, card: import('@playwright/test').Locator) {
  await card.click();
  const detail = page.locator('[role="dialog"]');
  await expect(detail).toBeVisible();
  await detail.locator('button:has-text("Löschen")').click();

  // Confirm in the AlertDialog
  const confirm = page.locator('[role="alertdialog"]');
  await expect(confirm).toBeVisible();
  await confirm.locator('button:has-text("Löschen")').click();
}

test.describe('Undo incident deletion', () => {
  test('delete shows the "Einsatz gelöscht" toast with a "Rückgängig" action', async ({ authenticatedPage }) => {
    const location = `Löschstrasse 1, Basel ${Date.now()}`;
    const card = await createEventAndIncident(authenticatedPage, location);

    await deleteViaDetailModal(authenticatedPage, card);

    // Card disappears
    await expect(authenticatedPage.locator('[data-testid="incident-card"]', { hasText: location })).toHaveCount(0);

    // Undo toast is shown with the action button
    const toast = authenticatedPage.locator('[data-sonner-toast]').filter({ hasText: 'Einsatz gelöscht' });
    await expect(toast).toBeVisible({ timeout: 5000 });
    await expect(toast.locator('button:has-text("Rückgängig")')).toBeVisible();
  });

  test('clicking "Rückgängig" restores the card and confirms', async ({ authenticatedPage }) => {
    const location = `Wiederstrasse 2, Basel ${Date.now()}`;
    const card = await createEventAndIncident(authenticatedPage, location);

    await deleteViaDetailModal(authenticatedPage, card);

    const toast = authenticatedPage.locator('[data-sonner-toast]').filter({ hasText: 'Einsatz gelöscht' });
    await expect(toast).toBeVisible({ timeout: 5000 });
    await toast.locator('button:has-text("Rückgängig")').click();

    // Card reappears in its column
    await expect(authenticatedPage.locator('[data-testid="incident-card"]', { hasText: location })).toBeVisible({
      timeout: 5000,
    });

    // Confirmation toast
    await expect(
      authenticatedPage.locator('[data-sonner-toast]').filter({ hasText: 'Einsatz wiederhergestellt' }),
    ).toBeVisible({ timeout: 5000 });
  });

  test('letting the toast expire keeps the incident deleted after reload', async ({ authenticatedPage }) => {
    const location = `Bleibtweg 3, Basel ${Date.now()}`;
    const card = await createEventAndIncident(authenticatedPage, location);

    await deleteViaDetailModal(authenticatedPage, card);

    const toast = authenticatedPage.locator('[data-sonner-toast]').filter({ hasText: 'Einsatz gelöscht' });
    await expect(toast).toBeVisible({ timeout: 5000 });

    // Let the 8s undo toast expire without clicking, then reload
    await authenticatedPage.waitForTimeout(9000);
    await authenticatedPage.reload();
    await authenticatedPage.waitForTimeout(1000);

    await expect(authenticatedPage.locator('[data-testid="incident-card"]', { hasText: location })).toHaveCount(0);
  });
});
