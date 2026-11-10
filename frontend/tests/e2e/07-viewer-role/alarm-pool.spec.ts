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
    // A live Ereignis with auto-attach on takes every fresh alarm, so this one would never be «neu».
    const ack = (await posted.json()) as { auto_attached_incident_id: string | null };
    if (ack.auto_attached_incident_id) {
      const all = (await (await page.request.get(`${API_BASE}/api/events/`, { headers })).json()) as {
        events: { name: string; training_flag: boolean; auto_attach_divera: boolean; archived_at: string | null }[];
      };
      const takers = all.events.filter((e) => e.auto_attach_divera && !e.training_flag && !e.archived_at).map((e) => e.name);
      expect(takers, 'a live Ereignis with Divera auto-attach takes the alarm').toEqual([]);
    }

    // The row's button attaches directly only once the selected Ereignis is restored; before
    // that it opens the dialog. So wait for that load, not just for the page.
    const eventRestored = page.waitForResponse((r) => r.url().endsWith(`/events/${event.id}`) && r.ok());
    await selectEvent(page, '/divera-pool', event.id);
    await eventRestored;
    await page.waitForURL((url) => url.pathname === '/', { timeout: 15_000 });
    await dismissOverlays(page);
    const sheet = page.getByRole('dialog', { name: 'Alarmeingang' });
    await expect(sheet).toBeVisible();

    // With an Ereignis selected the row's button attaches straight to it – no dialog in between.
    await sheet.getByRole('button', { name: `«${title}» anhängen` }).click();
    await expect(page.getByText(`Alarm an «${event.name}» angehängt`).first()).toBeVisible();

    await expect(page.getByTestId('incident-card').filter({ hasText: street })).toBeVisible({ timeout: 15_000 });
    await expect(sheet.getByRole('region', { name: /^Heute zugewiesen/ }).getByText(title)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await page.getByRole('button', { name: /^Alarmeingang –/ }).click();
    await expect(sheet).toBeVisible();

    await expectBouncedToDisplayBoard(viewerPage, '/divera-pool');
  });
});
