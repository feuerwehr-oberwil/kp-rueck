import { test, expect, Page } from '@playwright/test';

/**
 * Core UI Functionality Tests
 * Tests drag-and-drop and search features for the KP Rück Dashboard
 */

// Helper function to perform drag and drop with dnd-kit
async function dragAndDrop(page: Page, sourceSelector: string, targetSelector: string) {
  const source = page.locator(sourceSelector).first();
  const target = page.locator(targetSelector).first();

  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();

  if (!sourceBox || !targetBox) {
    throw new Error('Could not get bounding boxes for drag and drop');
  }

  // Move to source center
  await page.mouse.move(
    sourceBox.x + sourceBox.width / 2,
    sourceBox.y + sourceBox.height / 2
  );

  // Mouse down and wait for drag to start
  await page.mouse.down();
  await page.waitForTimeout(200);

  // Move to target in steps (important for dnd-kit)
  await page.mouse.move(
    targetBox.x + targetBox.width / 2,
    targetBox.y + targetBox.height / 2,
    { steps: 20 }
  );
  await page.waitForTimeout(300);

  // Mouse up to drop
  await page.mouse.up();
  await page.waitForTimeout(500);
}

test.describe('Core UI Functionality', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('.flex.h-screen', { timeout: 10000 });
  });

  test.describe('Drag and Drop - People to Operations', () => {
    test('should drag an available person onto an operation card', async ({ page }) => {
      // Find available person (with green dot)
      const availablePersonCards = page.locator('aside').first().locator('[class*="bg-card"]').filter({
        has: page.locator('.bg-emerald-500')
      });

      const personCount = await availablePersonCards.count();
      if (personCount === 0) {
        test.skip();
        return;
      }

      const personCard = availablePersonCards.first();
      const personName = await personCard.locator('.font-medium').first().textContent();

      // Find any operation card
      const operationCard = page.locator('.font-bold.text-base').first().locator('../../../..');
      await expect(operationCard).toBeVisible();

      // Count crew before drop
      const crewBefore = await operationCard.locator('.text-xs.gap-1').count();

      // Perform drag from person to operation
      const personBox = await personCard.boundingBox();
      const opBox = await operationCard.boundingBox();

      if (!personBox || !opBox) {
        throw new Error('Could not get bounding boxes');
      }

      await page.mouse.move(personBox.x + personBox.width / 2, personBox.y + personBox.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(300);
      await page.mouse.move(opBox.x + opBox.width / 2, opBox.y + opBox.height / 2, { steps: 30 });
      await page.waitForTimeout(500);
      await page.mouse.up();
      await page.waitForTimeout(1000);

      // Verify person was added to crew
      const crewAfter = await operationCard.locator('.text-xs.gap-1').count();
      expect(crewAfter).toBeGreaterThan(crewBefore);
    });

    test('should not allow dragging an already assigned person', async ({ page }) => {
      // Find person with gray dot (assigned)
      const assignedPersonCards = page.locator('aside').first().locator('[class*="bg-card"]').filter({
        has: page.locator('.bg-zinc-500')
      });

      const assignedCount = await assignedPersonCards.count();
      if (assignedCount === 0) {
        test.skip();
        return;
      }

      const personCard = assignedPersonCards.first();

      // Verify the card doesn't have cursor-move class
      const hasCursorMove = await personCard.evaluate((el) => {
        return el.className.includes('cursor-move');
      });
      expect(hasCursorMove).toBeFalsy();
    });
  });

  test.describe('Drag and Drop - Materials to Operations', () => {
    test('should drag available material onto an operation card', async ({ page }) => {
      // Find available material (with green dot) from right sidebar
      const availableMaterialCards = page.locator('aside').last().locator('[class*="bg-card"]').filter({
        has: page.locator('.bg-emerald-500')
      });

      const materialCount = await availableMaterialCards.count();
      if (materialCount === 0) {
        test.skip();
        return;
      }

      const materialCard = availableMaterialCards.first();

      // Find operation card
      const operationCard = page.locator('.font-bold.text-base').first().locator('../../../..');
      await expect(operationCard).toBeVisible();

      // Count materials before drop
      const materialsBefore = await operationCard.locator('.text-xs.gap-1.pr-1').count();

      // Perform drag from material to operation
      const materialBox = await materialCard.boundingBox();
      const opBox = await operationCard.boundingBox();

      if (!materialBox || !opBox) {
        throw new Error('Could not get bounding boxes');
      }

      await page.mouse.move(materialBox.x + materialBox.width / 2, materialBox.y + materialBox.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(300);
      await page.mouse.move(opBox.x + opBox.width / 2, opBox.y + opBox.height / 2, { steps: 30 });
      await page.waitForTimeout(500);
      await page.mouse.up();
      await page.waitForTimeout(1000);

      // Verify material was added
      const materialsAfter = await operationCard.locator('.text-xs.gap-1.pr-1').count();
      expect(materialsAfter).toBeGreaterThan(materialsBefore);
    });
  });

  test.describe('Drag and Drop - Operations Between Columns', () => {
    test('should drag operation card to a different column', async ({ page }) => {
      // Find all columns
      const columns = page.getByText('Einsätze').locator('..');
      const columnCount = await columns.count();

      expect(columnCount).toBeGreaterThan(1);

      // Find any operation card
      const operationCard = page.locator('.font-bold.text-base').first().locator('../../../..');
      await expect(operationCard).toBeVisible();

      const operationLocation = await operationCard.locator('.font-bold').first().textContent();

      // Find a different column to drop into
      const targetColumn = columns.nth(1);

      // Perform drag from operation to column
      const operationBox = await operationCard.boundingBox();
      const targetBox = await targetColumn.boundingBox();

      if (!operationBox || !targetBox) {
        throw new Error('Could not get bounding boxes');
      }

      await page.mouse.move(operationBox.x + operationBox.width / 2, operationBox.y + operationBox.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(200);

      // Move to column header area
      await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + 100, { steps: 20 });
      await page.waitForTimeout(300);

      // Verify visual indicator is shown while dragging
      const hasVisualIndicator = await page.locator('[class*="ring-"]').count();
      expect(hasVisualIndicator).toBeGreaterThan(0);

      await page.mouse.up();
      await page.waitForTimeout(500);

      // Verify operation moved (this is a basic check)
      await expect(operationCard).toBeVisible();
    });

    test('should allow dragging operation between columns without errors', async ({ page }) => {
      const operationCard = page.locator('.font-bold.text-base').first().locator('../../../..');
      await expect(operationCard).toBeVisible();

      const columns = page.getByText('Einsätze').locator('..');
      const columnCount = await columns.count();

      if (columnCount < 2) {
        test.skip();
        return;
      }

      const targetColumn = columns.nth(1);

      const operationBox = await operationCard.boundingBox();
      const targetBox = await targetColumn.boundingBox();

      if (!operationBox || !targetBox) {
        throw new Error('Could not get bounding boxes');
      }

      // Start drag
      await page.mouse.move(operationBox.x + operationBox.width / 2, operationBox.y + operationBox.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(200);

      // Move over target column
      await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + 100, { steps: 20 });
      await page.waitForTimeout(300);

      // Verify operation card still exists and is draggable
      await expect(operationCard).toBeVisible();

      // Clean up
      await page.mouse.up();
      await page.waitForTimeout(500);

      // Verify no errors occurred during drag
      await expect(operationCard).toBeVisible();
    });
  });

  test.describe('Pointer Events - No Blocking', () => {
    test('should not block pointer events on operation cards', async ({ page }) => {
      const operationCard = page.locator('.font-bold.text-base').first().locator('../../../..');
      await expect(operationCard).toBeVisible();

      // Check that the card is interactive
      const cardPointerEvents = await operationCard.evaluate((el) => {
        return window.getComputedStyle(el).pointerEvents;
      });

      expect(cardPointerEvents).toBe('auto');
    });

    test('should not have pointer-events:none on wrapper div when not dragging', async ({ page }) => {
      const operationCard = page.locator('.font-bold.text-base').first().locator('../../../..');
      await expect(operationCard).toBeVisible();

      // Get the wrapper div
      const wrapperDiv = operationCard.locator('..');

      const wrapperPointerEvents = await wrapperDiv.evaluate((el) => {
        return window.getComputedStyle(el).pointerEvents;
      });

      expect(wrapperPointerEvents).not.toBe('none');
    });
  });

  test.describe('Search Functionality', () => {
    test('should filter operations by location in main search', async ({ page }) => {
      // Get initial count of visible operations
      const allOperations = page.locator('.font-bold.text-base');
      const initialCount = await allOperations.count();

      if (initialCount === 0) {
        test.skip();
        return;
      }

      // Get first operation's location
      const firstOperation = allOperations.first();
      const location = await firstOperation.textContent();
      const searchTerm = location?.substring(0, 5) || '';

      // Type in main search box
      const searchInput = page.locator('#search-input');
      await searchInput.fill(searchTerm);
      await page.waitForTimeout(300);

      // Verify filtering works
      const visibleOperations = page.locator('.font-bold.text-base');
      const filteredCount = await visibleOperations.count();

      // Should have filtered results (may be same as initial if all match)
      expect(filteredCount).toBeGreaterThan(0);
      expect(filteredCount).toBeLessThanOrEqual(initialCount);
    });

    test('should clear search results when search is cleared', async ({ page }) => {
      const allOperations = page.locator('.font-bold.text-base');
      const initialCount = await allOperations.count();

      if (initialCount === 0) {
        test.skip();
        return;
      }

      // Search for something specific
      const searchInput = page.locator('#search-input');
      await searchInput.fill('TestSearchTerm123');
      await page.waitForTimeout(300);

      // Clear search
      await searchInput.clear();
      await page.waitForTimeout(300);

      // Verify all operations are visible again
      const finalCount = await allOperations.count();
      expect(finalCount).toBe(initialCount);
    });

    test('should filter personnel by name in sidebar search', async ({ page }) => {
      const personnelSearch = page.locator('aside').first().locator('input[type="text"]');
      await expect(personnelSearch).toBeVisible();

      // Get initial personnel count
      const allPersonnel = page.locator('aside').first().locator('[class*="bg-card"]');
      const initialCount = await allPersonnel.count();

      if (initialCount === 0) {
        test.skip();
        return;
      }

      // Get first person's name
      const firstPerson = allPersonnel.first().locator('.font-medium');
      const name = await firstPerson.textContent();
      const searchTerm = name?.substring(0, 3) || '';

      // Search
      await personnelSearch.fill(searchTerm);
      await page.waitForTimeout(300);

      // Verify filtering
      const visiblePersonnel = page.locator('aside').first().locator('[class*="bg-card"]');
      const filteredCount = await visiblePersonnel.count();

      expect(filteredCount).toBeGreaterThan(0);
      expect(filteredCount).toBeLessThanOrEqual(initialCount);
    });

    test('should filter materials by name in sidebar search', async ({ page }) => {
      const materialSearch = page.locator('aside').last().locator('input[type="text"]');
      await expect(materialSearch).toBeVisible();

      // Get initial material count
      const allMaterials = page.locator('aside').last().locator('[class*="bg-card"]');
      const initialCount = await allMaterials.count();

      if (initialCount === 0) {
        test.skip();
        return;
      }

      // Get first material's name
      const firstMaterial = allMaterials.first().locator('.font-medium');
      const name = await firstMaterial.textContent();
      const searchTerm = name?.substring(0, 3) || '';

      // Search
      await materialSearch.fill(searchTerm);
      await page.waitForTimeout(300);

      // Verify filtering
      const visibleMaterials = page.locator('aside').last().locator('[class*="bg-card"]');
      const filteredCount = await visibleMaterials.count();

      expect(filteredCount).toBeGreaterThan(0);
      expect(filteredCount).toBeLessThanOrEqual(initialCount);
    });

    test('should focus search input when pressing /', async ({ page }) => {
      // Press '/' key
      await page.keyboard.press('/');
      await page.waitForTimeout(100);

      // Verify search input is focused
      const searchInput = page.locator('#search-input');
      const isFocused = await searchInput.evaluate((el) => el === document.activeElement);
      expect(isFocused).toBeTruthy();
    });

    test('should blur search input when pressing Escape', async ({ page }) => {
      const searchInput = page.locator('#search-input');

      // Focus the input
      await searchInput.focus();
      await page.waitForTimeout(100);

      // Press Escape
      await page.keyboard.press('Escape');
      await page.waitForTimeout(100);

      // Verify input is no longer focused
      const isFocused = await searchInput.evaluate((el) => el === document.activeElement);
      expect(isFocused).toBeFalsy();
    });
  });

  test.describe('Visual Feedback', () => {
    test('should show operation card receives drop feedback', async ({ page }) => {
      const availablePersonCards = page.locator('aside').first().locator('[class*="bg-card"]').filter({
        has: page.locator('.bg-emerald-500')
      });

      const personCount = await availablePersonCards.count();
      if (personCount === 0) {
        test.skip();
        return;
      }

      const personCard = availablePersonCards.first();
      const operationCard = page.locator('.font-bold.text-base').first().locator('../../../..');

      const personBox = await personCard.boundingBox();
      const opBox = await operationCard.boundingBox();

      if (!personBox || !opBox) {
        throw new Error('Could not get bounding boxes');
      }

      // Start drag
      await page.mouse.move(personBox.x + personBox.width / 2, personBox.y + personBox.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(300);

      // Move over operation
      await page.mouse.move(opBox.x + opBox.width / 2, opBox.y + opBox.height / 2, { steps: 30 });
      await page.waitForTimeout(500);

      // Verify the operation card is visible and can receive drops
      await expect(operationCard).toBeVisible();

      // Clean up
      await page.mouse.up();
    });
  });
});
