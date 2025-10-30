import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Screenshot Capture for Help Documentation
 *
 * This script captures screenshots of the application for use in help documentation.
 * Screenshots are saved to: frontend/public/help/images/
 *
 * Run with: pnpm test tests/capture-help-screenshots.spec.ts
 */

// Ensure screenshot directory exists
const screenshotDir = path.join(__dirname, '../public/help/images');
if (!fs.existsSync(screenshotDir)) {
  fs.mkdirSync(screenshotDir, { recursive: true });
}

// Helper function to login
async function login(page: Page) {
  await page.goto('/login');
  await page.waitForLoadState('networkidle');

  // Fill login form (using default seed data credentials)
  await page.fill('#username', 'admin');
  await page.fill('#password', 'changeme123');
  await page.click('button[type="submit"]');

  // Wait for redirect - should go to events page
  await page.waitForTimeout(2000);
  await page.waitForLoadState('networkidle');

  // If we're on events page, select the first event
  if (page.url().includes('/events')) {
    const selectButton = page.getByRole('button', { name: /auswählen/i }).first();
    if (await selectButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await selectButton.click();
      await page.waitForTimeout(1000);
      await page.waitForLoadState('networkidle');
    }
  }
}

test.describe('Help Documentation Screenshot Capture', () => {
  test.use({
    viewport: { width: 1920, height: 1080 },
    locale: 'de-DE',
  });

  test.beforeEach(async ({ page }) => {
    // Login first
    await login(page);

    // Navigate to home page
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000); // Allow animations to complete
  });

  test('01 - Interface Overview (Kanban Dashboard)', async ({ page }) => {
    await page.waitForSelector('.flex.h-screen', { timeout: 10000 });

    // Make sure we have some data visible
    await expect(page.locator('.font-bold.text-base').first()).toBeVisible();

    await page.screenshot({
      path: path.join(screenshotDir, 'interface-overview.png'),
      fullPage: false,
    });
  });

  test('02 - Kanban Board Close-up', async ({ page }) => {
    // Focus on the main kanban area (without sidebars)
    const kanbanBoard = page.locator('main').first();
    await expect(kanbanBoard).toBeVisible();

    await kanbanBoard.screenshot({
      path: path.join(screenshotDir, 'kanban-board.png'),
    });
  });

  test('03 - Status Columns Explained', async ({ page }) => {
    // Capture the column headers
    const columns = page.getByText('Einsätze').locator('..').first();
    await expect(columns).toBeVisible();

    await columns.screenshot({
      path: path.join(screenshotDir, 'status-columns.png'),
    });
  });

  test('04 - Personnel Sidebar', async ({ page }) => {
    // Capture left sidebar with personnel
    const personnelSidebar = page.locator('aside').first();
    await expect(personnelSidebar).toBeVisible();

    await personnelSidebar.screenshot({
      path: path.join(screenshotDir, 'personnel-sidebar.png'),
    });
  });

  test('05 - Materials Sidebar', async ({ page }) => {
    // Capture right sidebar with materials
    const materialsSidebar = page.locator('aside').last();
    await expect(materialsSidebar).toBeVisible();

    await materialsSidebar.screenshot({
      path: path.join(screenshotDir, 'materials-sidebar.png'),
    });
  });

  test('06 - Create New Incident Dialog', async ({ page }) => {
    // Click new incident button (look for Plus icon)
    const newButton = page.getByRole('button', { name: /neu/i }).first();

    if (await newButton.isVisible()) {
      await newButton.click();
      await page.waitForTimeout(500);

      // Capture the dialog
      const dialog = page.locator('[role="dialog"]').first();
      if (await dialog.isVisible()) {
        await dialog.screenshot({
          path: path.join(screenshotDir, 'create-incident-dialog.png'),
        });

        // Close dialog
        await page.keyboard.press('Escape');
      }
    }
  });

  test('07 - Map View', async ({ page }) => {
    // Navigate to map view
    await page.goto('/map');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000); // Wait for map to load

    // Wait for map container
    await page.waitForSelector('.leaflet-container', { timeout: 10000 });

    await page.screenshot({
      path: path.join(screenshotDir, 'map-view.png'),
      fullPage: false,
    });
  });

  test('08 - Combined View (Split)', async ({ page }) => {
    // Navigate to combined view
    await page.goto('/combined');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    await page.screenshot({
      path: path.join(screenshotDir, 'combined-view.png'),
      fullPage: false,
    });
  });

  test('09 - Events Selection Page', async ({ page }) => {
    // Navigate to events page
    await page.goto('/events');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    await page.screenshot({
      path: path.join(screenshotDir, 'events-page.png'),
      fullPage: false,
    });
  });

  test('10 - Reko Form Page', async ({ page }) => {
    // Navigate to reko form
    await page.goto('/reko');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    await page.screenshot({
      path: path.join(screenshotDir, 'reko-form.png'),
      fullPage: true,
    });
  });

  test('11 - Check-In Page', async ({ page }) => {
    // Navigate to check-in
    await page.goto('/check-in');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    await page.screenshot({
      path: path.join(screenshotDir, 'check-in-page.png'),
      fullPage: true,
    });
  });

  test('12 - Settings Page', async ({ page }) => {
    // Navigate to settings
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    await page.screenshot({
      path: path.join(screenshotDir, 'settings-page.png'),
      fullPage: true,
    });
  });

  test('13 - Search Functionality', async ({ page }) => {
    // Type in search box
    const searchInput = page.locator('#search-input');
    await searchInput.fill('Brand');
    await page.waitForTimeout(500);

    await page.screenshot({
      path: path.join(screenshotDir, 'search-functionality.png'),
      fullPage: false,
    });
  });

  test('14 - Command Palette (Cmd+K)', async ({ page }) => {
    // Open command palette
    await page.keyboard.press('Meta+K');
    await page.waitForTimeout(500);

    // Capture command palette
    const commandPalette = page.locator('[role="dialog"]').first();
    if (await commandPalette.isVisible()) {
      await commandPalette.screenshot({
        path: path.join(screenshotDir, 'command-palette.png'),
      });
    }
  });

  test('15 - Resources Page', async ({ page }) => {
    // Navigate to resources
    await page.goto('/resources');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    await page.screenshot({
      path: path.join(screenshotDir, 'resources-page.png'),
      fullPage: true,
    });
  });
});
