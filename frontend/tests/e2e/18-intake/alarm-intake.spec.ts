import { test, expect } from '../../fixtures/auth.fixture';

/**
 * Alarm Intake Tests
 * The public, token-gated alarm form lets phone operators / walk-ins create
 * alarms without logging in. An editor generates the link; the resulting
 * incident is flagged source="intake" and shows a "Telefon" badge on the board.
 *
 * Event + link setup goes through the backend API (the shared EventsPage UI
 * helper is flaky in the dev stack); the public form itself is exercised in the
 * browser against the real backend.
 */

const BACKEND = 'http://localhost:8000';

test.describe('Alarm Intake - public token form', { tag: '@smoke' }, () => {
  test('editor link lets a walk-in submit an intake-flagged alarm', async ({ authenticatedPage }) => {
    // 1. Create an event and generate the alarm link via the authenticated API.
    const eventRes = await authenticatedPage.request.post(`${BACKEND}/api/events/`, {
      data: { name: `Alarm Intake Test ${Date.now()}`, training_flag: false, auto_attach_divera: false },
    });
    expect(eventRes.ok()).toBeTruthy();
    const event = await eventRes.json();

    const linkRes = await authenticatedPage.request.post(
      `${BACKEND}/api/intake/generate-link?event_id=${event.id}`
    );
    expect(linkRes.ok()).toBeTruthy();
    const { link } = await linkRes.json();
    expect(link).toContain('/alarm?token=');

    // 2. Open the public form (token-gated, renders the event context).
    await authenticatedPage.goto(link);
    await expect(authenticatedPage.getByRole('heading', { name: 'Alarm erfassen' })).toBeVisible();
    await expect(authenticatedPage.getByText(event.name)).toBeVisible();

    // 3. Fill the essentials and submit.
    // The field is labelled "Meldung" (intake.alarm.messageLabel) but its id is `title` and it
    // populates the incident's title — which is what the assertions below check. The label this
    // used to look for, "Titel / Einsatzbezeichnung", belongs to the Divera send dialog, so this
    // never matched the intake form at all. Priority and type default, and the submit button
    // only requires a non-empty message, so nothing else has to be filled.
    const alarmTitle = `Wohnungsbrand ${Date.now()}`;
    await authenticatedPage.getByLabel('Meldung *').fill(alarmTitle);
    await authenticatedPage.getByRole('button', { name: 'Alarm absenden' }).click();

    // 4. Confirmation screen with the "create another" affordance.
    await expect(authenticatedPage.getByRole('heading', { name: 'Alarm erfasst' })).toBeVisible({ timeout: 10000 });
    await expect(authenticatedPage.getByRole('button', { name: 'Weiteren Alarm erfassen' })).toBeVisible();

    // 5. The created incident is flagged as intake (verified via API).
    const incidentsRes = await authenticatedPage.request.get(
      `${BACKEND}/api/incidents/?event_id=${event.id}`
    );
    expect(incidentsRes.ok()).toBeTruthy();
    const incidents = await incidentsRes.json();
    const created = incidents.find((i: { title: string }) => i.title === alarmTitle);
    expect(created).toBeTruthy();
    expect(created.source).toBe('intake');
    expect(created.created_by).toBeNull();
    expect(created.status).toBe('incoming');

    // Cleanup.
    await authenticatedPage.request.delete(`${BACKEND}/api/events/${event.id}`);
  });

  test('invalid token shows an error instead of the form', async ({ authenticatedPage }) => {
    await authenticatedPage.goto('/alarm?token=not-a-valid-token');
    await expect(
      authenticatedPage.getByRole('heading', { name: 'Link ungültig oder abgelaufen' })
    ).toBeVisible({ timeout: 10000 });
    await expect(authenticatedPage.getByRole('button', { name: 'Alarm absenden' })).toHaveCount(0);
  });
});
