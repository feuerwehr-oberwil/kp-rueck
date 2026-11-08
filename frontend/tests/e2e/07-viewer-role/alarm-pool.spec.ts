import { test, expect } from '../../fixtures/auth.fixture';
import { API_BASE, cookieHeaderFor, dismissOverlays, expectBouncedToDisplayBoard, selectEvent } from './viewer-role.helpers';
import { createEvent } from '../../helpers/api.helper';

/**
 * The Alarmeingang — a sheet over the board, not a page (owner, 08.11.2026).
 *
 * The old `/divera-pool` address still arrives: it opens the sheet over the board. An editor
 * attaches an alarm from its row and sees the card appear on the board behind the still open
 * sheet; Esc closes it, the header's inbox icon brings it back. The role gate is still
 * `ProtectedRoute`'s redirect: a viewer never gets there.
 */

test.describe('Viewer role — the Alarmeingang', () => {
  test('an editor attaches an alarm from the sheet over the board, a viewer is bounced', async ({
    authenticatedPage: page,
    viewerPage,
  }) => {
    const cookie = await cookieHeaderFor(page);
    const headers = { cookie };
    const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const event = await createEvent(page.request, cookie, `Alarmeingang ${stamp}`, { training_flag: false });

    // One provider-neutral alarm through the real webhook.
    let { secret } = (await (await page.request.get(`${API_BASE}/api/settings/alarm-webhook-secret`, { headers })).json()) as {
      secret: string | null;
    };
    if (!secret) {
      ({ secret } = (await (
        await page.request.post(`${API_BASE}/api/settings/alarm-webhook-secret/rotate`, { headers })
      ).json()) as { secret: string });
    }
    const title = `Wasser im Keller ${stamp}`;
    const street = `Alarmweg ${stamp}`;
    const posted = await page.request.post(`${API_BASE}/api/alarms?secret=${secret}`, {
      data: { source: 'elz', source_id: `e2e-${stamp}`, title, address: `${street}, 4104 Oberwil` },
    });
    expect(posted.ok(), await posted.text()).toBeTruthy();

    await selectEvent(page, '/divera-pool', event.id);
    await page.waitForURL((url) => url.pathname === '/', { timeout: 15_000 });
    await dismissOverlays(page);
    const sheet = page.getByRole('dialog', { name: 'Alarmeingang' });
    await expect(sheet).toBeVisible();

    await sheet.getByRole('button', { name: `«${title}» anhängen` }).click();
    const dialog = page.getByRole('dialog', { name: 'An Ereignis anhängen' });
    await expect(dialog.getByRole('combobox')).toContainText(event.name);
    await dialog.getByRole('button', { name: 'Anhängen' }).click();

    await expect(page.getByTestId('incident-card').filter({ hasText: street })).toBeVisible({ timeout: 15_000 });
    await expect(sheet.getByRole('region', { name: /^Heute zugewiesen/ }).getByText(title)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await page.getByRole('button', { name: /^Alarmeingang –/ }).click();
    await expect(sheet).toBeVisible();

    await expectBouncedToDisplayBoard(viewerPage, '/divera-pool');
  });
});
