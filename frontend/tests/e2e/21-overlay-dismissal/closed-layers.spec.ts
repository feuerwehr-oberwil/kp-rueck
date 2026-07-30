import { test, expect } from '../../fixtures/auth.fixture';
import { EventsPage } from '../../pages/events.page';
import { MainPage } from '../../pages/main.page';

/**
 * A dismissed modal layer must not outlive its dismissal.
 *
 * Radix keeps a closed layer mounted until its `animate-out` has finished, and
 * writes an unconditional inline `pointer-events: auto` onto the overlay
 * (react-dialog: `style: { pointerEvents: 'auto', ...overlayProps.style }`).
 * Measured on `main`: after closing any dialog, `dialog-overlay[data-state=closed]`
 * sat at 0,0 1280x720 — the whole viewport — with computed *and* inline
 * `pointer-events: auto` for ~150ms, and the operator's next click was lost.
 * A `data-[state=closed]:pointer-events-none` class cannot fix that; the inline
 * style wins. The exit keyframes were dropped instead, which makes
 * `animationName` resolve to `none` so Presence unmounts synchronously.
 *
 * These are pointer facts, so they are asserted with non-retrying counts and hit
 * tests — an auto-retrying assertion would simply wait the bug away.
 */

async function openBoard(page: import('@playwright/test').Page, tag: string) {
  const eventsPage = new EventsPage(page);
  await eventsPage.goto();
  await eventsPage.createEvent(`Overlay Event ${tag}`);
  await eventsPage.goto();
  await eventsPage.selectEvent(`Overlay Event ${tag}`);
  await expect(page).toHaveURL('/');
  return new MainPage(page);
}

test.describe('Dismissed modal layers', () => {
  test('a closed dialog leaves no overlay behind, and the next click lands', async ({
    authenticatedPage: page,
  }) => {
    const mainPage = await openBoard(page, `A${Date.now()}`);

    const trigger = page.locator('button:has-text("Neuer Einsatz")').first();
    await trigger.waitFor({ state: 'visible' });
    const box = await trigger.boundingBox();
    expect(box).not.toBeNull();
    const x = box!.x + box!.width / 2;
    const y = box!.y + box!.height / 2;

    await mainPage.openIncidentModal();
    await mainPage.incidentModal.locator('[data-slot="dialog-close"]').click();

    // Non-retrying: the closed overlay used to be here for the length of its
    // exit animation.
    expect(await page.locator('[data-slot="dialog-overlay"]').count()).toBe(0);
    expect(await page.locator('[data-slot="dialog-content"]').count()).toBe(0);

    // And nothing owns the top of the screen but the app itself. y=30 is the
    // header strip, which sits under the overlay's z-50.
    const ownerOfHeader = await page.evaluate(() =>
      document.elementFromPoint(640, 30)?.closest('[data-slot="dialog-overlay"]')
        ? 'dialog-overlay'
        : 'app',
    );
    expect(ownerOfHeader).toBe('app');

    // page.mouse.click, not locator.click: a locator click retries until the
    // target is hittable, which papers over exactly the swallowed click this
    // test exists to catch. One click, one chance.
    await page.mouse.click(x, y);
    await expect(mainPage.incidentModal).toBeVisible();
  });

  test('a closed confirm dialog leaves no overlay over the modal beneath it', async ({
    authenticatedPage: page,
  }) => {
    const tag = `B${Date.now()}`;
    const mainPage = await openBoard(page, tag);
    await mainPage.createIncident(`${tag}strasse 1, Basel`);

    const card = page.locator('[data-testid="incident-card"]').first();
    await card.waitFor({ state: 'visible' });
    await card.click();
    const detail = page.locator('[data-slot="dialog-content"][data-state="open"]');
    await expect(detail).toBeVisible();

    await detail.getByRole('button', { name: 'Löschen', exact: true }).first().click();
    const confirm = page.locator('[role="alertdialog"]');
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Abbrechen' }).click();

    // The AlertDialog overlay is `DialogPrimitive.Overlay` too, and it covered
    // the whole viewport — including the detail modal the operator is still in.
    expect(await page.locator('[data-slot="alert-dialog-overlay"]').count()).toBe(0);
    expect(await page.locator('[data-slot="alert-dialog-content"]').count()).toBe(0);

    // The modal underneath survives the confirm being cancelled, and is usable
    // straight away: one click on its close button, no retry.
    await expect(detail).toBeVisible();
    const closeBox = await detail.locator('[data-slot="dialog-close"]').first().boundingBox();
    expect(closeBox).not.toBeNull();
    await page.mouse.click(
      closeBox!.x + closeBox!.width / 2,
      closeBox!.y + closeBox!.height / 2,
    );
    expect(await page.locator('[data-slot="dialog-content"]').count()).toBe(0);
  });

  test('a closed sheet leaves no overlay behind', async ({ authenticatedPage: page }) => {
    // The "Mehr Optionen" sheet is the mobile bottom navigation's, so this one
    // assertion needs the phone viewport it is rendered for.
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/settings');

    const more = page.locator('button[aria-label="Mehr Optionen"]');
    await more.waitFor({ state: 'visible', timeout: 15000 });
    await more.click();
    await expect(page.locator('[data-slot="sheet-content"][data-state="open"]')).toBeVisible();

    await page.keyboard.press('Escape');

    expect(await page.locator('[data-slot="sheet-overlay"]').count()).toBe(0);
    expect(await page.locator('[data-slot="sheet-content"]').count()).toBe(0);
  });
});
