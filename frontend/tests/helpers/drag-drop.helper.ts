import { Page, Locator } from '@playwright/test';

/**
 * Drag and Drop Helper
 * Provides utilities for drag-and-drop interactions with Pragmatic Drag and Drop
 */
export class DragDropHelper {
  constructor(private page: Page) {}

  /**
   * Perform drag and drop operation
   * @param source - Source element selector or locator
   * @param target - Target element selector or locator
   * @param options - Additional options for drag behavior
   */
  async dragAndDrop(
    source: string | Locator,
    target: string | Locator,
    options: { steps?: number; delay?: number } = {}
  ) {
    const sourceLocator = typeof source === 'string'
      ? this.page.locator(source)
      : source;

    const targetLocator = typeof target === 'string'
      ? this.page.locator(target)
      : target;

    // Get bounding boxes
    const sourceBox = await sourceLocator.boundingBox();
    const targetBox = await targetLocator.boundingBox();

    if (!sourceBox || !targetBox) {
      throw new Error('Could not get bounding boxes for drag and drop');
    }

    // Calculate centers
    const sourceCenterX = sourceBox.x + sourceBox.width / 2;
    const sourceCenterY = sourceBox.y + sourceBox.height / 2;
    const targetCenterX = targetBox.x + targetBox.width / 2;
    const targetCenterY = targetBox.y + targetBox.height / 2;

    // Move to source center
    await this.page.mouse.move(sourceCenterX, sourceCenterY);

    // Start drag
    await this.page.mouse.down();
    await this.page.waitForTimeout(options.delay || 300);

    // Move to target in steps (important for dnd-kit and Pragmatic DnD)
    await this.page.mouse.move(
      targetCenterX,
      targetCenterY,
      { steps: options.steps || 30 }
    );

    await this.page.waitForTimeout(options.delay || 500);

    // Drop
    await this.page.mouse.up();
    await this.page.waitForTimeout(300);
  }

  /**
   * Drag incident card to a specific column
   * @param incident - Incident card locator
   * @param columnName - Name of the target column
   */
  async dragToColumn(incident: Locator, columnName: string) {
    const column = this.page.locator('[data-testid="kanban-column"]', {
      hasText: columnName
    });
    await this.dragAndDrop(incident, column);
  }

  /**
   * Drag personnel to incident
   * @param personnelName - Name of the personnel
   * @param incidentLocation - Location of the incident
   */
  async dragPersonnelToIncident(personnelName: string, incidentLocation: string) {
    const personnel = this.page
      .locator('aside')
      .first()
      .locator('[data-testid="personnel-card"]', { hasText: personnelName });

    const incident = this.page.locator('[data-testid="incident-card"]', {
      hasText: incidentLocation
    });

    await this.dragAndDrop(personnel, incident);
  }

  /**
   * Drag material to incident
   * @param materialName - Name of the material
   * @param incidentLocation - Location of the incident
   */
  async dragMaterialToIncident(materialName: string, incidentLocation: string) {
    const material = this.page
      .locator('aside')
      .last()
      .locator('[data-testid="material-card"]', { hasText: materialName });

    const incident = this.page.locator('[data-testid="incident-card"]', {
      hasText: incidentLocation
    });

    await this.dragAndDrop(material, incident);
  }

  /**
   * Verify visual feedback during drag
   * Checks for ring or border indicators
   */
  async verifyDragFeedback(): Promise<boolean> {
    const indicators = await this.page.locator('[class*="ring-"]').count();
    return indicators > 0;
  }
}
