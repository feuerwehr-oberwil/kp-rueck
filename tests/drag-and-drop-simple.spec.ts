import { test, expect } from '@playwright/test';

test.describe('Drag and Drop - Simple Verification', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('.flex.h-screen', { timeout: 10000 });
  });

  test('VERIFY: pointer-events are NOT blocking drop zones', async ({ page }) => {
    // Find any operation card
    const operationCard = page.locator('.font-bold.text-base').first().locator('../../../..');

   await expect(operationCard).toBeVisible();

    // Get the wrapper div that contains all operations
    const wrapperDiv = operationCard.locator('..');

    // Check if wrapper has pointer-events: none (it shouldn't when not dragging)
    const wrapperPointerEvents = await wrapperDiv.evaluate((el) => {
      return window.getComputedStyle(el).pointerEvents;
    });

    console.log('🔍 Wrapper pointer-events:', wrapperPointerEvents);

    // The wrapper should NOT block pointer events when not dragging
    expect(wrapperPointerEvents).not.toBe('none');

    // The card itself should be interactive
    const cardPointerEvents = await operationCard.evaluate((el) => {
      return window.getComputedStyle(el).pointerEvents;
    });

    console.log('🔍 Card pointer-events:', cardPointerEvents);
    expect(cardPointerEvents).toBe('auto');
  });

  test('MANUAL: drag person onto operation card', async ({ page }) => {
    // Find person with green dot (available)
    const personCards = page.locator('.bg-card').filter({
      has: page.locator('.bg-emerald-500')
    });

    const personCount = await personCards.count();
    console.log('👤 Found', personCount, 'available people');

    if (personCount === 0) {
      console.log('⚠️  No available people to test with');
      return;
    }

    const personCard = personCards.first();
    const personName = await personCard.locator('.font-medium').first().textContent();
    console.log('👤 Person:', personName);

    // Find operation card
    const operationCards = page.locator('.font-bold.text-base').locator('../../../..');
    const operationCount = await operationCards.count();
    console.log('📍 Found', operationCount, 'operations');

    if (operationCount === 0) {
      console.log('⚠️  No operations to test with');
      return;
    }

    const operationCard = operationCards.first();
    const operationName = await operationCard.locator('.font-bold').first().textContent();
    console.log('📍 Operation:', operationName);

    // Get bounding boxes
    const personBox = await personCard.boundingBox();
    const opBox = await operationCard.boundingBox();

    if (!personBox || !opBox) {
      throw new Error('Could not get bounding boxes');
    }

    console.log('🖱️  Starting drag from person to operation...');

    // Perform drag
    await page.mouse.move(personBox.x + personBox.width / 2, personBox.y + personBox.height / 2);
    console.log('  ✓ Mouse over person');

    await page.mouse.down();
    console.log('  ✓ Mouse down');

    await page.waitForTimeout(300);

    await page.mouse.move(opBox.x + opBox.width / 2, opBox.y + opBox.height / 2, { steps: 30 });
    console.log('  ✓ Mouse moved to operation');

    await page.waitForTimeout(500);

    // Check if operation card shows visual feedback (isOver)
    const hasRing = await operationCard.evaluate((el) => {
      return el.className.includes('ring-2') || el.className.includes('ring-primary');
    });
    console.log('  🎨 Operation shows ring indicator:', hasRing);

    await page.mouse.up();
    console.log('  ✓ Mouse up (drop)');

    await page.waitForTimeout(1000);

    // Check if person was added to crew
    const crewBadges = await operationCard.locator('.text-xs.gap-1').count();
    console.log('👥 Crew badges after drop:', crewBadges);

    // Check if person's status changed to gray dot
    const personStatus = await personCard.locator('.h-2.w-2.rounded-full').first();
    const isGray = await personStatus.evaluate((el) => {
      return el.className.includes('bg-zinc-500');
    });
    console.log('👤 Person now has gray dot (assigned):', isGray);

    if (crewBadges > 0 && isGray) {
      console.log('✅ DRAG AND DROP WORKS!');
    } else {
      console.log('❌ DRAG AND DROP FAILED - Person was not added to operation');
      throw new Error('Drag and drop did not work');
    }
  });

  test('MANUAL: drag material onto operation card', async ({ page }) => {
    // Find material with green dot (available)
    const materialSection = page.locator('text=Verfügbares Material');
    await expect(materialSection).toBeVisible();

    // Find all cards, then filter for ones with green dots
    const allMaterialCards = page.locator('.bg-card').filter({
      has: page.locator('.bg-emerald-500')
    });

    // Get only materials from the right sidebar
    const materialCards = allMaterialCards.locator('visible=true');

    const materialCount = await materialCards.count();
    console.log('📦 Found', materialCount, 'available materials');

    if (materialCount === 0) {
      console.log('⚠️  All materials are assigned, skipping test');
      return;
    }

    // Use last() to get from right sidebar
    const materialCard = materialCards.last();
    const materialName = await materialCard.locator('.font-medium').first().textContent();
    console.log('📦 Material:', materialName);

    // Find operation card
    const operationCards = page.locator('.font-bold.text-base').locator('../../../..');
    const operationCard = operationCards.first();
    const operationName = await operationCard.locator('.font-bold').first().textContent();
    console.log('📍 Operation:', operationName);

    // Get bounding boxes
    const materialBox = await materialCard.boundingBox();
    const opBox = await operationCard.boundingBox();

    if (!materialBox || !opBox) {
      throw new Error('Could not get bounding boxes');
    }

    console.log('🖱️  Starting drag from material to operation...');

    // Perform drag
    await page.mouse.move(materialBox.x + materialBox.width / 2, materialBox.y + materialBox.height / 2);
    console.log('  ✓ Mouse over material');

    await page.mouse.down();
    console.log('  ✓ Mouse down');

    await page.waitForTimeout(300);

    await page.mouse.move(opBox.x + opBox.width / 2, opBox.y + opBox.height / 2, { steps: 30 });
    console.log('  ✓ Mouse moved to operation');

    await page.waitForTimeout(500);

    await page.mouse.up();
    console.log('  ✓ Mouse up (drop)');

    await page.waitForTimeout(1000);

    // Check if material was added
    const materialBadges = await operationCard.locator('.text-xs.gap-1.pr-1').count();
    console.log('📦 Material badges after drop:', materialBadges);

    // Check if material's status changed to gray dot
    const materialStatus = await materialCard.locator('.h-2.w-2.rounded-full').first();
    const isGray = await materialStatus.evaluate((el) => {
      return el.className.includes('bg-zinc-500');
    });
    console.log('📦 Material now has gray dot (assigned):', isGray);

    if (materialBadges > 0 && isGray) {
      console.log('✅ DRAG AND DROP WORKS!');
    } else {
      console.log('❌ DRAG AND DROP FAILED - Material was not added to operation');
      throw new Error('Drag and drop did not work');
    }
  });
});
