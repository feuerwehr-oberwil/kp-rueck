import { test, expect } from '../../fixtures/auth.fixture';
import type { Page } from '@playwright/test';
import { MOBILE_VIEWPORT, checkInForEvent, createPersonnel } from '../../helpers/api.helper';
import {
  API_BASE,
  cookieHeaderFor,
  createEventWithIncident,
  dismissOverlays,
  selectEvent,
  type BoardFixture,
} from './viewer-role.helpers';

/**
 * Viewer role — the phone shell (owner pick 4A, phone sweep 24.11.2026).
 *
 * On a phone a viewer gets the editor's phone shell – the Ereignis pill, search, the phone
 * cards and their sheet, the bottom tiles – read only (lib/role-home.ts). Every control that
 * writes is asserted on the editor first and absent for the viewer second (see board.spec.ts
 * for why a lone absence proves nothing). Over the whole walk the viewer's session must send
 * no write request and meet no refusal: a control the gate missed shows up there even if its
 * name changed.
 */

/** The bar is the navigation landmark that holds «Mehr». */
const bottomNav = (page: Page) =>
  page.getByRole('navigation').filter({ has: page.getByRole('button', { name: 'Mehr Optionen' }) });

const eventPill = (page: Page) => page.getByRole('button', { name: /^Ereignis .* – Menü$/ });

const ROUTE_COMPILE_MS = 15_000;

/** An API path, direct or through the production proxy (`/backend-api/api/…`, lib/env.ts). */
const apiPath = (url: string) => {
  const { pathname } = new URL(url);
  return pathname.includes('/api/') ? pathname : null;
};

/** Every API write the page sends, and every request the API refuses it (401/403). The
 *  session's own bootstrap (`/api/auth/…`: local login, refresh) is not a write to the board. */
function watchApi(page: Page) {
  const writes: string[] = [];
  const refused: string[] = [];
  page.on('request', (request) => {
    const path = apiPath(request.url());
    if (path && !path.includes('/api/auth/') && request.method() !== 'GET') writes.push(`${request.method()} ${path}`);
  });
  page.on('response', (response) => {
    const path = apiPath(response.url());
    if (path && !path.includes('/api/auth/') && [401, 403].includes(response.status())) {
      refused.push(`${response.status()} ${path}`);
    }
  });
  return { writes, refused };
}

/** Open the «Mehr» sheet and return the names of its entries. */
async function moreEntries(page: Page) {
  await bottomNav(page).getByRole('button', { name: 'Mehr Optionen' }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('heading', { name: 'Schnellzugriff' })).toBeVisible();
  const names = await sheet.locator('button, a').filter({ hasNotText: /^$/ }).allTextContents();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  return names.map((name) => name.trim());
}

test.describe('Viewer role — the phone shell', () => {
  let fixture: BoardFixture;

  test.beforeEach(async ({ authenticatedPage, viewerPage, request }) => {
    // An Übung, so the editor's «Mehr» carries the Übungs-Steuerung.
    const cookie = await cookieHeaderFor(authenticatedPage);
    fixture = await createEventWithIncident(request, cookie, 'Phone Viewer');
    // Somebody checked in: the Personal sheet lists them, and only a non-empty list offers
    // «Dienstzeiten» (mobile-personnel-sheet.tsx).
    const person = await createPersonnel(request, cookie, `Viewer Shell ${Date.now()}`);
    await checkInForEvent(request, cookie, person.id, fixture.eventId);
    await authenticatedPage.setViewportSize(MOBILE_VIEWPORT);
    await viewerPage.setViewportSize(MOBILE_VIEWPORT);
  });

  test('a phone viewer gets the phone board, read only, and sends no write', { tag: '@smoke' }, async ({
    authenticatedPage: editor,
    viewerPage: viewer,
  }) => {
    // Both roles through every phone surface, each on a cold `next dev` route.
    test.setTimeout(120_000);
    const api = watchApi(viewer);
    await selectEvent(editor, '/', fixture.eventId);
    await selectEvent(viewer, '/', fixture.eventId);

    // --- The board: the same list, no intake, «Nur Ansicht» ---
    await expect(editor.getByRole('button', { name: 'Neuer Einsatz' })).toBeVisible({ timeout: ROUTE_COMPILE_MS });
    await expect(editor.getByText('Nur Ansicht')).toHaveCount(0);
    // The card's heading: its address also sits in the card's sr-only «Details anzeigen» opener.
    const card = viewer.getByRole('heading', { name: new RegExp(fixture.address) }).first();
    await expect(card).toBeVisible({ timeout: ROUTE_COMPILE_MS });
    expect(new URL(viewer.url()).pathname).toBe('/');
    await expect(viewer.getByText('Nur Ansicht')).toBeVisible();
    await expect(viewer.getByRole('button', { name: 'Neuer Einsatz' })).toHaveCount(0);
    await expect(viewer.getByPlaceholder(/suchen/i).first()).toBeVisible();
    await dismissOverlays(viewer);
    // The desk's board keys are an editor's: «N» would open «Neuer Einsatz», «T» Links & QR.
    await viewer.keyboard.press('n');
    await viewer.keyboard.press('t');
    await expect(viewer.getByRole('dialog')).toHaveCount(0);

    // --- The detail sheet: the data, nothing to change it with ---
    await card.click();
    const detail = viewer.getByRole('dialog');
    await expect(detail).toContainText(fixture.address);
    await expect(detail.locator('input, textarea, select, [role="combobox"]')).toHaveCount(0);
    await viewer.keyboard.press('Escape');
    await expect(viewer.getByRole('dialog')).toHaveCount(0);

    // --- The pill: switch, Alle Ereignisse, Hilfe, Abmelden – no Einstellungen ---
    await eventPill(editor).click();
    await expect(editor.getByRole('menuitem', { name: 'Einstellungen' })).toBeVisible();
    await editor.keyboard.press('Escape');
    await eventPill(viewer).click();
    const menu = viewer.getByRole('menu');
    for (const entry of ['Alle Ereignisse', 'Hilfe', 'Abmelden']) {
      await expect(menu.getByRole('menuitem', { name: entry })).toBeVisible();
    }
    await expect(menu.getByRole('menuitem', { name: 'Einstellungen' })).toHaveCount(0);
    await viewer.keyboard.press('Escape');

    // --- «Mehr»: the editor's writing sheets are not the viewer's ---
    const writing = ['Links & QR', 'Fahrzeuge', 'Drucken', 'Übungs-Steuerung'];
    const editorMore = await moreEntries(editor);
    for (const name of writing) expect(editorMore).toContain(name);
    const viewerMore = await moreEntries(viewer);
    for (const name of writing) expect(viewerMore).not.toContain(name);
    expect(viewerMore).toEqual(expect.arrayContaining(['Verlauf', 'Kennzahlen']));

    // The Verlauf: the editor writes a line in it, the viewer reads.
    for (const [page, lines] of [[editor, 1], [viewer, 0]] as const) {
      await bottomNav(page).getByRole('button', { name: 'Mehr Optionen' }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Verlauf' }).click();
      const journal = page.getByRole('dialog', { name: /Verlauf/ });
      await expect(journal).toBeVisible();
      // The composer is an <Input> labelled «Neuer Eintrag im Verlauf» (journal-sheet.tsx).
      await expect(journal.getByRole('textbox', { name: 'Neuer Eintrag im Verlauf' })).toHaveCount(lines);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
    }

    // --- Personal → Dienstzeiten, and Meldungen: lists, no Alarmeingang ---
    await bottomNav(viewer).getByRole('button', { name: 'Personal' }).click();
    const personnel = viewer.getByRole('dialog', { name: 'Personal' });
    await expect(personnel).toBeVisible();
    await personnel.getByRole('button', { name: 'Dienstzeiten' }).click();
    await expect(viewer.getByRole('dialog', { name: /Dienstzeiten/ })).toBeVisible();
    await viewer.keyboard.press('Escape');
    await expect(viewer.getByRole('dialog')).toHaveCount(0);

    await bottomNav(editor).getByRole('button', { name: /^Meldungen/ }).click();
    await expect(editor.getByRole('dialog', { name: 'Meldungen' }).getByRole('button', { name: /Alarmeingang/ })).toBeVisible();
    await bottomNav(viewer).getByRole('button', { name: /^Meldungen/ }).click();
    const meldungen = viewer.getByRole('dialog', { name: 'Meldungen' });
    await expect(meldungen).toBeVisible();
    // (dismiss and «Gesehen» need a live entry: phone-notification-sheet.test.tsx holds those)
    await expect(meldungen.getByRole('button', { name: /Alarmeingang/ })).toHaveCount(0);
    await viewer.keyboard.press('Escape');

    // --- The Lagekarte and «Alle Ereignisse» are the viewer's too ---
    await bottomNav(viewer).locator('a[href="/map"]').click();
    await expect(viewer).toHaveURL('/map', { timeout: ROUTE_COMPILE_MS });
    await expect(viewer.getByText(fixture.address).first()).toBeVisible({ timeout: ROUTE_COMPILE_MS });
    await viewer.goto('/events');
    await expect(viewer.getByRole('heading', { level: 1, name: 'Ereignisse' })).toBeVisible({ timeout: ROUTE_COMPILE_MS });
    await expect(viewer.getByRole('button', { name: /Neues Ereignis/ })).toHaveCount(0);
    // A row's ⋯ keeps the Kennzahlen; the exports are an editor's (CurrentEditor).
    await viewer.getByRole('button', { name: 'Aktionen' }).first().click();
    await expect(viewer.getByRole('menuitem', { name: /Kennzahlen|Übungsauswertung/ })).toBeVisible();
    await expect(viewer.getByRole('menuitem', { name: /PDF|XLSX/ })).toHaveCount(0);
    await viewer.keyboard.press('Escape');

    expect(api.writes, 'a phone viewer sends no write').toEqual([]);
    expect(api.refused, 'nothing a phone viewer opens is refused').toEqual([]);
  });

  test('a phone viewer off its pages lands on the phone board', async ({ viewerPage: viewer }) => {
    await selectEvent(viewer, '/settings', fixture.eventId);
    await viewer.waitForURL((url) => url.pathname === '/', { timeout: ROUTE_COMPILE_MS });
    for (const path of ['/training', '/divera-pool']) {
      await viewer.goto(path);
      await viewer.waitForURL((url) => url.pathname === '/', { timeout: ROUTE_COMPILE_MS });
    }
    await expect(viewer.getByText('Nur Ansicht')).toBeVisible();

    // Wider than a phone, the same account is the wall's again.
    await viewer.setViewportSize({ width: 1280, height: 800 });
    await viewer.waitForURL('**/display/board', { timeout: ROUTE_COMPILE_MS });
  });

  test('the QR viewer link opens its board on a phone, with worded tabs and the search', async ({
    authenticatedPage: editor,
    browser,
  }) => {
    const link = await editor.request.post(`${API_BASE}/api/viewer/generate-link?event_id=${fixture.eventId}`, {
      headers: { cookie: await cookieHeaderFor(editor) },
    });
    expect(link.ok(), await link.text()).toBeTruthy();
    const { token } = (await link.json()) as { token: string };

    // No login: the token is the only key.
    const context = await browser.newContext({ viewport: MOBILE_VIEWPORT });
    const phone = await context.newPage();
    const api = watchApi(phone);
    await phone.goto(`/display?token=${token}`);
    await phone.waitForURL((url) => url.pathname === '/display/board', { timeout: ROUTE_COMPILE_MS });
    expect(new URL(phone.url()).searchParams.get('token')).toBe(token);

    const tabs = phone.getByRole('navigation', { name: 'Ansichten' });
    for (const word of ['Karte', 'Board', 'Status', 'Bereitschaft']) {
      await expect(tabs.getByRole('link', { name: word })).toBeVisible();
    }
    await expect(phone.getByText('Nur Ansicht')).toBeVisible();
    await expect(phone.getByText(fixture.address).first()).toBeVisible({ timeout: ROUTE_COMPILE_MS });
    // the search's own row below `lg` – the bar's field is hidden at this width
    await phone.getByPlaceholder('Suchen …').locator('visible=true').fill('kein solcher Einsatz');
    await expect(phone.getByText(fixture.address)).toHaveCount(0);

    // The name holds one line.
    const name = phone.getByRole('heading', { level: 1 });
    const { height, lineHeight } = await name.evaluate((el) => ({
      height: el.getBoundingClientRect().height,
      lineHeight: parseFloat(getComputedStyle(el).lineHeight),
    }));
    expect(height).toBeLessThanOrEqual(lineHeight + 1);

    expect(api.writes).toEqual([]);
    await context.close();
  });
});
