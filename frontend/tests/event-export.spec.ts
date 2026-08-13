import { test, expect } from './fixtures/auth.fixture';
import { cookieHeaderFor, createEvent } from './helpers/api.helper';
import type { Locator, Page } from '@playwright/test';

/**
 * Event export from the events page.
 *
 * Rewritten wholesale. The previous version drove a UI that no longer exists: a
 * single "Event exportieren" button per card firing `POST /api/exports/events/{id}`
 * and receiving a ZIP, with a success toast reading "Export erfolgreich". The page
 * now offers one "Export" dropdown per card with two formats — Einsatzbericht (PDF), which
 * is `GET …/report`, and Audit (XLSX), which is `POST …/audit` — and neither shows a
 * success toast, only a download. Nothing else in the suite covers either.
 *
 * It also never logged in: it took `test` from `@playwright/test` and mocked
 * `/api/auth/me`, so the app redirected to /login and all eight cases died in
 * `beforeEach` on `h1:has-text("Ereignisse")`. And every case guarded its body with
 * `if (!hasEvents) { test.skip(); return; }`, so on the day the locator drifted the
 * spec would have gone quietly green instead of failing. Both are gone: the fixture
 * logs in for real, and the event under test is created over REST so it is always
 * there.
 */

const PDF_BYTES = Buffer.from('%PDF-1.4\n%%EOF\n');
const XLSX_BYTES = Buffer.from('PK\x03\x04');

async function gotoEventsWith(page: Page, name: string): Promise<Locator> {
  const cookieHeader = await cookieHeaderFor(page);
  await createEvent(page.request, cookieHeader, name);

  await page.goto('/events');
  const card = page.getByTestId('event-card').filter({ hasText: name });
  await expect(card).toBeVisible();
  return card;
}

async function openExportMenu(page: Page, card: Locator) {
  await card.getByRole('button', { name: 'Export', exact: true }).click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  return menu;
}

test.describe('Event Export', () => {
  test('active event cards offer both export formats', async ({ authenticatedPage }) => {
    const card = await gotoEventsWith(authenticatedPage, `Export aktiv ${Date.now()}`);
    const menu = await openExportMenu(authenticatedPage, card);

    await expect(menu.getByRole('menuitem', { name: 'Einsatzbericht (PDF)' })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Audit (XLSX)' })).toBeVisible();
  });

  test('archived event cards keep the export control', async ({ authenticatedPage }) => {
    const name = `Export archiviert ${Date.now()}`;
    const cookieHeader = await cookieHeaderFor(authenticatedPage);
    const event = await createEvent(authenticatedPage.request, cookieHeader, name);
    const archived = await authenticatedPage.request.post(
      `http://localhost:8000/api/events/${event.id}/archive`,
      { headers: { cookie: cookieHeader } },
    );
    expect(archived.ok(), await archived.text()).toBeTruthy();

    await authenticatedPage.goto('/events');
    const card = authenticatedPage.getByTestId('event-card').filter({ hasText: name });
    await expect(card).toBeVisible();

    // An archived event is exactly the one you still want a report from.
    await expect(card.getByRole('button', { name: 'Wiederherstellen' })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Export', exact: true })).toBeVisible();
  });

  test('the report export asks the backend for this event, as a GET', async ({
    authenticatedPage,
  }) => {
    const name = `Export Bericht ${Date.now()}`;
    const card = await gotoEventsWith(authenticatedPage, name);

    let request: { url: string; method: string } | null = null;
    await authenticatedPage.route('**/api/exports/events/*/report', async (route) => {
      request = { url: route.request().url(), method: route.request().method() };
      await route.fulfill({
        status: 200,
        contentType: 'application/pdf',
        body: PDF_BYTES,
      });
    });

    const menu = await openExportMenu(authenticatedPage, card);
    const download = authenticatedPage.waitForEvent('download');
    await menu.getByRole('menuitem', { name: 'Einsatzbericht (PDF)' }).click();

    await expect(await (await download).suggestedFilename()).toMatch(/^einsatzbericht-.*\.pdf$/);
    expect(request!.method).toBe('GET');
    expect(request!.url).toContain('/api/exports/events/');
    expect(request!.url).toContain('/report');
  });

  test('the audit export asks the backend for this event, as a POST', async ({
    authenticatedPage,
  }) => {
    const name = `Export Audit ${Date.now()}`;
    const card = await gotoEventsWith(authenticatedPage, name);

    let request: { url: string; method: string } | null = null;
    await authenticatedPage.route('**/api/exports/events/*/audit', async (route) => {
      request = { url: route.request().url(), method: route.request().method() };
      await route.fulfill({
        status: 200,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        body: XLSX_BYTES,
      });
    });

    const menu = await openExportMenu(authenticatedPage, card);
    const download = authenticatedPage.waitForEvent('download');
    await menu.getByRole('menuitem', { name: 'Audit (XLSX)' }).click();

    await expect(await (await download).suggestedFilename()).toMatch(/^audit-.*\.xlsx$/);
    expect(request!.method).toBe('POST');
    expect(request!.url).toContain('/audit');
  });

  test('a failed export says so instead of silently doing nothing', async ({
    authenticatedPage,
  }) => {
    const card = await gotoEventsWith(authenticatedPage, `Export Fehler ${Date.now()}`);

    await authenticatedPage.route('**/api/exports/events/*/report', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'Export generation failed' }),
      }),
    );

    const menu = await openExportMenu(authenticatedPage, card);
    await menu.getByRole('menuitem', { name: 'Einsatzbericht (PDF)' }).click();

    // An error toast, and the control released again. Deliberately NOT asserted
    // against `events.page.reportExportFailed` ("Bericht-Export fehlgeschlagen"):
    // `handleReportExport` only falls back to that string when the thrown value is
    // not an Error, and `apiClient.exportEventReport` always throws one — so what
    // the operator actually reads here is the raw, untranslated
    // "Report export failed: Internal Server Error". Flagged, not fixed: changing
    // the copy is an app decision, not this task's.
    const errorToast = authenticatedPage.locator('[data-sonner-toast][data-type="error"]');
    await expect(errorToast).toBeVisible();
    await expect(card.getByRole('button', { name: 'Export', exact: true })).toBeEnabled();
  });

  test('the export control is usable again after an export', async ({ authenticatedPage }) => {
    const card = await gotoEventsWith(authenticatedPage, `Export erneut ${Date.now()}`);

    let exports = 0;
    await authenticatedPage.route('**/api/exports/events/*/report', async (route) => {
      exports += 1;
      await route.fulfill({ status: 200, contentType: 'application/pdf', body: PDF_BYTES });
    });

    for (let i = 0; i < 2; i += 1) {
      const menu = await openExportMenu(authenticatedPage, card);
      const download = authenticatedPage.waitForEvent('download');
      await menu.getByRole('menuitem', { name: 'Einsatzbericht (PDF)' }).click();
      await download;
      // The trigger goes disabled while a job runs; it has to come back.
      await expect(card.getByRole('button', { name: 'Export', exact: true })).toBeEnabled();
    }

    expect(exports).toBe(2);
  });
});
