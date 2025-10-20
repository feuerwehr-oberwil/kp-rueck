import { test, expect, Page } from '@playwright/test';

// Helper to perform a more realistic drag and drop with dnd-kit
async function dragAndDrop(page: Page, sourceSelector: string, targetSelector: string) {
  const source = page.locator(sourceSelector).first();
  const target = page.locator(targetSelector).first();

  // Get bounding boxes
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

  // Mouse down
  await page.mouse.down();
  await page.waitForTimeout(200);

  // Move to target in steps (important for dnd-kit)
  await page.mouse.move(
    targetBox.x + targetBox.width / 2,
    targetBox.y + targetBox.height / 2,
    { steps: 20 }
  );
  await page.waitForTimeout(300);

  // Mouse up
  await page.mouse.up();
  await page.waitForTimeout(500);
}

test.describe('Drag and Drop Functionality', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    // Wait for dashboard to be visible
    await page.waitForSelector('.flex.h-screen', { timeout: 10000 });
  });

  test('should drag a person onto an operation card', async ({ page }) => {
    // Find first available person (with green dot)
    const availablePersonDot = page.locator('.bg-emerald-500').first();
    await expect(availablePersonDot).toBeVisible({ timeout: 10000 });

    // Get the person card (parent of the dot)
    const personCard = availablePersonDot.locator('../../../..');
    const personName = await personCard.locator('.font-medium').first().textContent();
    console.log('🧑 Attempting to drag person:', personName);

    // Find ANY operation card on the page
    const operationCards = page.locator('[class*="bg-zinc-800"], [class*="bg-green-800"], [class*="bg-blue-900"], [class*="bg-orange-900"], [class*="bg-blue-800"]').filter({
      has: page.locator('.font-bold.text-base')
    });

    const operationCount = await operationCards.count();
    console.log('📍 Found', operationCount, 'operation cards');

    expect(operationCount).toBeGreaterThan(0);

    const operationCard = operationCards.first();
    const operationLocation = await operationCard.locator('.font-bold').first().textContent();
    console.log('📍 Target operation:', operationLocation);

    // Count crew before drop
    const crewBefore = await operationCard.locator('.text-xs.gap-1').count();
    console.log('👥 Crew before:', crewBefore);

    // Perform drag and drop using simple selectors
    await dragAndDrop(
      page,
      '.bg-card.cursor-move:has(.bg-emerald-500)',
      `[class*="bg-"]:has(.font-bold:text-is("${operationLocation?.trim()}"))`
    );

    // Verify person was added
    const crewAfter = await operationCard.locator('.text-xs.gap-1').count();
    console.log('👥 Crew after:', crewAfter);

    console.log('✅ Test result: Crew increased from', crewBefore, 'to', crewAfter);
    expect(crewAfter).toBeGreaterThan(crewBefore);
  });

  test('should drag material onto an operation card', async ({ page }) => {
    // Find available material in the right sidebar
    const materialsSection = page.locator('text=Verfügbares Material').locator('..');
    const availableMaterialDot = materialsSection.locator('.bg-emerald-500').first();

    await expect(availableMaterialDot).toBeVisible({ timeout: 10000 });

    const materialCard = availableMaterialDot.locator('../../../..');
    const materialName = await materialCard.locator('.font-medium').first().textContent();
    console.log('📦 Attempting to drag material:', materialName);

    // Find ANY operation card
    const operationCards = page.locator('[class*="bg-zinc-800"], [class*="bg-green-800"], [class*="bg-blue-900"], [class*="bg-orange-900"], [class*="bg-blue-800"]').filter({
      has: page.locator('.font-bold.text-base')
    });

    const operationCount = await operationCards.count();
    console.log('📍 Found', operationCount, 'operation cards');
    expect(operationCount).toBeGreaterThan(0);

    const operationCard = operationCards.first();
    const operationLocation = await operationCard.locator('.font-bold').first().textContent();
    console.log('📍 Target operation:', operationLocation);

    // Count materials before drop (look for Package icon's parent badges)
    const materialsBefore = await operationCard.locator('.text-xs.gap-1.pr-1').count();
    console.log('📦 Materials before:', materialsBefore);

    // Perform drag
    const materialBox = await materialCard.boundingBox();
    const operationBox = await operationCard.boundingBox();

    if (!materialBox || !operationBox) {
      throw new Error('Could not get bounding boxes');
    }

    await page.mouse.move(materialBox.x + materialBox.width / 2, materialBox.y + materialBox.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(200);
    await page.mouse.move(operationBox.x + operationBox.width / 2, operationBox.y + operationBox.height / 2, { steps: 20 });
    await page.waitForTimeout(300);
    await page.mouse.up();
    await page.waitForTimeout(500);

    // Verify material was added
    const materialsAfter = await operationCard.locator('.text-xs.gap-1.pr-1').count();
    console.log('📦 Materials after:', materialsAfter);

    console.log('✅ Test result: Materials increased from', materialsBefore, 'to', materialsAfter);
    expect(materialsAfter).toBeGreaterThan(materialsBefore);
  });

  test('should drag operation between columns', async ({ page }) => {
    // Find all columns
    const columns = page.locator('[class*="bg-"]:has(text=Einsätze)');
    const columnCount = await columns.count();
    console.log('📋 Found', columnCount, 'columns');

    // Find any operation card
    const operationCards = page.locator('[class*="bg-zinc-800"], [class*="bg-green-800"], [class*="bg-blue-900"], [class*="bg-orange-900"], [class*="bg-blue-800"]').filter({
      has: page.locator('.font-bold.text-base')
    });

    const operation = operationCards.first();
    await expect(operation).toBeVisible();

    const operationLocation = await operation.locator('.font-bold').first().textContent();
    console.log('📍 Moving operation:', operationLocation);

    // Find a different column header to drop into
    const targetColumn = columns.nth(1);
    const targetColumnName = await targetColumn.locator('h2').textContent();
    console.log('📋 Target column:', targetColumnName);

    // Perform drag
    const operationBox = await operation.boundingBox();
    const targetBox = await targetColumn.boundingBox();

    if (!operationBox || !targetBox) {
      throw new Error('Could not get bounding boxes');
    }

    // Drag from operation to column header area
    await page.mouse.move(operationBox.x + operationBox.width / 2, operationBox.y + operationBox.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(200);
    await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + 100, { steps: 20 });
    await page.waitForTimeout(300);

    // Check for visual indicator while dragging
    const hasVisualIndicator = await page.locator('[class*="ring-"]').count();
    console.log('🎨 Visual indicators visible:', hasVisualIndicator > 0);

    await page.mouse.up();
    await page.waitForTimeout(500);

    console.log('✅ Operation drag completed');
  });

  test('CRITICAL: verify drop zones are not blocked by pointer-events', async ({ page }) => {
    // This test checks if the wrapper div is blocking pointer events

    // Find an operation card
    const operationCard = page.locator('[class*="bg-"]:has(.font-bold.text-base)').first();
    await expect(operationCard).toBeVisible();

    // Check computed styles
    const wrapperDiv = operationCard.locator('..'); // Parent wrapper
    const hasPointerEventsNone = await wrapperDiv.evaluate((el) => {
      const style = window.getComputedStyle(el);
      return style.pointerEvents === 'none';
    });

    console.log('⚠️  CRITICAL: Wrapper has pointer-events: none?', hasPointerEventsNone);

    // When NOT dragging operations, the wrapper should NOT block pointer events
    expect(hasPointerEventsNone).toBeFalsy();

    const cardPointerEvents = await operationCard.evaluate((el) => {
      const style = window.getComputedStyle(el);
      return style.pointerEvents;
    });

    console.log('✅ Operation card pointer-events:', cardPointerEvents);
    expect(cardPointerEvents).not.toBe('none');
  });
});
