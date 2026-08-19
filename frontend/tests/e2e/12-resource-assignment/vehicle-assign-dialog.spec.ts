import { test, expect } from '../../fixtures/auth.fixture';
import { setupBoard } from '../../helpers/api.helper';

/**
 * The vehicle "Hinzufügen" in the incident detail opens the FULL assignment
 * dialog — the same one Mannschaft and Material use.
 *
 * It used to open an inline popover of the fleet instead: a second, poorer
 * vehicle picker without the driver info, «Zu Fuss» and the free/spoken-for
 * split, whose popper geometry kept colliding with the modal's close button
 * (the retired vehicle-assign-popover spec in this folder guarded exactly
 * those collisions). One picker, one behaviour.
 */

const VEHICLE_ADD_BUTTON = 'button[title="Fahrzeug zuweisen"]';

test.describe('Vehicle assignment from the incident detail', () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    await setupBoard(authenticatedPage, 'Vehicle Dialog');
    const card = authenticatedPage.locator('[data-testid="incident-card"]').first();
    await card.waitFor({ state: 'visible' });
    await card.click();
    await expect(detailModal(authenticatedPage)).toBeVisible();
    await expect(authenticatedPage.locator(VEHICLE_ADD_BUTTON)).toBeVisible();
  });

  test('"Hinzufügen" opens the full assignment dialog, not a popover', async ({
    authenticatedPage: page,
  }) => {
    await page.locator(VEHICLE_ADD_BUTTON).click();

    const dialog = page.getByRole('dialog', { name: 'Fahrzeuge zu Einsatz zuweisen' });
    await expect(dialog).toBeVisible();

    // «Zu Fuss» lives in the dialog — the not-a-vehicle choice travels with
    // the picker it belongs to.
    await expect(dialog.getByText('Zu Fuss', { exact: true })).toBeVisible();

    // And no popover is involved any more.
    expect(await page.locator('[data-slot="popover-content"]').count()).toBe(0);
  });
});

function detailModal(page: import('@playwright/test').Page) {
  return page
    .locator('[role="dialog"][data-slot="dialog-content"][data-state="open"]')
    .filter({ hasText: /Fahrzeuge \(\d+\)/ });
}
