import { writeFile } from 'node:fs/promises';
import { test, expect } from '../../fixtures/auth.fixture';
import type { Page } from '@playwright/test';
import { API_BASE, cookieHeaderFor } from '../../helpers/api.helper';

/**
 * Einstellungen: a general value is saved on blur and survives a reload; the
 * Excel import previews before it writes, and «Ersetzen» asks first.
 *
 * The import half never executes: the dev database is the user's own station,
 * and a spec that replaced its roster would be the most expensive test in the
 * suite. It stops at the question, which is the part this spec guards.
 *
 * Pinned before import and audit moved out of the settings page (2026-09-23).
 */

const SETTING = 'funkrufname';

async function readSetting(page: Page): Promise<string> {
  const response = await page.request.get(`${API_BASE}/api/settings/`, {
    headers: { cookie: await cookieHeaderFor(page) },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json())[SETTING] ?? '';
}

async function writeSetting(page: Page, value: string) {
  const response = await page.request.patch(`${API_BASE}/api/settings/${SETTING}`, {
    headers: { cookie: await cookieHeaderFor(page), 'Content-Type': 'application/json' },
    data: { value },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
}

async function personnelCount(page: Page): Promise<number> {
  const response = await page.request.get(`${API_BASE}/api/personnel/`, {
    headers: { cookie: await cookieHeaderFor(page) },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()).length;
}

test.describe('Allgemein', () => {
  let original: string;

  test.beforeEach(async ({ authenticatedPage: page }) => {
    original = await readSetting(page);
  });

  test.afterEach(async ({ authenticatedPage: page }) => {
    await writeSetting(page, original);
  });

  test('a changed value is saved on blur and is still there after a reload', async ({ authenticatedPage: page }) => {
    test.setTimeout(120_000);
    const value = `Omega ${Date.now() % 100000}`;
    await page.goto('/settings?section=general');
    const field = page.getByLabel('Funkrufname', { exact: true });
    // Generous: on a dev server the first visit compiles the whole settings page.
    await expect(field).toHaveValue(original, { timeout: 60_000 });

    await field.fill(value);
    await field.blur();
    await expect.poll(() => readSetting(page)).toBe(value);

    await page.reload();
    await expect(page.getByLabel('Funkrufname', { exact: true })).toHaveValue(value, { timeout: 20_000 });
  });
});

test.describe('Import', () => {
  test('previews the file, and «Ersetzen» asks before anything is deleted', async ({ authenticatedPage: page }, testInfo) => {
    test.setTimeout(120_000);
    // The station's own template is a valid workbook by definition.
    const template = await page.request.get(`${API_BASE}/api/admin/import/template`, {
      headers: { cookie: await cookieHeaderFor(page) },
    });
    expect(template.ok()).toBeTruthy();
    const file = testInfo.outputPath('kprueck_import_template.xlsx');
    await writeFile(file, await template.body());
    const before = await personnelCount(page);

    await page.goto('/settings?section=import');
    await expect(page.getByText('Import – Modus «Anhängen»')).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: /Ersetzen/, pressed: false }).click();
    await expect(page.getByText('Import – Modus «Ersetzen»')).toBeVisible();

    await page.locator('#file-upload').setInputFiles(file);
    await expect(page.getByText('kprueck_import_template.xlsx')).toBeVisible();
    await page.getByRole('button', { name: 'Vorschau anzeigen' }).click();
    await expect(page.getByText('Bilanz', { exact: true })).toBeVisible({ timeout: 20_000 });

    const replace = page.getByRole('button', { name: 'Bestand löschen und ersetzen' });
    if (await replace.isDisabled()) {
      // Another Ereignis on this database holds live assignments: the backend
      // would answer 409, and the page refuses up front, with the reason.
      await expect(replace).toHaveAttribute('title', /aktive Zuteilungen auf laufenden Einsätzen/);
    } else {
      await replace.click();
      const confirm = page.getByRole('alertdialog', { name: 'Datenimport ersetzen?' });
      await expect(confirm).toContainText('Gelöscht werden');
      await confirm.getByRole('button', { name: 'Abbrechen' }).click();
      await expect(confirm).toBeHidden();
    }
    expect(await personnelCount(page)).toBe(before);

    // Switching the mode drops the mode-specific preview.
    await page.getByRole('button', { name: /Anhängen/, pressed: false }).click();
    await expect(page.getByText('Bilanz', { exact: true })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Vorschau anzeigen' })).toBeEnabled();
  });
});
