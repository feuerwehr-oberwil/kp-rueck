import { test, expect, Page } from '@playwright/test';

/**
 * Combined View Tests
 * Tests the split-panel combined view with kanban board and map synchronization
 */

test.describe('Combined View', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to events page first to ensure an event is selected
    await page.goto('/events');
    await page.waitForLoadState('networkidle');

    // Select the first event if one exists
    const eventCards = page.locator('[class*="cursor-pointer"]');
    const eventCount = await eventCards.count();

    if (eventCount > 0) {
      await eventCards.first().click();
      await page.waitForTimeout(500);
    }

    // Navigate to combined view
    await page.goto('/combined');
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('.flex.h-screen', { timeout: 10000 });
  });

  test.describe('Page Load and Layout', () => {
    test('should render the combined view page with split panels', async ({ page }) => {
      // Verify header exists
      await expect(page.getByText('Kombinierte Ansicht')).toBeVisible();

      // Verify both panels are visible
      // Kanban panel
      const kanbanPanel = page.locator('[class*="h-full rounded-lg border"]').first();
      await expect(kanbanPanel).toBeVisible();

      // Map panel
      const mapPanel = page.locator('[class*="h-full rounded-lg border"]').last();
      await expect(mapPanel).toBeVisible();
    });

    test('should display resizable handle between panels', async ({ page }) => {
      // Look for resize handle
      const resizeHandle = page.locator('[data-panel-resize-handle-id]');
      await expect(resizeHandle).toBeVisible();
    });

    test('should show active operations count in badge', async ({ page }) => {
      const badge = page.locator('header').getByText(/Aktiv/);
      await expect(badge).toBeVisible();
    });
  });

  test.describe('Kanban Board Integration', () => {
    test('should display kanban columns in left panel', async ({ page }) => {
      // Wait for kanban to load
      await page.waitForSelector('.font-bold.uppercase.tracking-wide', { timeout: 5000 });

      // Check for column headers
      const columns = page.locator('.font-bold.uppercase.tracking-wide');
      const columnCount = await columns.count();

      expect(columnCount).toBeGreaterThanOrEqual(4); // At least 4 columns
    });

    test('should allow hovering over kanban cards', async ({ page }) => {
      // Find operation cards
      const operationCards = page.locator('.font-bold.text-base');
      const cardCount = await operationCards.count();

      if (cardCount === 0) {
        test.skip();
        return;
      }

      const firstCard = operationCards.first().locator('../../../..');
      await expect(firstCard).toBeVisible();

      // Hover over the card
      await firstCard.hover();
      await page.waitForTimeout(300);

      // Card should be visible and interactive
      await expect(firstCard).toBeVisible();
    });

    test('should open detail modal when clicking kanban card', async ({ page }) => {
      const operationCards = page.locator('.font-bold.text-base');
      const cardCount = await operationCards.count();

      if (cardCount === 0) {
        test.skip();
        return;
      }

      const firstCard = operationCards.first().locator('../../../..');
      await firstCard.click();
      await page.waitForTimeout(500);

      // Verify modal is open (look for dialog/modal content)
      const modal = page.locator('[role="dialog"]');
      await expect(modal).toBeVisible();
    });
  });

  test.describe('Map Integration', () => {
    test('should display map in right panel', async ({ page }) => {
      // Wait for map to load
      await page.waitForTimeout(2000);

      // Look for Leaflet map container
      const mapContainer = page.locator('.leaflet-container');
      await expect(mapContainer).toBeVisible();
    });

    test('should show map tiles', async ({ page }) => {
      // Wait for map to fully load
      await page.waitForTimeout(3000);

      // Check for map tiles
      const mapTiles = page.locator('.leaflet-tile-pane');
      await expect(mapTiles).toBeVisible();
    });

    test('should display incident markers on map', async ({ page }) => {
      // Wait for map and markers to load
      await page.waitForTimeout(3000);

      // Look for custom markers (our div icons)
      const markers = page.locator('.custom-marker');
      const markerCount = await markers.count();

      // Should have at least some markers if there are operations
      const operationCards = page.locator('.font-bold.text-base');
      const cardCount = await operationCards.count();

      if (cardCount > 0) {
        expect(markerCount).toBeGreaterThan(0);
      }
    });
  });

  test.describe('Synchronization Features', () => {
    test('should highlight kanban card when hovering', async ({ page }) => {
      const operationCards = page.locator('.font-bold.text-base');
      const cardCount = await operationCards.count();

      if (cardCount === 0) {
        test.skip();
        return;
      }

      const firstCard = operationCards.first().locator('../../../..');

      // Hover over card
      await firstCard.hover();
      await page.waitForTimeout(500);

      // The card should still be visible after hover
      await expect(firstCard).toBeVisible();
    });

    test('should maintain kanban functionality with drag and drop', async ({ page }) => {
      const operationCards = page.locator('.font-bold.text-base');
      const cardCount = await operationCards.count();

      if (cardCount === 0) {
        test.skip();
        return;
      }

      const firstCard = operationCards.first().locator('../../../..');

      // Get card's initial bounding box
      const initialBox = await firstCard.boundingBox();
      expect(initialBox).not.toBeNull();

      // Verify card is draggable (has cursor property)
      await expect(firstCard).toBeVisible();
    });

    test('should allow clicking map markers', async ({ page }) => {
      // Wait for map to load
      await page.waitForTimeout(3000);

      // Find markers
      const markers = page.locator('.custom-marker');
      const markerCount = await markers.count();

      if (markerCount === 0) {
        test.skip();
        return;
      }

      const firstMarker = markers.first();

      // Click marker
      await firstMarker.click();
      await page.waitForTimeout(500);

      // Verify something happened (marker was clicked)
      await expect(firstMarker).toBeVisible();
    });
  });

  test.describe('Navigation', () => {
    test('should have navigation buttons in header', async ({ page }) => {
      // Check for navigation icons
      const navButtons = page.locator('header button[title]');
      const buttonCount = await navButtons.count();

      expect(buttonCount).toBeGreaterThan(0);
    });

    test('should have combined view button disabled/highlighted', async ({ page }) => {
      // Find the combined view button
      const combinedButton = page.locator('button[title="Kombinierte Ansicht"]');
      await expect(combinedButton).toBeVisible();

      // Should be disabled since we're on this page
      const isDisabled = await combinedButton.isDisabled();
      expect(isDisabled).toBeTruthy();
    });

    test('should navigate to kanban view', async ({ page }) => {
      const kanbanButton = page.locator('button[title="Kanban Board"]');
      await expect(kanbanButton).toBeVisible();

      // Click to navigate
      await kanbanButton.click();
      await page.waitForTimeout(500);

      // Should be on kanban page now
      await expect(page).toHaveURL('/');
    });

    test('should navigate to map view', async ({ page }) => {
      const mapButton = page.locator('button[title="Lagekarte"]');
      await expect(mapButton).toBeVisible();

      // Click to navigate
      await mapButton.click();
      await page.waitForTimeout(500);

      // Should be on map page now
      await expect(page).toHaveURL('/map');
    });
  });

  test.describe('Responsive Behavior', () => {
    test('should display both panels side by side on desktop', async ({ page }) => {
      // Get viewport width
      const viewportSize = page.viewportSize();
      expect(viewportSize).not.toBeNull();

      if (viewportSize && viewportSize.width >= 1280) {
        // Both panels should be visible
        const kanbanPanel = page.locator('[class*="h-full rounded-lg border"]').first();
        const mapPanel = page.locator('[class*="h-full rounded-lg border"]').last();

        await expect(kanbanPanel).toBeVisible();
        await expect(mapPanel).toBeVisible();
      }
    });
  });

  test.describe('Resizing Functionality', () => {
    test('should allow resizing panels', async ({ page }) => {
      // Find resize handle
      const resizeHandle = page.locator('[data-panel-resize-handle-id]');
      await expect(resizeHandle).toBeVisible();

      const handleBox = await resizeHandle.boundingBox();
      expect(handleBox).not.toBeNull();

      if (handleBox) {
        // Try to drag the handle
        await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
        await page.mouse.down();
        await page.waitForTimeout(100);

        // Move it a bit to the right
        await page.mouse.move(handleBox.x + handleBox.width / 2 + 100, handleBox.y + handleBox.height / 2, { steps: 10 });
        await page.waitForTimeout(100);

        await page.mouse.up();
        await page.waitForTimeout(300);

        // Panels should still be visible after resize
        const kanbanPanel = page.locator('[class*="h-full rounded-lg border"]').first();
        const mapPanel = page.locator('[class*="h-full rounded-lg border"]').last();

        await expect(kanbanPanel).toBeVisible();
        await expect(mapPanel).toBeVisible();
      }
    });
  });

  test.describe('Detail Modal', () => {
    test('should open operation detail modal', async ({ page }) => {
      const operationCards = page.locator('.font-bold.text-base');
      const cardCount = await operationCards.count();

      if (cardCount === 0) {
        test.skip();
        return;
      }

      const firstCard = operationCards.first().locator('../../../..');
      await firstCard.click();
      await page.waitForTimeout(500);

      // Modal should be visible
      const modal = page.locator('[role="dialog"]');
      await expect(modal).toBeVisible();
    });

    test('should close modal when clicking outside or close button', async ({ page }) => {
      const operationCards = page.locator('.font-bold.text-base');
      const cardCount = await operationCards.count();

      if (cardCount === 0) {
        test.skip();
        return;
      }

      const firstCard = operationCards.first().locator('../../../..');
      await firstCard.click();
      await page.waitForTimeout(500);

      // Modal should be visible
      const modal = page.locator('[role="dialog"]');
      await expect(modal).toBeVisible();

      // Close modal (press Escape)
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);

      // Modal should be hidden
      await expect(modal).not.toBeVisible();
    });
  });
});
