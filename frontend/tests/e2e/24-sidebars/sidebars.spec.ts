import { test, expect } from '../../fixtures/auth.fixture';
import type { Page } from '@playwright/test';
import {
  assignPersonnel,
  assignResource,
  checkInForEvent,
  cookieHeaderFor,
  createPersonnel,
  deleteEvent,
  deletePersonnel,
  listMaterials,
  setupBoard,
  type BoardFixture,
  type TestMaterial,
  type TestPersonnel,
} from '../../helpers/api.helper';

/**
 * The two resource sidebars: Personal on the left, Material on the right.
 *
 * - Personal lists who is checked in, «Frei» above «Gebunden»; its search and
 *   «Nur Verfügbare» narrow the list, and a search that hides everybody says so
 *   and offers the way back.
 * - `[` and `]` fold the sidebars away, and the fold is per-device memory: a
 *   reload does not undo it.
 * - Identical devices in one depot are ONE row with a free/total count.
 *
 * Pinned before the sidebars moved out of `app/page.tsx` (2026-09-23).
 */

test.use({ viewport: { width: 1920, height: 1080 } });

let board: BoardFixture;
let free: TestPersonnel;
let bound: TestPersonnel;
let stamp: string;

const personnelSidebar = (page: Page) => page.locator('aside').filter({ has: page.locator('#personnel-search-input') });
const materialSidebar = (page: Page) => page.locator('aside').filter({ has: page.locator('#material-search-input') });

test.beforeEach(async ({ authenticatedPage: page }) => {
  board = await setupBoard(page, 'Leisten');
  const cookieHeader = await cookieHeaderFor(page);
  stamp = `${Date.now()}`;
  free = await createPersonnel(page.request, cookieHeader, `Frei ${stamp}`);
  bound = await createPersonnel(page.request, cookieHeader, `Gebunden ${stamp}`);
  await checkInForEvent(page.request, cookieHeader, free.id, board.eventId);
  await checkInForEvent(page.request, cookieHeader, bound.id, board.eventId);
  await assignPersonnel(page.request, cookieHeader, board.incidents[0].id, bound.id);
  await expect(personnelSidebar(page).getByTitle(bound.name, { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(personnelSidebar(page).getByTitle(free.name, { exact: true })).toBeVisible();
});

test.afterEach(async ({ authenticatedPage: page }) => {
  const cookieHeader = await cookieHeaderFor(page);
  await deleteEvent(page.request, cookieHeader, board.eventId);
  await deletePersonnel(page.request, cookieHeader, free.id);
  await deletePersonnel(page.request, cookieHeader, bound.id);
});

test('Personal: free above bound, and the search narrows — or says why nothing is left', async ({
  authenticatedPage: page,
}) => {
  const sidebar = personnelSidebar(page);
  await expect(sidebar.getByRole('heading', { name: 'Frei · 1' })).toBeVisible();
  await expect(sidebar.getByRole('heading', { name: 'Gebunden · 1' })).toBeVisible();

  const search = page.locator('#personnel-search-input');
  await search.fill(`Frei ${stamp}`);
  await expect(sidebar.getByTitle(free.name, { exact: true })).toBeVisible();
  await expect(sidebar.getByTitle(bound.name, { exact: true })).toHaveCount(0);
  await expect(sidebar).toContainText('1 von 2 sichtbar');

  await search.fill(`niemand-${stamp}`);
  await expect(sidebar).toContainText(`Keine Person passt zu «niemand-${stamp}»`);
  await sidebar.getByRole('button', { name: 'Suche zurücksetzen' }).click();
  await expect(search).toHaveValue('');
  await expect(sidebar.getByTitle(bound.name, { exact: true })).toBeVisible();
});

test('Personal: «Nur Verfügbare» hides the bound, and toggles back', async ({ authenticatedPage: page }) => {
  const sidebar = personnelSidebar(page);
  const toggle = sidebar.getByRole('button', { name: 'Nur Verfügbare zeigen' });
  await toggle.click();
  await expect(sidebar.getByRole('button', { name: 'Alle zeigen' })).toHaveAttribute('aria-pressed', 'true');
  await expect(sidebar.getByTitle(free.name, { exact: true })).toBeVisible();
  await expect(sidebar.getByTitle(bound.name, { exact: true })).toHaveCount(0);

  await sidebar.getByRole('button', { name: 'Alle zeigen' }).click();
  await expect(sidebar.getByTitle(bound.name, { exact: true })).toBeVisible();
});

test('[ and ] fold the sidebars, and the fold survives a reload', async ({ authenticatedPage: page }) => {
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('[');
  await expect(page.locator('#personnel-search-input')).toHaveCount(0);
  await page.keyboard.press(']');
  await expect(page.locator('#material-search-input')).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole('heading', { name: /Leisten/ }).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(`[data-incident-id="${board.incidents[0].id}"]`)).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('#personnel-search-input')).toHaveCount(0);
  await expect(page.locator('#material-search-input')).toHaveCount(0);

  // The reopen tabs bring them back, and that is remembered too.
  await page.getByRole('button', { name: 'Linke Seitenleiste ein-/ausblenden' }).click();
  await page.getByRole('button', { name: 'Rechte Seitenleiste ein-/ausblenden' }).click();
  await expect(page.locator('#personnel-search-input')).toBeVisible();
  await expect(page.locator('#material-search-input')).toBeVisible();
});

test('Material: identical devices in one depot are one counted row', async ({ authenticatedPage: page }) => {
  const cookieHeader = await cookieHeaderFor(page);
  // Find a bundle in the seeded depot list instead of hard-coding one.
  const units = new Map<string, TestMaterial[]>();
  for (const m of await listMaterials(page.request, cookieHeader)) {
    if (m.consumable || m.group_id || m.out_of_service) continue;
    const key = `${m.location}\u0000${m.name}`;
    units.set(key, [...(units.get(key) ?? []), m]);
  }
  const bundle = [...units.values()].find((list) => list.length >= 2);
  expect(bundle, 'the dev depot needs two identical devices in one place').toBeTruthy();
  const [first] = bundle!;
  const total = bundle!.length;

  const depot = materialSidebar(page)
    .locator('h3', { hasText: first.location })
    .locator('xpath=..');
  const row = depot.locator('[role="button"]', { hasText: first.name }).filter({ hasText: `/${total}` });
  await expect(row).toHaveText(new RegExp(`${total}/${total}`));
  await expect(row).toHaveCount(1);

  // One unit goes out: the same row counts it.
  await assignResource(page.request, cookieHeader, board.incidents[0].id, 'material', first.id);
  await expect(row).toHaveText(new RegExp(`${total - 1}/${total}`), { timeout: 20_000 });
});
