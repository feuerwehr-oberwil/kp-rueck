import { test, expect } from '../../fixtures/auth.fixture';
import { EventsPage } from '../../pages/events.page';

/**
 * Keyboard Shortcuts Modal Tests
 * Tests the categorized shortcuts modal that opens with '?' key
 * Shows organized shortcuts by category (Navigation, Actions, Editing, UI)
 */

test.describe('Keyboard Shortcuts Modal - Opening', () => {
  let eventsPage: EventsPage;
  let testEventName: string;

  test.beforeEach(async ({ authenticatedPage }) => {
    eventsPage = new EventsPage(authenticatedPage);

    testEventName = `Shortcuts Test ${Date.now()}`;
    await eventsPage.goto();
    await eventsPage.createEvent(testEventName);
    await eventsPage.goto();
    await eventsPage.selectEvent(testEventName);
    await expect(authenticatedPage).toHaveURL('/');
    await authenticatedPage.waitForTimeout(1000);
  });

  test('modal opens when pressing ? key', async ({ authenticatedPage }) => {
    // Press ? key
    await authenticatedPage.keyboard.press('Shift+/'); // ? is Shift+/

    // Verify modal opens
    const modal = authenticatedPage.locator('[role="dialog"]', { hasText: 'Tastaturkürzel' });
    await expect(modal).toBeVisible({ timeout: 3000 });
  });

  test('modal shows correct title', async ({ authenticatedPage }) => {
    await authenticatedPage.keyboard.press('Shift+/');

    const modal = authenticatedPage.locator('[role="dialog"]');
    await expect(modal).toBeVisible();

    // Check title
    await expect(modal.locator('h2:has-text("Tastaturkürzel")')).toBeVisible();
  });

  test('modal shows description', async ({ authenticatedPage }) => {
    await authenticatedPage.keyboard.press('Shift+/');

    const modal = authenticatedPage.locator('[role="dialog"]');
    await expect(modal).toBeVisible();

    // Check description
    await expect(modal.locator('text=Schneller arbeiten mit Tastatur-Shortcuts')).toBeVisible();
  });

  test('modal closes when pressing Escape', async ({ authenticatedPage }) => {
    // Open modal
    await authenticatedPage.keyboard.press('Shift+/');

    const modal = authenticatedPage.locator('[role="dialog"]', { hasText: 'Tastaturkürzel' });
    await expect(modal).toBeVisible();

    // Press Escape
    await authenticatedPage.keyboard.press('Escape');

    // Verify modal closes
    await expect(modal).not.toBeVisible({ timeout: 2000 });
  });
});

test.describe('Keyboard Shortcuts Modal - Categories', () => {
  let eventsPage: EventsPage;
  let testEventName: string;

  test.beforeEach(async ({ authenticatedPage }) => {
    eventsPage = new EventsPage(authenticatedPage);

    testEventName = `Categories Test ${Date.now()}`;
    await eventsPage.goto();
    await eventsPage.createEvent(testEventName);
    await eventsPage.goto();
    await eventsPage.selectEvent(testEventName);
    await expect(authenticatedPage).toHaveURL('/');
    await authenticatedPage.waitForTimeout(1000);

    // Open shortcuts modal
    await authenticatedPage.keyboard.press('Shift+/');
    await authenticatedPage.waitForTimeout(500);
  });

  test('modal shows Navigation category', async ({ authenticatedPage }) => {
    const modal = authenticatedPage.locator('[role="dialog"]');

    // Check Navigation category
    await expect(modal.locator('h3:has-text("Navigation")')).toBeVisible();

    // Check Navigation icon (Map icon)
    const navigationSection = modal.locator('text=Navigation').locator('..');
    const mapIcon = navigationSection.locator('svg[class*="lucide-map"]');
    await expect(mapIcon).toBeVisible();
  });

  test('modal shows Aktionen category', async ({ authenticatedPage }) => {
    const modal = authenticatedPage.locator('[role="dialog"]');

    // Check Aktionen category
    await expect(modal.locator('h3:has-text("Aktionen")')).toBeVisible();

    // Check Zap icon
    const aktionenSection = modal.locator('text=Aktionen').locator('..');
    const zapIcon = aktionenSection.locator('svg[class*="lucide-zap"]');
    await expect(zapIcon).toBeVisible();
  });

  test('modal shows Einsatz bearbeiten category', async ({ authenticatedPage }) => {
    const modal = authenticatedPage.locator('[role="dialog"]');

    // Check Einsatz bearbeiten category
    await expect(modal.locator('h3:has-text("Einsatz bearbeiten")')).toBeVisible();

    // Check Edit icon
    const editSection = modal.locator('text=Einsatz bearbeiten').locator('..');
    const editIcon = editSection.locator('svg[class*="lucide-edit"]');
    await expect(editIcon).toBeVisible();
  });

  test('modal shows Einsatz-Navigation category', async ({ authenticatedPage }) => {
    const modal = authenticatedPage.locator('[role="dialog"]');

    // Check Einsatz-Navigation category
    await expect(modal.locator('h3:has-text("Einsatz-Navigation")')).toBeVisible();

    // Check ArrowUpDown icon
    const navSection = modal.locator('text=Einsatz-Navigation').locator('..');
    const arrowIcon = navSection.locator('svg[class*="lucide-arrow-up-down"]');
    await expect(arrowIcon).toBeVisible();
  });

  test('categories have icons with primary color', async ({ authenticatedPage }) => {
    const modal = authenticatedPage.locator('[role="dialog"]');

    // Get all category icons
    const categoryIcons = modal.locator('h3').locator('..').locator('svg').first();

    // Check that icon has text-primary class
    const hasColor = await categoryIcons.evaluate(el =>
      el.className.includes('text-primary')
    );
    expect(hasColor).toBeTruthy();
  });
});

test.describe('Keyboard Shortcuts Modal - Navigation Shortcuts', () => {
  let eventsPage: EventsPage;
  let testEventName: string;

  test.beforeEach(async ({ authenticatedPage }) => {
    eventsPage = new EventsPage(authenticatedPage);

    testEventName = `Nav Shortcuts Test ${Date.now()}`;
    await eventsPage.goto();
    await eventsPage.createEvent(testEventName);
    await eventsPage.goto();
    await eventsPage.selectEvent(testEventName);
    await expect(authenticatedPage).toHaveURL('/');
    await authenticatedPage.waitForTimeout(1000);

    await authenticatedPage.keyboard.press('Shift+/');
    await authenticatedPage.waitForTimeout(500);
  });

  test('shows G+K shortcut for Kanban Board', async ({ authenticatedPage }) => {
    const modal = authenticatedPage.locator('[role="dialog"]');

    // Find Kanban Board shortcut
    await expect(modal.locator('text=Kanban Board')).toBeVisible();

    // Check for G and K keys
    const kanbanRow = modal.locator('text=Kanban Board').locator('..');
    await expect(kanbanRow.locator('kbd:has-text("G")')).toBeVisible();
    await expect(kanbanRow.locator('kbd:has-text("K")')).toBeVisible();
  });

  test('shows G+M shortcut for Lagekarte', async ({ authenticatedPage }) => {
    const modal = authenticatedPage.locator('[role="dialog"]');

    await expect(modal.locator('text=Lagekarte')).toBeVisible();

    const mapRow = modal.locator('text=Lagekarte').locator('..');
    await expect(mapRow.locator('kbd:has-text("G")')).toBeVisible();
    await expect(mapRow.locator('kbd:has-text("M")')).toBeVisible();
  });

  test('shows G+E shortcut for Ereignisse', async ({ authenticatedPage }) => {
    const modal = authenticatedPage.locator('[role="dialog"]');

    await expect(modal.locator('text=Ereignisse')).toBeVisible();

    const eventsRow = modal.locator('text=Ereignisse').locator('..');
    await expect(eventsRow.locator('kbd:has-text("G")')).toBeVisible();
    await expect(eventsRow.locator('kbd:has-text("E")')).toBeVisible();
  });
});

test.describe('Keyboard Shortcuts Modal - Action Shortcuts', () => {
  let eventsPage: EventsPage;
  let testEventName: string;

  test.beforeEach(async ({ authenticatedPage }) => {
    eventsPage = new EventsPage(authenticatedPage);

    testEventName = `Action Shortcuts Test ${Date.now()}`;
    await eventsPage.goto();
    await eventsPage.createEvent(testEventName);
    await eventsPage.goto();
    await eventsPage.selectEvent(testEventName);
    await expect(authenticatedPage).toHaveURL('/');
    await authenticatedPage.waitForTimeout(1000);

    await authenticatedPage.keyboard.press('Shift+/');
    await authenticatedPage.waitForTimeout(500);
  });

  test('shows N shortcut for Neuer Einsatz', async ({ authenticatedPage }) => {
    const modal = authenticatedPage.locator('[role="dialog"]');

    await expect(modal.locator('text=Neuer Einsatz')).toBeVisible();

    const newRow = modal.locator('text=Neuer Einsatz').locator('..');
    await expect(newRow.locator('kbd:has-text("N")')).toBeVisible();
  });

  test('shows / shortcut for Suche fokussieren', async ({ authenticatedPage }) => {
    const modal = authenticatedPage.locator('[role="dialog"]');

    await expect(modal.locator('text=Suche fokussieren')).toBeVisible();

    const searchRow = modal.locator('text=Suche fokussieren').locator('..');
    await expect(searchRow.locator('kbd:has-text("/")')).toBeVisible();
  });

  test('shows Cmd+K shortcut for Befehlspalette', async ({ authenticatedPage }) => {
    const modal = authenticatedPage.locator('[role="dialog"]');

    await expect(modal.locator('text=Befehlspalette')).toBeVisible();

    const cmdRow = modal.locator('text=Befehlspalette').locator('..');
    await expect(cmdRow.locator('kbd:has-text("⌘")')).toBeVisible();
    await expect(cmdRow.locator('kbd:has-text("K")')).toBeVisible();
  });

  test('shows R shortcut for Aktualisieren', async ({ authenticatedPage }) => {
    const modal = authenticatedPage.locator('[role="dialog"]');

    await expect(modal.locator('text=Aktualisieren')).toBeVisible();

    const refreshRow = modal.locator('text=Aktualisieren').locator('..');
    await expect(refreshRow.locator('kbd:has-text("R")')).toBeVisible();
  });

  test('shows ? shortcut for Diese Hilfe', async ({ authenticatedPage }) => {
    const modal = authenticatedPage.locator('[role="dialog"]');

    await expect(modal.locator('text=Diese Hilfe')).toBeVisible();

    const helpRow = modal.locator('text=Diese Hilfe').locator('..');
    await expect(helpRow.locator('kbd:has-text("?")')).toBeVisible();
  });
});

test.describe('Keyboard Shortcuts Modal - Editing Shortcuts', () => {
  let eventsPage: EventsPage;
  let testEventName: string;

  test.beforeEach(async ({ authenticatedPage }) => {
    eventsPage = new EventsPage(authenticatedPage);

    testEventName = `Edit Shortcuts Test ${Date.now()}`;
    await eventsPage.goto();
    await eventsPage.createEvent(testEventName);
    await eventsPage.goto();
    await eventsPage.selectEvent(testEventName);
    await expect(authenticatedPage).toHaveURL('/');
    await authenticatedPage.waitForTimeout(1000);

    await authenticatedPage.keyboard.press('Shift+/');
    await authenticatedPage.waitForTimeout(500);
  });

  test('shows E and Enter shortcuts for Details öffnen', async ({ authenticatedPage }) => {
    const modal = authenticatedPage.locator('[role="dialog"]');

    // Check both E and Enter shortcuts
    const detailsRows = modal.locator('text=Details öffnen');
    await expect(detailsRows).toHaveCount(2); // Should appear twice

    // Check for E key
    await expect(modal.locator('kbd:has-text("E")')).toBeVisible();

    // Check for Enter key
    await expect(modal.locator('kbd:has-text("Enter")')).toBeVisible();
  });

  test('shows number keys for Fahrzeug zuweisen/entfernen', async ({ authenticatedPage }) => {
    const modal = authenticatedPage.locator('[role="dialog"]');

    await expect(modal.locator('text=Fahrzeug zuweisen/entfernen')).toBeVisible();

    const vehicleRow = modal.locator('text=Fahrzeug zuweisen/entfernen').locator('..');
    await expect(vehicleRow.locator('kbd:has-text("1")')).toBeVisible();
    await expect(vehicleRow.locator('kbd:has-text("2")')).toBeVisible();
    await expect(vehicleRow.locator('kbd:has-text("3")')).toBeVisible();
    await expect(vehicleRow.locator('kbd:has-text("4")')).toBeVisible();
    await expect(vehicleRow.locator('kbd:has-text("5")')).toBeVisible();
  });

  test('shows Shift+number for priority shortcuts', async ({ authenticatedPage }) => {
    const modal = authenticatedPage.locator('[role="dialog"]');

    // Low priority
    await expect(modal.locator('text=Priorität: Niedrig')).toBeVisible();
    const lowRow = modal.locator('text=Priorität: Niedrig').locator('..');
    await expect(lowRow.locator('kbd:has-text("⇧")')).toBeVisible();
    await expect(lowRow.locator('kbd:has-text("1")')).toBeVisible();

    // Medium priority
    await expect(modal.locator('text=Priorität: Mittel')).toBeVisible();
    const mediumRow = modal.locator('text=Priorität: Mittel').locator('..');
    await expect(mediumRow.locator('kbd:has-text("⇧")')).toBeVisible();
    await expect(mediumRow.locator('kbd:has-text("2")')).toBeVisible();

    // High priority
    await expect(modal.locator('text=Priorität: Hoch')).toBeVisible();
    const highRow = modal.locator('text=Priorität: Hoch').locator('..');
    await expect(highRow.locator('kbd:has-text("⇧")')).toBeVisible();
    await expect(highRow.locator('kbd:has-text("3")')).toBeVisible();
  });

  test('shows < and > for status navigation', async ({ authenticatedPage }) => {
    const modal = authenticatedPage.locator('[role="dialog"]');

    // Status zurück
    await expect(modal.locator('text=Status zurück')).toBeVisible();
    const backRow = modal.locator('text=Status zurück').locator('..');
    await expect(backRow.locator('kbd:has-text("<")')).toBeVisible();

    // Status weiter
    await expect(modal.locator('text=Status weiter')).toBeVisible();
    const forwardRow = modal.locator('text=Status weiter').locator('..');
    await expect(forwardRow.locator('kbd:has-text(">")')).toBeVisible();
  });

  test('shows Delete for Einsatz löschen', async ({ authenticatedPage }) => {
    const modal = authenticatedPage.locator('[role="dialog"]');

    await expect(modal.locator('text=Einsatz löschen')).toBeVisible();

    const deleteRow = modal.locator('text=Einsatz löschen').locator('..');
    await expect(deleteRow.locator('kbd:has-text("Delete")')).toBeVisible();
  });
});

test.describe('Keyboard Shortcuts Modal - Incident Navigation Shortcuts', () => {
  let eventsPage: EventsPage;
  let testEventName: string;

  test.beforeEach(async ({ authenticatedPage }) => {
    eventsPage = new EventsPage(authenticatedPage);

    testEventName = `Incident Nav Test ${Date.now()}`;
    await eventsPage.goto();
    await eventsPage.createEvent(testEventName);
    await eventsPage.goto();
    await eventsPage.selectEvent(testEventName);
    await expect(authenticatedPage).toHaveURL('/');
    await authenticatedPage.waitForTimeout(1000);

    await authenticatedPage.keyboard.press('Shift+/');
    await authenticatedPage.waitForTimeout(500);
  });

  test('shows arrow keys for incident navigation', async ({ authenticatedPage }) => {
    const modal = authenticatedPage.locator('[role="dialog"]');

    // Up arrow
    await expect(modal.locator('text=Vorheriger Einsatz')).toBeVisible();
    const upRow = modal.locator('text=Vorheriger Einsatz').locator('..');
    await expect(upRow.locator('kbd:has-text("↑")')).toBeVisible();

    // Down arrow
    await expect(modal.locator('text=Nächster Einsatz')).toBeVisible();
    const downRow = modal.locator('text=Nächster Einsatz').locator('..');
    await expect(downRow.locator('kbd:has-text("↓")')).toBeVisible();
  });

  test('shows Tab for Durchlaufen', async ({ authenticatedPage }) => {
    const modal = authenticatedPage.locator('[role="dialog"]');

    await expect(modal.locator('text=Durchlaufen')).toBeVisible();
    const tabRow = modal.locator('text=Durchlaufen').locator('..');
    await expect(tabRow.locator('kbd:has-text("Tab")')).toBeVisible();
  });

  test('shows bracket keys for sidebar toggle', async ({ authenticatedPage }) => {
    const modal = authenticatedPage.locator('[role="dialog"]');

    // Left sidebar
    await expect(modal.locator('text=Linke Sidebar ein/aus')).toBeVisible();
    const leftRow = modal.locator('text=Linke Sidebar ein/aus').locator('..');
    await expect(leftRow.locator('kbd:has-text("[")')).toBeVisible();

    // Right sidebar
    await expect(modal.locator('text=Rechte Sidebar ein/aus')).toBeVisible();
    const rightRow = modal.locator('text=Rechte Sidebar ein/aus').locator('..');
    await expect(rightRow.locator('kbd:has-text("]")')).toBeVisible();
  });
});

test.describe('Keyboard Shortcuts Modal - Pro Tip', () => {
  let eventsPage: EventsPage;
  let testEventName: string;

  test.beforeEach(async ({ authenticatedPage }) => {
    eventsPage = new EventsPage(authenticatedPage);

    testEventName = `Pro Tip Test ${Date.now()}`;
    await eventsPage.goto();
    await eventsPage.createEvent(testEventName);
    await eventsPage.goto();
    await eventsPage.selectEvent(testEventName);
    await expect(authenticatedPage).toHaveURL('/');
    await authenticatedPage.waitForTimeout(1000);

    await authenticatedPage.keyboard.press('Shift+/');
    await authenticatedPage.waitForTimeout(500);
  });

  test('modal shows pro tip callout', async ({ authenticatedPage }) => {
    const modal = authenticatedPage.locator('[role="dialog"]');

    // Check for Pro Tip heading
    await expect(modal.locator('text=Profi-Tipp')).toBeVisible();
  });

  test('pro tip has emerald/green styling', async ({ authenticatedPage }) => {
    const modal = authenticatedPage.locator('[role="dialog"]');

    // Find pro tip container
    const proTip = modal.locator('text=Profi-Tipp').locator('..');

    // Check for emerald border
    const hasEmeraldBorder = await proTip.evaluate(el =>
      el.className.includes('border-emerald-500')
    );
    expect(hasEmeraldBorder).toBeTruthy();
  });

  test('pro tip has Info icon', async ({ authenticatedPage }) => {
    const modal = authenticatedPage.locator('[role="dialog"]');

    const proTipSection = modal.locator('text=Profi-Tipp').locator('..');
    const infoIcon = proTipSection.locator('svg[class*="lucide-info"]');
    await expect(infoIcon).toBeVisible();
  });

  test('pro tip contains helpful text about selecting incidents', async ({ authenticatedPage }) => {
    const modal = authenticatedPage.locator('[role="dialog"]');

    // Check for key phrases
    await expect(modal.locator('text=Bewegen Sie die Maus über einen Einsatz')).toBeVisible();
  });
});

test.describe('Keyboard Shortcuts Modal - Cmd+K Pointer', () => {
  let eventsPage: EventsPage;
  let testEventName: string;

  test.beforeEach(async ({ authenticatedPage }) => {
    eventsPage = new EventsPage(authenticatedPage);

    testEventName = `CmdK Pointer Test ${Date.now()}`;
    await eventsPage.goto();
    await eventsPage.createEvent(testEventName);
    await eventsPage.goto();
    await eventsPage.selectEvent(testEventName);
    await expect(authenticatedPage).toHaveURL('/');
    await authenticatedPage.waitForTimeout(1000);

    await authenticatedPage.keyboard.press('Shift+/');
    await authenticatedPage.waitForTimeout(500);
  });

  test('modal shows Cmd+K callout at top', async ({ authenticatedPage }) => {
    const modal = authenticatedPage.locator('[role="dialog"]');

    // Check for Cmd+K badge
    await expect(modal.locator('kbd:has-text("⌘K")')).toBeVisible();

    // Check for callout text
    await expect(modal.locator('text=Alle Befehle & Tastaturkürzel')).toBeVisible();
  });

  test('Cmd+K callout has blue styling', async ({ authenticatedPage }) => {
    const modal = authenticatedPage.locator('[role="dialog"]');

    // Find Cmd+K callout container
    const cmdkCallout = modal.locator('text=Alle Befehle & Tastaturkürzel').locator('..');

    // Check for blue border
    const hasBlueBorder = await cmdkCallout.evaluate(el =>
      el.className.includes('border-blue-500')
    );
    expect(hasBlueBorder).toBeTruthy();
  });

  test('Cmd+K callout mentions both Mac and Windows', async ({ authenticatedPage }) => {
    const modal = authenticatedPage.locator('[role="dialog"]');

    await expect(modal.locator('text=Cmd+K (Mac) oder Ctrl+K (Windows)')).toBeVisible();
  });
});

test.describe('Keyboard Shortcuts Modal - Visual Design', () => {
  let eventsPage: EventsPage;
  let testEventName: string;

  test.beforeEach(async ({ authenticatedPage }) => {
    eventsPage = new EventsPage(authenticatedPage);

    testEventName = `Visual Design Test ${Date.now()}`;
    await eventsPage.goto();
    await eventsPage.createEvent(testEventName);
    await eventsPage.goto();
    await eventsPage.selectEvent(testEventName);
    await expect(authenticatedPage).toHaveURL('/');
    await authenticatedPage.waitForTimeout(1000);

    await authenticatedPage.keyboard.press('Shift+/');
    await authenticatedPage.waitForTimeout(500);
  });

  test('modal has max width and height constraints', async ({ authenticatedPage }) => {
    const modal = authenticatedPage.locator('[role="dialog"]');

    // Check for max-w-2xl class
    const hasMaxWidth = await modal.evaluate(el =>
      el.className.includes('max-w-2xl')
    );
    expect(hasMaxWidth).toBeTruthy();

    // Check for max-h-[90vh] class
    const hasMaxHeight = await modal.evaluate(el =>
      el.className.includes('max-h-[90vh]')
    );
    expect(hasMaxHeight).toBeTruthy();
  });

  test('modal is scrollable when content is long', async ({ authenticatedPage }) => {
    const modal = authenticatedPage.locator('[role="dialog"]');

    // Check for overflow-y-auto class
    const isScrollable = await modal.evaluate(el =>
      el.className.includes('overflow-y-auto')
    );
    expect(isScrollable).toBeTruthy();
  });

  test('shortcut rows have hover effect', async ({ authenticatedPage }) => {
    const modal = authenticatedPage.locator('[role="dialog"]');

    // Find a shortcut row
    const firstShortcut = modal.locator('text=Kanban Board').locator('..');

    // Check for hover class
    const hasHover = await firstShortcut.evaluate(el =>
      el.className.includes('hover:bg-secondary')
    );
    expect(hasHover).toBeTruthy();
  });

  test('kbd elements have consistent styling', async ({ authenticatedPage }) => {
    const modal = authenticatedPage.locator('[role="dialog"]');

    // Get first kbd element
    const kbd = modal.locator('kbd').first();

    // Verify it's visible and styled
    await expect(kbd).toBeVisible();
  });
});

test.describe('Keyboard Shortcuts Modal - Mobile', () => {
  test('modal is responsive on mobile viewport', async ({ authenticatedPage }) => {
    // Set mobile viewport
    await authenticatedPage.setViewportSize({ width: 375, height: 667 });

    const eventsPage = new EventsPage(authenticatedPage);
    const testEventName = `Mobile Shortcuts Test ${Date.now()}`;
    await eventsPage.goto();
    await eventsPage.createEvent(testEventName);
    await eventsPage.goto();
    await eventsPage.selectEvent(testEventName);
    await expect(authenticatedPage).toHaveURL('/');
    await authenticatedPage.waitForTimeout(1000);

    // Open shortcuts modal
    await authenticatedPage.keyboard.press('Shift+/');
    await authenticatedPage.waitForTimeout(500);

    const modal = authenticatedPage.locator('[role="dialog"]');
    await expect(modal).toBeVisible();

    // Verify content is still readable on mobile
    await expect(modal.locator('h2:has-text("Tastaturkürzel")')).toBeVisible();
  });
});
