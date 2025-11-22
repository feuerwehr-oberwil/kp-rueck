# E2E Testing Plan - KP Rück Dashboard

**Last Updated:** 2025-11-19
**Testing Framework:** Playwright with TypeScript
**Target Application:** https://fwo-kp.up.railway.app/combined

---

## Table of Contents

- [Overview](#overview)
- [Testing Stack](#testing-stack)
- [Folder Structure](#folder-structure)
- [Test Scenarios](#test-scenarios)
- [Implementation Components](#implementation-components)
- [Configuration](#configuration)
- [CI/CD Integration](#cicd-integration)
- [Best Practices](#best-practices)
- [Execution Strategy](#execution-strategy)
- [Next Steps](#next-steps)

---

## Overview

This document outlines the comprehensive end-to-end testing strategy for the KP Rück tactical firefighting operations dashboard. The testing suite covers all essential features including authentication, event management, incident workflows, resource assignment, real-time notifications, and map integrations.

### Goals

- **Complete coverage** of all critical user workflows
- **Fast, reliable** tests that can run in CI/CD
- **Maintainable** test architecture using Page Object Model
- **Parallel execution** for quick feedback
- **Cross-browser** compatibility testing
- **Accessibility** compliance verification

---

## Testing Stack

### Core Technologies

- **Framework**: Playwright 1.56+
- **Language**: TypeScript with strict type safety
- **Test Organization**: Page Object Model (POM) + Custom Fixtures
- **Test Data**: Factory pattern + API seeding
- **Reporting**: HTML reports, trace viewer, screenshots on failure
- **CI/CD**: GitHub Actions with parallel execution

### Additional Tools

- `@axe-core/playwright` - Accessibility testing
- `playwright-bdd` (optional) - Gherkin syntax support
- Custom visual regression helpers
- WebSocket testing utilities

---

## Folder Structure

```
frontend/
├── tests/
│   ├── e2e/                           # End-to-end test suites
│   │   ├── 01-auth/
│   │   │   ├── login.spec.ts
│   │   │   └── session-management.spec.ts
│   │   ├── 02-events/
│   │   │   ├── event-creation.spec.ts
│   │   │   ├── event-configuration.spec.ts
│   │   │   └── event-management.spec.ts
│   │   ├── 03-check-in/
│   │   │   ├── personnel-check-in.spec.ts
│   │   │   ├── qr-code-generation.spec.ts
│   │   │   └── check-in-list.spec.ts
│   │   ├── 04-incidents/
│   │   │   ├── incident-creation.spec.ts
│   │   │   ├── incident-workflow.spec.ts
│   │   │   ├── resource-assignment.spec.ts
│   │   │   └── status-transitions.spec.ts
│   │   ├── 05-vehicles/
│   │   │   ├── vehicle-status.spec.ts
│   │   │   └── driver-assignment.spec.ts
│   │   ├── 06-reko/
│   │   │   ├── reko-link-generation.spec.ts
│   │   │   ├── reko-form-submission.spec.ts
│   │   │   └── reko-qr-code.spec.ts
│   │   ├── 07-drag-drop/
│   │   │   ├── personnel-assignment.spec.ts
│   │   │   ├── material-assignment.spec.ts
│   │   │   └── incident-status-change.spec.ts
│   │   ├── 08-maps/
│   │   │   ├── lagekarte.spec.ts
│   │   │   ├── combined-view.spec.ts
│   │   │   └── map-interactions.spec.ts
│   │   ├── 09-notifications/
│   │   │   ├── notification-system.spec.ts
│   │   │   ├── resource-warnings.spec.ts
│   │   │   └── real-time-updates.spec.ts
│   │   └── 10-workflows/
│   │       ├── complete-incident-workflow.spec.ts
│   │       ├── resource-lifecycle.spec.ts
│   │       └── multi-user-scenarios.spec.ts
│   │
│   ├── fixtures/                      # Test fixtures for setup/teardown
│   │   ├── auth.fixture.ts
│   │   ├── event.fixture.ts
│   │   ├── incident.fixture.ts
│   │   ├── personnel.fixture.ts
│   │   └── database.fixture.ts
│   │
│   ├── pages/                         # Page Object Model classes
│   │   ├── base.page.ts
│   │   ├── login.page.ts
│   │   ├── dashboard.page.ts
│   │   ├── events.page.ts
│   │   ├── incident-dialog.page.ts
│   │   ├── check-in.page.ts
│   │   ├── vehicle-status.page.ts
│   │   ├── reko-link.page.ts
│   │   ├── map.page.ts
│   │   └── notifications.page.ts
│   │
│   ├── helpers/                       # Reusable helper functions
│   │   ├── drag-drop.helper.ts
│   │   ├── qr-code.helper.ts
│   │   ├── api.helper.ts
│   │   ├── wait.helper.ts
│   │   ├── screenshot.helper.ts
│   │   └── assertions.helper.ts
│   │
│   ├── data/                          # Test data factories
│   │   ├── test-users.ts
│   │   ├── test-events.ts
│   │   ├── test-incidents.ts
│   │   ├── test-personnel.ts
│   │   └── factories.ts
│   │
│   └── config/                        # Test configuration
│       ├── test-ids.ts                # Data-testid constants
│       ├── routes.ts                  # URL constants
│       └── timeouts.ts                # Timeout configurations
│
├── playwright.config.ts               # Main Playwright config
└── playwright-ci.config.ts            # CI-specific config
```

---

## Test Scenarios

### 1. Authentication & Dashboard Access

**File:** `tests/e2e/01-auth/login.spec.ts`

#### Test Cases
- ✅ Login with valid credentials
- ✅ Show error for invalid credentials
- ✅ Persist session after refresh
- ✅ Redirect to login when accessing protected routes
- ✅ Logout successfully clears session
- ✅ Session timeout after inactivity

**Example:**
```typescript
test.describe('Authentication', () => {
  test('should login with valid credentials', async ({ page, loginPage }) => {
    await loginPage.goto();
    await loginPage.login('testuser', 'password123');
    await expect(page).toHaveURL(/\/combined/);
  });

  test('should show error for invalid credentials', async ({ page, loginPage }) => {
    await loginPage.goto();
    await loginPage.login('invalid', 'wrong');
    await expect(loginPage.errorMessage).toBeVisible();
  });
});
```

---

### 2. Event Creation & Management

**File:** `tests/e2e/02-events/event-creation.spec.ts`

#### Test Cases
- ✅ Create new event with custom name
- ✅ Toggle training flag (Übung)
- ✅ Toggle Divera auto-attach setting
- ✅ Verify correct date and time display
- ✅ Open existing event
- ✅ Archive/delete event
- ✅ Filter events (active/archived/training)

**Example:**
```typescript
test.describe('Event Creation', () => {
  test('should create new event with training flag', async ({ page, eventsPage }) => {
    await eventsPage.goto();
    await eventsPage.clickNewEvent();
    await eventsPage.fillEventName('Übung Grossbrand 2025');
    await eventsPage.toggleTrainingFlag(true);
    await eventsPage.toggleDiveraAutoAttach(true);
    await eventsPage.submitEvent();

    await expect(eventsPage.eventCard('Übung Grossbrand 2025')).toBeVisible();
  });

  test('should verify correct date and time display', async ({ page, eventsPage }) => {
    const now = new Date();
    await eventsPage.goto();
    await expect(eventsPage.dateTimeDisplay).toContainText(
      now.toLocaleDateString('de-CH')
    );
  });
});
```

---

### 3. Check-in System

**File:** `tests/e2e/03-check-in/qr-code-generation.spec.ts`

#### Test Cases
- ✅ Open check-in window
- ✅ Display QR code for check-in
- ✅ QR code contains valid URL
- ✅ Add personnel via check-in
- ✅ Personnel appears in check-in list
- ✅ Close QR code window
- ✅ Check-out personnel

**Example:**
```typescript
test.describe('Check-in QR Code', () => {
  test('should open check-in window and display QR code', async ({
    page,
    dashboardPage,
    checkInPage
  }) => {
    await dashboardPage.openEvent('Test Event');
    await checkInPage.openCheckInWindow();

    const qrCode = await checkInPage.getQRCode();
    expect(qrCode).toBeTruthy();
    await expect(checkInPage.qrCodeImage).toBeVisible();
  });

  test('should add personnel via check-in', async ({
    page,
    checkInPage,
    apiHelper
  }) => {
    // Simulate QR code scan by calling API directly
    const personnelId = await apiHelper.checkInPersonnel('Max Muster');

    await checkInPage.waitForPersonnelInList('Max Muster');
    await expect(checkInPage.personnelListItem('Max Muster')).toBeVisible();
  });

  test('should close QR code window', async ({ checkInPage }) => {
    await checkInPage.openCheckInWindow();
    await checkInPage.closeQRCodeWindow();
    await expect(checkInPage.qrCodeDialog).not.toBeVisible();
  });
});
```

---

### 4. Vehicle Status Management

**File:** `tests/e2e/05-vehicles/vehicle-status.spec.ts`

#### Test Cases
- ✅ Open vehicle status window (Fahrzeigstatus)
- ✅ Display all available vehicles
- ✅ Assign driver to vehicle
- ✅ Unassign driver from vehicle
- ✅ Update vehicle availability status
- ✅ Close vehicle status window

**Example:**
```typescript
test.describe('Vehicle Status', () => {
  test('should open and close vehicle status window', async ({
    page,
    dashboardPage,
    vehicleStatusPage
  }) => {
    await dashboardPage.goto();
    await vehicleStatusPage.openVehicleStatus();
    await expect(vehicleStatusPage.dialog).toBeVisible();

    await vehicleStatusPage.close();
    await expect(vehicleStatusPage.dialog).not.toBeVisible();
  });

  test('should assign driver to vehicle', async ({
    vehicleStatusPage,
    apiHelper
  }) => {
    const vehicle = await apiHelper.getVehicle('TLF 1');
    const personnel = await apiHelper.getPersonnel('John Doe');

    await vehicleStatusPage.selectVehicle(vehicle.name);
    await vehicleStatusPage.assignDriver(personnel.name);

    await expect(vehicleStatusPage.driverAssignment(vehicle.name))
      .toContainText(personnel.name);
  });
});
```

---

### 5. Incident Creation & Management

**File:** `tests/e2e/04-incidents/incident-creation.spec.ts`

#### Test Cases
- ✅ Create new incident
- ✅ Add address/location
- ✅ Select criticality level
- ✅ Select event type (Brandbekämpfung, Strassenrettung, etc.)
- ✅ Assign vehicle to incident
- ✅ Assign driver to incident vehicle
- ✅ Edit existing incident
- ✅ Delete incident

**Example:**
```typescript
test.describe('Incident Creation', () => {
  test('should create complete incident with all details', async ({
    page,
    dashboardPage,
    incidentDialog
  }) => {
    await dashboardPage.createNewIncident();

    // Fill incident details
    await incidentDialog.fillAddress('Hauptstrasse 1, 4410 Liestal');
    await incidentDialog.selectCriticality('critical');
    await incidentDialog.selectEventType('brandbekaempfung');

    // Assign vehicle
    await incidentDialog.selectVehicle('TLF 1');

    // Assign driver
    await incidentDialog.assignDriver('Max Muster');

    await incidentDialog.submit();

    // Verify incident appears on dashboard
    await expect(dashboardPage.incidentCard('Hauptstrasse 1')).toBeVisible();
  });
});
```

---

### 6. Reko (Reconnaissance) Link

**File:** `tests/e2e/06-reko/reko-link-generation.spec.ts`

#### Test Cases
- ✅ Open Reko link window
- ✅ Generate Reko QR code
- ✅ QR code contains valid Reko URL
- ✅ Access Reko form via link
- ✅ Fill out Reko form (observations, hazards)
- ✅ Upload photos to Reko form
- ✅ Submit Reko report
- ✅ Verify Reko data appears in incident

**Example:**
```typescript
test.describe('Reko Link', () => {
  test('should generate and display Reko QR code', async ({
    page,
    incidentDialog,
    rekoLinkPage
  }) => {
    await incidentDialog.openIncident('Test Incident');
    await rekoLinkPage.openRekoLinkWindow();

    const qrCode = await rekoLinkPage.getQRCode();
    expect(qrCode).toBeTruthy();
    await expect(rekoLinkPage.qrCodeImage).toBeVisible();
  });

  test('should submit Reko form with data', async ({
    page,
    rekoLinkPage,
    apiHelper
  }) => {
    const rekoUrl = await apiHelper.getRekoLink('incident-123');
    await page.goto(rekoUrl);

    await rekoLinkPage.fillObservations('Gebäude brennt im 2. OG');
    await rekoLinkPage.fillHazards('Gasflaschen im Keller');
    await rekoLinkPage.uploadPhoto('test-image.jpg');
    await rekoLinkPage.submit();

    await expect(page.locator('text=Erfolgreich gesendet')).toBeVisible();
  });
});
```

---

### 7. Drag & Drop Resource Assignment

**File:** `tests/e2e/07-drag-drop/personnel-assignment.spec.ts`

#### Test Cases
- ✅ Drag personnel to incident card
- ✅ Drag materials to incident card
- ✅ Verify resource status changes to "assigned"
- ✅ Prevent dragging already-assigned resources
- ✅ Visual feedback during drag operation
- ✅ Undo resource assignment (drag back)

**Example:**
```typescript
test.describe('Drag & Drop Personnel', () => {
  test('should drag personnel to incident', async ({
    page,
    dashboardPage,
    dragDropHelper
  }) => {
    const personnel = await dashboardPage.getAvailablePersonnel('Anna Schmidt');
    const incident = await dashboardPage.getIncidentCard('Hauptstrasse 1');

    await dragDropHelper.dragAndDrop(personnel, incident);

    // Verify personnel is assigned
    await expect(incident.locator('text=Anna Schmidt')).toBeVisible();

    // Verify personnel status changed to 'assigned'
    const updatedPersonnel = await dashboardPage.getPersonnel('Anna Schmidt');
    await expect(updatedPersonnel.statusIndicator).toHaveClass(/assigned/);
  });

  test('should drag materials to incident', async ({
    page,
    dashboardPage,
    dragDropHelper
  }) => {
    const material = await dashboardPage.getAvailableMaterial('Atemschutz 1');
    const incident = await dashboardPage.getIncidentCard('Hauptstrasse 1');

    await dragDropHelper.dragAndDrop(material, incident);

    await expect(incident.locator('text=Atemschutz 1')).toBeVisible();
  });
});
```

---

### 8. Incident Status Workflow

**File:** `tests/e2e/04-incidents/status-transitions.spec.ts`

#### Test Cases
- ✅ Move incident from "Neu" to "In Bearbeitung"
- ✅ Move incident from "In Bearbeitung" to "Erledigt"
- ✅ Verify status transitions update in real-time
- ✅ Free resources when incident moved to "Erledigt"
- ✅ Personnel becomes available after incident completion
- ✅ Vehicles become available after incident completion
- ✅ Materials become available after incident completion
- ✅ Incident disappears from map when marked "Erledigt"

**Example:**
```typescript
test.describe('Incident Status Workflow', () => {
  test('should move incident through all statuses', async ({
    page,
    dashboardPage,
    dragDropHelper
  }) => {
    const incident = await dashboardPage.getIncidentCard('Test Incident');

    // New → In Progress
    await dragDropHelper.dragToColumn(incident, 'In Bearbeitung');
    await expect(dashboardPage.column('In Bearbeitung'))
      .toContainText('Test Incident');

    // In Progress → Done
    await dragDropHelper.dragToColumn(incident, 'Erledigt');
    await expect(dashboardPage.column('Erledigt'))
      .toContainText('Test Incident');
  });

  test('should free resources when incident marked as done', async ({
    page,
    dashboardPage,
    apiHelper
  }) => {
    // Create incident with assigned resources
    const incident = await apiHelper.createIncidentWithResources({
      location: 'Test Location',
      personnel: ['Max Muster'],
      vehicles: ['TLF 1'],
      materials: ['Atemschutz 1']
    });

    // Move to Done
    await dashboardPage.moveIncidentToStatus(incident.id, 'done');

    // Verify resources are freed
    await expect(dashboardPage.personnel('Max Muster').statusIndicator)
      .toHaveClass(/available/);
    await expect(dashboardPage.vehicle('TLF 1').statusIndicator)
      .toHaveClass(/available/);
    await expect(dashboardPage.material('Atemschutz 1').statusIndicator)
      .toHaveClass(/available/);
  });

  test('should remove completed incident from map', async ({
    page,
    dashboardPage,
    mapPage
  }) => {
    const incidentId = 'test-incident-123';

    // Mark as done
    await dashboardPage.moveIncidentToStatus(incidentId, 'done');

    // Check map
    await mapPage.goto();
    await expect(mapPage.incidentMarker(incidentId)).not.toBeVisible();
  });
});
```

---

### 9. Map Views (Lagekarte & Combined)

**File:** `tests/e2e/08-maps/lagekarte.spec.ts`, `combined-view.spec.ts`

#### Test Cases
- ✅ Display all active incidents on Lagekarte
- ✅ Show incident details on marker click
- ✅ Filter incidents by status on map
- ✅ Combined view shows both kanban and map
- ✅ Resize panels in combined view
- ✅ Sync incident selection between kanban and map
- ✅ Verify map controls (zoom, pan, center)

**Example:**
```typescript
test.describe('Lagekarte (Map View)', () => {
  test('should display all active incidents on map', async ({
    page,
    mapPage,
    apiHelper
  }) => {
    const incidents = await apiHelper.getActiveIncidents();
    await mapPage.goto();

    for (const incident of incidents) {
      await expect(mapPage.incidentMarker(incident.id)).toBeVisible();
    }
  });

  test('should show incident details on marker click', async ({
    page,
    mapPage
  }) => {
    await mapPage.goto();
    const marker = await mapPage.getFirstIncidentMarker();
    await marker.click();

    await expect(mapPage.incidentPopup).toBeVisible();
    await expect(mapPage.incidentPopup).toContainText(/Hauptstrasse/);
  });
});

test.describe('Combined View', () => {
  test('should show both kanban and map in split view', async ({
    page,
    combinedViewPage
  }) => {
    await combinedViewPage.goto();

    await expect(combinedViewPage.kanbanPanel).toBeVisible();
    await expect(combinedViewPage.mapPanel).toBeVisible();
  });

  test('should sync incident selection between views', async ({
    page,
    combinedViewPage
  }) => {
    await combinedViewPage.goto();

    // Click incident on kanban
    await combinedViewPage.kanbanIncident('Test Incident').click();

    // Verify map centers on incident
    await expect(combinedViewPage.mapPanel).toHaveAttribute(
      'data-selected-incident',
      'test-incident-id'
    );
  });

  test('should resize panels', async ({ page, combinedViewPage }) => {
    await combinedViewPage.goto();

    const initialWidth = await combinedViewPage.kanbanPanel.evaluate(
      el => el.clientWidth
    );

    await combinedViewPage.resizePanel(300);

    const newWidth = await combinedViewPage.kanbanPanel.evaluate(
      el => el.clientWidth
    );

    expect(newWidth).not.toBe(initialWidth);
  });
});
```

---

### 10. Notifications System

**File:** `tests/e2e/09-notifications/notification-system.spec.ts`

#### Test Cases
- ✅ Show notification badge with count
- ✅ Display notification popup on click
- ✅ Show real-time notifications (WebSocket)
- ✅ Warn when no personnel available
- ✅ Warn when no vehicles available
- ✅ Clear notifications
- ✅ Mark notifications as read

**Example:**
```typescript
test.describe('Notifications', () => {
  test('should show notification badge with count', async ({
    page,
    dashboardPage,
    notificationsPage,
    websocketHelper
  }) => {
    await dashboardPage.goto();

    // Simulate real-time notification via WebSocket
    await websocketHelper.sendNotification({
      type: 'resource_assigned',
      message: 'Max Muster zu Einsatz hinzugefügt'
    });

    // Verify badge shows count
    await expect(notificationsPage.badge).toHaveText('1');
  });

  test('should display notification popup', async ({
    page,
    notificationsPage
  }) => {
    await notificationsPage.clickNotificationBell();
    await expect(notificationsPage.popup).toBeVisible();
    await expect(notificationsPage.notificationList).toBeVisible();
  });

  test('should warn when no personnel available', async ({
    page,
    dashboardPage,
    notificationsPage,
    apiHelper
  }) => {
    // Assign all personnel
    await apiHelper.assignAllPersonnel();

    // Try to create new incident
    await dashboardPage.createNewIncident();

    // Verify warning notification
    await expect(notificationsPage.warningToast)
      .toContainText(/Kein Personal verfügbar/);
  });
});
```

---

### 11. Resource Conflict Warnings

**File:** `tests/e2e/11-resource-conflicts/conflict-detection.spec.ts`

#### Test Cases
- ✅ Warn when assigning already-assigned personnel
- ✅ Warn when assigning already-assigned vehicle
- ✅ Warn when assigning already-assigned material
- ✅ Allow force-reassignment with confirmation
- ✅ Prevent drag-drop of assigned resources (visual feedback)
- ✅ Show resource current assignment in warning dialog
- ✅ Update resource status immediately after reassignment
- ✅ Handle concurrent assignment attempts gracefully
- ✅ Display all current assignments in personnel/vehicle/material cards

**Example:**
```typescript
test.describe('Resource Conflict Warnings', () => {
  test('should warn when assigning already-assigned personnel', async ({
    page,
    dashboardPage,
    dragDropHelper,
    apiHelper
  }) => {
    // Setup: Create two incidents
    const incident1 = await apiHelper.createIncident({
      location: 'Hauptstrasse 1, Liestal'
    });
    const incident2 = await apiHelper.createIncident({
      location: 'Bahnhofstrasse 5, Liestal'
    });

    // Assign personnel to first incident
    await dashboardPage.goto();
    const personnel = await dashboardPage.getAvailablePersonnel('Max Muster');
    const incidentCard1 = await dashboardPage.getIncidentCard('Hauptstrasse 1');
    await dragDropHelper.dragAndDrop(personnel, incidentCard1);

    // Verify personnel is assigned
    await expect(dashboardPage.personnel('Max Muster').statusIndicator)
      .toHaveClass(/assigned|bg-amber-500/);

    // Try to assign same personnel to second incident
    const personnelAssigned = await dashboardPage.getPersonnel('Max Muster');
    const incidentCard2 = await dashboardPage.getIncidentCard('Bahnhofstrasse 5');
    await dragDropHelper.dragAndDrop(personnelAssigned, incidentCard2);

    // Verify conflict warning appears
    const warningDialog = page.locator('[data-testid="resource-conflict-dialog"]');
    await expect(warningDialog).toBeVisible();
    await expect(warningDialog).toContainText('Max Muster');
    await expect(warningDialog).toContainText('bereits zugewiesen');
    await expect(warningDialog).toContainText('Hauptstrasse 1');
  });

  test('should allow force-reassignment with confirmation', async ({
    page,
    dashboardPage,
    dragDropHelper,
    apiHelper
  }) => {
    // Setup: Personnel assigned to incident A
    const incident1 = await apiHelper.createIncidentWithResources({
      location: 'Incident A',
      personnel: ['Anna Schmidt']
    });

    await dashboardPage.goto();

    // Try to assign to incident B
    const personnel = await dashboardPage.getPersonnel('Anna Schmidt');
    const incidentB = await dashboardPage.createNewIncident();
    await dashboardPage.fillIncidentLocation(incidentB, 'Incident B');

    await dragDropHelper.dragAndDrop(personnel, incidentB);

    // Warning dialog appears
    const warningDialog = page.locator('[data-testid="resource-conflict-dialog"]');
    await expect(warningDialog).toBeVisible();

    // Click "Reassign" button
    await page.click('[data-testid="force-reassign-btn"]');

    // Verify personnel moved to incident B
    await expect(incidentB.locator('text=Anna Schmidt')).toBeVisible();
    await expect(dashboardPage.getIncidentCard('Incident A')
      .locator('text=Anna Schmidt')).not.toBeVisible();

    // Verify status still shows "assigned"
    await expect(dashboardPage.personnel('Anna Schmidt').statusIndicator)
      .toHaveClass(/assigned/);
  });

  test('should prevent drag-drop of assigned resources with visual feedback', async ({
    page,
    dashboardPage,
    dragDropHelper,
    apiHelper
  }) => {
    // Assign all personnel to incidents
    await apiHelper.assignAllPersonnel();

    await dashboardPage.goto();

    // Verify personnel cards show "assigned" status
    const assignedPersonnel = page.locator('[data-testid="personnel-card"]')
      .filter({ has: page.locator('.bg-amber-500') });

    await expect(assignedPersonnel.first()).toBeVisible();

    // Try to start dragging an assigned personnel
    const personnel = await assignedPersonnel.first();
    const boundingBox = await personnel.boundingBox();

    if (boundingBox) {
      await page.mouse.move(
        boundingBox.x + boundingBox.width / 2,
        boundingBox.y + boundingBox.height / 2
      );
      await page.mouse.down();

      // Verify drag cursor or visual feedback
      const dragCursor = page.locator('[data-testid="drag-in-progress"]');
      await expect(dragCursor).toBeVisible();

      // Verify warning indicator appears
      const warningIndicator = page.locator('[data-testid="assigned-warning"]');
      await expect(warningIndicator).toBeVisible();
      await expect(warningIndicator).toContainText('Bereits zugewiesen');

      await page.mouse.up();
    }
  });

  test('should show resource current assignment in warning dialog', async ({
    page,
    dashboardPage,
    apiHelper
  }) => {
    // Create incident with assigned vehicle
    const incident = await apiHelper.createIncidentWithResources({
      location: 'Hauptstrasse 1',
      vehicles: ['TLF 1'],
      personnel: ['John Doe'] // Driver
    });

    await dashboardPage.goto();

    // Try to assign same vehicle to new incident
    const vehicle = await dashboardPage.getVehicle('TLF 1');
    const newIncident = await dashboardPage.getIncidentCard('Test Location');

    await dashboardPage.dragVehicleToIncident(vehicle, newIncident);

    // Verify warning shows current assignment details
    const warningDialog = page.locator('[data-testid="resource-conflict-dialog"]');
    await expect(warningDialog).toBeVisible();
    await expect(warningDialog).toContainText('TLF 1');
    await expect(warningDialog).toContainText('Hauptstrasse 1');
    await expect(warningDialog).toContainText('John Doe'); // Driver info
    await expect(warningDialog).toContainText('Aktuelle Zuweisung');
  });

  test('should warn when assigning vehicle with personnel conflicts', async ({
    page,
    dashboardPage,
    apiHelper
  }) => {
    // Setup: Create incident A with driver assigned directly
    const incidentA = await apiHelper.createIncidentWithResources({
      location: 'Incident A',
      personnel: ['Driver Max']
    });

    // Setup: Create vehicle with same driver assigned
    const vehicle = await apiHelper.getVehicle('TLF 1');
    await apiHelper.assignDriverToVehicle(vehicle.id, 'Driver Max');

    await dashboardPage.goto();

    // Try to assign vehicle to incident B
    const incidentB = await dashboardPage.createNewIncident();
    await dashboardPage.fillIncidentLocation(incidentB, 'Incident B');

    await dashboardPage.assignVehicleToIncident('TLF 1', incidentB);

    // Verify cascade conflict warning
    const warningDialog = page.locator('[data-testid="cascade-conflict-dialog"]');
    await expect(warningDialog).toBeVisible();
    await expect(warningDialog).toContainText('Fahrer bereits zugewiesen');
    await expect(warningDialog).toContainText('Driver Max');
    await expect(warningDialog).toContainText('Incident A');
  });

  test('should update resource status immediately after reassignment', async ({
    page,
    dashboardPage,
    apiHelper,
    dragDropHelper
  }) => {
    // Create incident with personnel
    await apiHelper.createIncidentWithResources({
      location: 'Incident A',
      personnel: ['Test Person']
    });

    await dashboardPage.goto();

    // Force-reassign to incident B
    const personnel = await dashboardPage.getPersonnel('Test Person');
    const incidentB = await dashboardPage.getIncidentCard('Incident B');

    await dragDropHelper.dragAndDrop(personnel, incidentB);
    await page.click('[data-testid="force-reassign-btn"]');

    // Verify immediate status update (no polling delay)
    await expect(incidentB.locator('text=Test Person')).toBeVisible({ timeout: 1000 });

    // Verify old incident no longer shows personnel (within 5s polling window)
    const incidentA = await dashboardPage.getIncidentCard('Incident A');
    await expect(incidentA.locator('text=Test Person'))
      .not.toBeVisible({ timeout: 6000 });
  });

  test('should handle concurrent assignment attempts gracefully', async ({
    browser,
    apiHelper
  }) => {
    // Create two browser contexts (simulate two users)
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();

    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    // Both login
    await Promise.all([
      loginUser(page1, 'user1', 'password'),
      loginUser(page2, 'user2', 'password')
    ]);

    // Both navigate to dashboard
    await Promise.all([
      page1.goto('/combined'),
      page2.goto('/combined')
    ]);

    // User 1 assigns personnel to incident A
    const personnel1 = page1.locator('[data-testid="personnel-card"]')
      .filter({ hasText: 'Max Muster' });
    const incidentA = page1.locator('[data-testid="incident-card"]')
      .filter({ hasText: 'Incident A' });

    // User 2 tries to assign same personnel to incident B (nearly simultaneously)
    const personnel2 = page2.locator('[data-testid="personnel-card"]')
      .filter({ hasText: 'Max Muster' });
    const incidentB = page2.locator('[data-testid="incident-card"]')
      .filter({ hasText: 'Incident B' });

    // Concurrent drag-drop
    const dragDropHelper1 = new DragDropHelper(page1);
    const dragDropHelper2 = new DragDropHelper(page2);

    await Promise.all([
      dragDropHelper1.dragAndDrop(personnel1, incidentA),
      dragDropHelper2.dragAndDrop(personnel2, incidentB)
    ]);

    // One should succeed, one should show conflict warning
    const warning1 = page1.locator('[data-testid="resource-conflict-dialog"]');
    const warning2 = page2.locator('[data-testid="resource-conflict-dialog"]');

    // At least one warning should appear
    const warnings = await Promise.race([
      warning1.isVisible(),
      warning2.isVisible()
    ]);

    expect(warnings).toBe(true);

    await context1.close();
    await context2.close();
  });
});

test.describe('Resource Conflict Prevention', () => {
  test('should disable drag for assigned resources in strict mode', async ({
    page,
    dashboardPage,
    settingsPage
  }) => {
    // Enable strict mode in settings
    await settingsPage.goto();
    await settingsPage.enableSetting('strict_resource_mode');

    await dashboardPage.goto();

    // Assign personnel
    await dashboardPage.assignPersonnelToIncident('Max Muster', 'Incident A');

    // Try to drag assigned personnel
    const personnel = await dashboardPage.getPersonnel('Max Muster');
    const isDraggable = await personnel.evaluate((el) => {
      return el.getAttribute('draggable') === 'true';
    });

    expect(isDraggable).toBe(false);

    // Verify visual indicator
    await expect(personnel).toHaveClass(/cursor-not-allowed|pointer-events-none/);
  });

  test('should show all assignments in resource card tooltip', async ({
    page,
    dashboardPage,
    apiHelper
  }) => {
    // Assign personnel to multiple roles
    const personnel = await apiHelper.getPersonnel('Max Muster');
    const incident = await apiHelper.createIncident({ location: 'Test' });
    const vehicle = await apiHelper.getVehicle('TLF 1');

    // Assign as personnel to incident AND as vehicle driver
    await apiHelper.assignPersonnelToIncident(incident.id, personnel.id);
    await apiHelper.assignDriverToVehicle(vehicle.id, personnel.id);

    await dashboardPage.goto();

    // Hover over personnel card
    const personnelCard = await dashboardPage.getPersonnel('Max Muster');
    await personnelCard.hover();

    // Verify tooltip shows all assignments
    const tooltip = page.locator('[data-testid="resource-tooltip"]');
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText('Test'); // Incident assignment
    await expect(tooltip).toContainText('TLF 1'); // Vehicle driver assignment
    await expect(tooltip).toContainText('2 Zuweisungen'); // Assignment count
  });
});
```

---

### 12. Offline Map Tiles

**File:** `tests/e2e/12-offline-maps/tile-modes.spec.ts`

#### Test Cases
- ✅ Switch between online/offline/auto modes in Settings
- ✅ Load online tiles (OpenStreetMap) in online mode
- ✅ Load offline tiles (TileServer GL) in offline mode
- ✅ Auto mode falls back to offline when online fails
- ✅ Display current tile mode indicator on map
- ✅ Verify tile server health status
- ✅ Persist map mode preference across sessions
- ✅ Handle tile server unavailability gracefully
- ✅ Show offline tile coverage area
- ✅ Test tile loading performance (online vs offline)
- ✅ Verify correct attribution for tile sources

**Example:**
```typescript
test.describe('Offline Map Tiles', () => {
  test('should switch between online/offline/auto modes in Settings', async ({
    page,
    dashboardPage
  }) => {
    await dashboardPage.goto();

    // Open settings
    await page.click('[data-testid="settings-button"]');
    await expect(page.locator('[data-testid="settings-dialog"]')).toBeVisible();

    // Find map mode setting
    const mapModeSetting = page.locator('[data-testid="setting-map_mode"]');
    await expect(mapModeSetting).toBeVisible();

    // Verify current mode (default: auto)
    const currentMode = await mapModeSetting.locator('select').inputValue();
    expect(currentMode).toBe('auto');

    // Switch to offline mode
    await mapModeSetting.locator('select').selectOption('offline');
    await page.click('[data-testid="save-settings-btn"]');

    // Verify success notification
    await expect(page.locator('text=Einstellungen gespeichert')).toBeVisible();

    // Close and reopen settings
    await page.click('[data-testid="close-settings-btn"]');
    await page.click('[data-testid="settings-button"]');

    // Verify mode persisted
    const persistedMode = await page.locator('[data-testid="setting-map_mode"]')
      .locator('select').inputValue();
    expect(persistedMode).toBe('offline');
  });

  test('should load online tiles in online mode', async ({
    page,
    mapPage,
    settingsPage
  }) => {
    // Set to online mode
    await settingsPage.goto();
    await settingsPage.setSetting('map_mode', 'online');

    // Navigate to map
    await mapPage.goto();

    // Wait for map to load
    await page.waitForSelector('.leaflet-container', { state: 'visible' });

    // Verify tile URLs point to OpenStreetMap
    const tileRequests: string[] = [];
    page.on('request', request => {
      if (request.url().includes('.png') && request.url().includes('tile')) {
        tileRequests.push(request.url());
      }
    });

    // Trigger tile load by panning map
    await page.evaluate(() => {
      const map = (window as any).map;
      map.setView([47.4814, 7.7478], 13); // Basel-Landschaft coordinates
    });

    await page.waitForTimeout(2000); // Wait for tiles to load

    // Verify OSM tiles were requested
    const osmTiles = tileRequests.filter(url =>
      url.includes('tile.openstreetmap.org') || url.includes('osm')
    );
    expect(osmTiles.length).toBeGreaterThan(0);

    // Verify tile server (port 8080) was NOT used
    const offlineTiles = tileRequests.filter(url => url.includes(':8080'));
    expect(offlineTiles.length).toBe(0);
  });

  test('should load offline tiles in offline mode', async ({
    page,
    mapPage,
    settingsPage
  }) => {
    // Set to offline mode
    await settingsPage.goto();
    await settingsPage.setSetting('map_mode', 'offline');

    // Navigate to map
    await mapPage.goto();

    // Verify mode indicator shows "Offline"
    const modeIndicator = page.locator('[data-testid="map-mode-indicator"]');
    await expect(modeIndicator).toBeVisible();
    await expect(modeIndicator).toContainText('Offline');

    // Verify tile server health
    const healthStatus = page.locator('[data-testid="tile-server-health"]');
    await expect(healthStatus).toHaveClass(/healthy|bg-emerald-500/);

    // Track tile requests
    const tileRequests: string[] = [];
    page.on('request', request => {
      if (request.url().includes('.png')) {
        tileRequests.push(request.url());
      }
    });

    // Pan map to load tiles
    await page.evaluate(() => {
      const map = (window as any).map;
      map.setView([47.4814, 7.7478], 13);
    });

    await page.waitForTimeout(2000);

    // Verify offline tiles (port 8080) were requested
    const offlineTiles = tileRequests.filter(url => url.includes('localhost:8080'));
    expect(offlineTiles.length).toBeGreaterThan(0);

    // Verify OSM tiles were NOT requested
    const osmTiles = tileRequests.filter(url => url.includes('openstreetmap.org'));
    expect(osmTiles.length).toBe(0);
  });

  test('should fallback to offline when online fails in auto mode', async ({
    page,
    mapPage,
    settingsPage,
    context
  }) => {
    // Set to auto mode
    await settingsPage.goto();
    await settingsPage.setSetting('map_mode', 'auto');

    // Block OpenStreetMap requests to simulate network failure
    await context.route('**/tile.openstreetmap.org/**', route => {
      route.abort('failed');
    });

    // Navigate to map
    await mapPage.goto();

    // Wait for map initialization
    await page.waitForSelector('.leaflet-container');

    // Track tile requests
    const tileRequests: string[] = [];
    page.on('request', request => {
      if (request.url().includes('.png')) {
        tileRequests.push(request.url());
      }
    });

    // Trigger tile load
    await page.evaluate(() => {
      const map = (window as any).map;
      map.setView([47.4814, 7.7478], 13);
    });

    await page.waitForTimeout(3000); // Wait for fallback

    // Verify mode switched to offline
    const modeIndicator = page.locator('[data-testid="map-mode-indicator"]');
    await expect(modeIndicator).toContainText(/Offline|Automatisch \(Offline\)/);

    // Verify offline tiles were loaded after fallback
    const offlineTiles = tileRequests.filter(url => url.includes('localhost:8080'));
    expect(offlineTiles.length).toBeGreaterThan(0);
  });

  test('should display tile server health status', async ({
    page,
    dashboardPage
  }) => {
    await dashboardPage.goto();

    // Open settings
    await page.click('[data-testid="settings-button"]');

    // Find tile server health indicator
    const healthIndicator = page.locator('[data-testid="tile-server-health"]');
    await expect(healthIndicator).toBeVisible();

    // Verify health check ran
    const healthStatus = await healthIndicator.getAttribute('data-status');
    expect(['healthy', 'unavailable']).toContain(healthStatus);

    if (healthStatus === 'healthy') {
      await expect(healthIndicator).toHaveClass(/bg-emerald-500/);
      await expect(healthIndicator).toContainText(/Online|Verfügbar/);
    } else {
      await expect(healthIndicator).toHaveClass(/bg-red-500/);
      await expect(healthIndicator).toContainText(/Offline|Nicht verfügbar/);
    }

    // Click to view details
    await healthIndicator.click();
    const detailsDialog = page.locator('[data-testid="tile-server-details"]');
    await expect(detailsDialog).toBeVisible();
    await expect(detailsDialog).toContainText('http://localhost:8080');
  });

  test('should handle tile server unavailability gracefully', async ({
    page,
    mapPage,
    settingsPage,
    context
  }) => {
    // Block tile server requests
    await context.route('**/localhost:8080/**', route => {
      route.abort('failed');
    });

    // Set to offline mode
    await settingsPage.goto();
    await settingsPage.setSetting('map_mode', 'offline');

    // Navigate to map
    await mapPage.goto();

    // Verify error message appears
    const errorMessage = page.locator('[data-testid="tile-error-message"]');
    await expect(errorMessage).toBeVisible();
    await expect(errorMessage).toContainText(/Tile-Server nicht erreichbar|Offline-Karten nicht verfügbar/);

    // Verify fallback to online is offered
    const switchButton = page.locator('[data-testid="switch-to-online-btn"]');
    await expect(switchButton).toBeVisible();

    // Click to switch
    await switchButton.click();

    // Verify mode changed to online
    await page.waitForTimeout(1000);
    const modeIndicator = page.locator('[data-testid="map-mode-indicator"]');
    await expect(modeIndicator).toContainText('Online');
  });

  test('should show offline tile coverage area', async ({
    page,
    mapPage,
    settingsPage
  }) => {
    await settingsPage.goto();
    await settingsPage.setSetting('map_mode', 'offline');

    await mapPage.goto();

    // Click on coverage info button
    await page.click('[data-testid="tile-coverage-info"]');

    // Verify coverage dialog
    const coverageDialog = page.locator('[data-testid="coverage-dialog"]');
    await expect(coverageDialog).toBeVisible();
    await expect(coverageDialog).toContainText('Basel-Landschaft');
    await expect(coverageDialog).toContainText('Zoom: 0-17');
    await expect(coverageDialog).toContainText(/~1-2 GB|Größe/);

    // Verify coverage boundary shown on map
    const coverageBoundary = page.locator('.leaflet-overlay-pane')
      .locator('[data-testid="coverage-boundary"]');
    await expect(coverageBoundary).toBeVisible();
  });

  test('should persist map mode preference across sessions', async ({
    page,
    settingsPage,
    mapPage,
    context
  }) => {
    // Set to offline mode
    await settingsPage.goto();
    await settingsPage.setSetting('map_mode', 'offline');

    // Clear cookies and reload (simulate new session)
    await context.clearCookies();
    await page.reload();

    // Login again
    await page.goto('/login');
    await page.fill('[name="username"]', 'testuser');
    await page.fill('[name="password"]', 'password');
    await page.click('[type="submit"]');

    // Go to map
    await mapPage.goto();

    // Verify mode is still offline
    const modeIndicator = page.locator('[data-testid="map-mode-indicator"]');
    await expect(modeIndicator).toContainText('Offline');

    // Verify setting persisted in settings dialog
    await page.click('[data-testid="settings-button"]');
    const mapMode = await page.locator('[data-testid="setting-map_mode"]')
      .locator('select').inputValue();
    expect(mapMode).toBe('offline');
  });

  test('should compare tile loading performance', async ({
    page,
    mapPage,
    settingsPage
  }) => {
    // Test online mode performance
    await settingsPage.goto();
    await settingsPage.setSetting('map_mode', 'online');
    await mapPage.goto();

    const onlineStartTime = Date.now();
    await page.evaluate(() => {
      const map = (window as any).map;
      map.setView([47.4814, 7.7478], 13);
    });
    await page.waitForLoadState('networkidle');
    const onlineLoadTime = Date.now() - onlineStartTime;

    console.log(`Online tiles loaded in: ${onlineLoadTime}ms`);

    // Test offline mode performance
    await settingsPage.goto();
    await settingsPage.setSetting('map_mode', 'offline');
    await mapPage.goto();

    const offlineStartTime = Date.now();
    await page.evaluate(() => {
      const map = (window as any).map;
      map.setView([47.4814, 7.7478], 13);
    });
    await page.waitForLoadState('networkidle');
    const offlineLoadTime = Date.now() - offlineStartTime;

    console.log(`Offline tiles loaded in: ${offlineLoadTime}ms`);

    // Offline should typically be faster (local tiles)
    // But this is environment-dependent, so just log for now
    expect(offlineLoadTime).toBeLessThan(10000); // Should load within 10s
    expect(onlineLoadTime).toBeLessThan(15000); // Online may be slower
  });

  test('should verify correct attribution for tile sources', async ({
    page,
    mapPage,
    settingsPage
  }) => {
    // Test online attribution
    await settingsPage.goto();
    await settingsPage.setSetting('map_mode', 'online');
    await mapPage.goto();

    let attribution = page.locator('.leaflet-control-attribution');
    await expect(attribution).toBeVisible();
    await expect(attribution).toContainText(/OpenStreetMap|OSM/);

    // Test offline attribution
    await settingsPage.goto();
    await settingsPage.setSetting('map_mode', 'offline');
    await mapPage.goto();

    attribution = page.locator('.leaflet-control-attribution');
    await expect(attribution).toBeVisible();
    await expect(attribution).toContainText(/OpenStreetMap|TileServer GL|Offline/);
  });
});

test.describe('Tile Server Administration', () => {
  test('should display tile server management UI', async ({
    page,
    settingsPage
  }) => {
    await settingsPage.goto();

    // Navigate to advanced settings or admin panel
    await page.click('[data-testid="advanced-settings-tab"]');

    // Verify tile server section
    const tileServerSection = page.locator('[data-testid="tile-server-section"]');
    await expect(tileServerSection).toBeVisible();

    // Verify server URL displayed
    await expect(tileServerSection).toContainText('http://localhost:8080');

    // Verify health check button
    const healthCheckBtn = page.locator('[data-testid="run-health-check-btn"]');
    await expect(healthCheckBtn).toBeVisible();

    await healthCheckBtn.click();

    // Verify health check result
    await page.waitForTimeout(1000);
    const healthResult = page.locator('[data-testid="health-check-result"]');
    await expect(healthResult).toBeVisible();
  });

  test('should show tile cache statistics', async ({
    page,
    settingsPage
  }) => {
    await settingsPage.goto();
    await page.click('[data-testid="advanced-settings-tab"]');

    const cacheStats = page.locator('[data-testid="tile-cache-stats"]');
    await expect(cacheStats).toBeVisible();

    // Verify stats displayed
    await expect(cacheStats).toContainText(/Größe|Size/);
    await expect(cacheStats).toContainText(/Kacheln|Tiles/);
    await expect(cacheStats).toContainText(/Zoom.*0-17/);
  });
});
```

---

## Implementation Components

### 1. Page Object Model Base Class

**File:** `tests/pages/base.page.ts`

```typescript
import { Page, Locator, expect } from '@playwright/test';

export class BasePage {
  constructor(protected page: Page) {}

  async goto(path: string = '') {
    await this.page.goto(`${process.env.BASE_URL}${path}`);
    await this.waitForPageLoad();
  }

  async waitForPageLoad() {
    await this.page.waitForLoadState('networkidle');
    await this.page.waitForLoadState('domcontentloaded');
  }

  async screenshot(name: string) {
    await this.page.screenshot({
      path: `screenshots/${name}.png`,
      fullPage: true
    });
  }

  async clickAndWait(selector: string, waitFor?: string) {
    await this.page.click(selector);
    if (waitFor) {
      await this.page.waitForSelector(waitFor);
    }
  }

  // Reusable assertion helpers
  async expectVisible(selector: string) {
    await expect(this.page.locator(selector)).toBeVisible();
  }

  async expectText(selector: string, text: string) {
    await expect(this.page.locator(selector)).toContainText(text);
  }

  async waitForNotification(message: string) {
    await expect(
      this.page.locator('[role="alert"]', { hasText: message })
    ).toBeVisible({ timeout: 5000 });
  }
}
```

### 2. Login Page Object

**File:** `tests/pages/login.page.ts`

```typescript
import { Page, Locator } from '@playwright/test';
import { BasePage } from './base.page';

export class LoginPage extends BasePage {
  readonly usernameInput: Locator;
  readonly passwordInput: Locator;
  readonly loginButton: Locator;
  readonly errorMessage: Locator;

  constructor(page: Page) {
    super(page);
    this.usernameInput = page.locator('input[name="username"]');
    this.passwordInput = page.locator('input[name="password"]');
    this.loginButton = page.locator('button[type="submit"]');
    this.errorMessage = page.locator('[role="alert"]');
  }

  async goto() {
    await super.goto('/login');
  }

  async login(username: string, password: string) {
    await this.usernameInput.fill(username);
    await this.passwordInput.fill(password);
    await this.loginButton.click();
  }

  async expectLoginError(message: string) {
    await this.errorMessage.waitFor({ state: 'visible' });
    await this.expectText('[role="alert"]', message);
  }
}
```

### 3. Dashboard Page Object

**File:** `tests/pages/dashboard.page.ts`

```typescript
import { Page, Locator } from '@playwright/test';
import { BasePage } from './base.page';

export class DashboardPage extends BasePage {
  readonly newIncidentButton: Locator;
  readonly searchInput: Locator;
  readonly dateTimeDisplay: Locator;

  constructor(page: Page) {
    super(page);
    this.newIncidentButton = page.locator('[data-testid="new-incident-btn"]');
    this.searchInput = page.locator('#search-input');
    this.dateTimeDisplay = page.locator('[data-testid="datetime-display"]');
  }

  async goto() {
    await super.goto('/combined');
  }

  async createNewIncident() {
    await this.newIncidentButton.click();
    await this.page.waitForSelector('[data-testid="incident-dialog"]');
  }

  async openEvent(eventName: string) {
    await this.page.click(`text="${eventName}"`);
    await this.waitForPageLoad();
  }

  incidentCard(location: string): Locator {
    return this.page.locator(`[data-testid="incident-card"]`, {
      hasText: location
    });
  }

  getAvailablePersonnel(name: string): Locator {
    return this.page.locator(`[data-testid="personnel-card"]`, {
      hasText: name
    }).filter({ has: this.page.locator('.bg-emerald-500') });
  }

  getAvailableMaterial(name: string): Locator {
    return this.page.locator(`[data-testid="material-card"]`, {
      hasText: name
    }).filter({ has: this.page.locator('.bg-emerald-500') });
  }

  personnel(name: string) {
    const card = this.page.locator(`[data-testid="personnel-card"]`, {
      hasText: name
    });
    return {
      card,
      statusIndicator: card.locator('[data-testid="status-indicator"]')
    };
  }

  vehicle(name: string) {
    const card = this.page.locator(`[data-testid="vehicle-card"]`, {
      hasText: name
    });
    return {
      card,
      statusIndicator: card.locator('[data-testid="status-indicator"]')
    };
  }

  material(name: string) {
    const card = this.page.locator(`[data-testid="material-card"]`, {
      hasText: name
    });
    return {
      card,
      statusIndicator: card.locator('[data-testid="status-indicator"]')
    };
  }

  column(name: string): Locator {
    return this.page.locator(`[data-testid="kanban-column"]`, { hasText: name });
  }

  async moveIncidentToStatus(incidentId: string, status: string) {
    const incident = this.page.locator(`[data-testid="incident-${incidentId}"]`);
    const targetColumn = this.column(status);

    // Use drag drop helper
    const dragDropHelper = new (await import('../helpers/drag-drop.helper')).DragDropHelper(this.page);
    await dragDropHelper.dragAndDrop(incident, targetColumn);
  }
}
```

### 4. Incident Dialog Page Object

**File:** `tests/pages/incident-dialog.page.ts`

```typescript
import { Page, Locator } from '@playwright/test';
import { BasePage } from './base.page';

export class IncidentDialogPage extends BasePage {
  readonly dialog: Locator;
  readonly addressInput: Locator;
  readonly criticalitySelect: Locator;
  readonly eventTypeSelect: Locator;
  readonly vehicleSelect: Locator;
  readonly driverSelect: Locator;
  readonly submitButton: Locator;
  readonly cancelButton: Locator;

  constructor(page: Page) {
    super(page);
    this.dialog = page.locator('[data-testid="incident-dialog"]');
    this.addressInput = page.locator('[data-testid="address-input"]');
    this.criticalitySelect = page.locator('[data-testid="criticality-select"]');
    this.eventTypeSelect = page.locator('[data-testid="event-type-select"]');
    this.vehicleSelect = page.locator('[data-testid="vehicle-select"]');
    this.driverSelect = page.locator('[data-testid="driver-select"]');
    this.submitButton = page.locator('[data-testid="submit-incident-btn"]');
    this.cancelButton = page.locator('[data-testid="cancel-incident-btn"]');
  }

  async fillAddress(address: string) {
    await this.addressInput.fill(address);
  }

  async selectCriticality(level: 'normal' | 'critical') {
    await this.criticalitySelect.click();
    await this.page.click(`[data-value="${level}"]`);
  }

  async selectEventType(type: string) {
    await this.eventTypeSelect.click();
    await this.page.click(`[data-value="${type}"]`);
  }

  async selectVehicle(vehicleName: string) {
    await this.vehicleSelect.click();
    await this.page.click(`text="${vehicleName}"`);
  }

  async assignDriver(driverName: string) {
    await this.driverSelect.click();
    await this.page.click(`text="${driverName}"`);
  }

  async submit() {
    await this.submitButton.click();
    await this.dialog.waitFor({ state: 'hidden' });
  }

  async cancel() {
    await this.cancelButton.click();
    await this.dialog.waitFor({ state: 'hidden' });
  }

  async openIncident(incidentName: string) {
    await this.page.click(`[data-testid="incident-card"]`, {
      hasText: incidentName
    });
    await this.dialog.waitFor({ state: 'visible' });
  }
}
```

### 5. Custom Drag & Drop Helper

**File:** `tests/helpers/drag-drop.helper.ts`

```typescript
import { Page, Locator } from '@playwright/test';

export class DragDropHelper {
  constructor(private page: Page) {}

  async dragAndDrop(
    sourceSelector: string | Locator,
    targetSelector: string | Locator,
    options: { steps?: number; delay?: number } = {}
  ) {
    const source = typeof sourceSelector === 'string'
      ? this.page.locator(sourceSelector)
      : sourceSelector;

    const target = typeof targetSelector === 'string'
      ? this.page.locator(targetSelector)
      : targetSelector;

    const sourceBox = await source.boundingBox();
    const targetBox = await target.boundingBox();

    if (!sourceBox || !targetBox) {
      throw new Error('Could not get bounding boxes for drag and drop');
    }

    // Move to source center
    await this.page.mouse.move(
      sourceBox.x + sourceBox.width / 2,
      sourceBox.y + sourceBox.height / 2
    );

    // Start drag
    await this.page.mouse.down();
    await this.page.waitForTimeout(options.delay || 300);

    // Move to target in steps
    await this.page.mouse.move(
      targetBox.x + targetBox.width / 2,
      targetBox.y + targetBox.height / 2,
      { steps: options.steps || 30 }
    );

    await this.page.waitForTimeout(options.delay || 500);

    // Drop
    await this.page.mouse.up();
    await this.page.waitForTimeout(300);
  }

  async dragToColumn(incident: Locator, columnName: string) {
    const column = this.page.locator(`[data-testid="kanban-column"]`, {
      hasText: columnName
    });
    await this.dragAndDrop(incident, column);
  }
}
```

### 6. Authentication Fixture

**File:** `tests/fixtures/auth.fixture.ts`

```typescript
import { test as base, expect } from '@playwright/test';
import { LoginPage } from '../pages/login.page';
import { DashboardPage } from '../pages/dashboard.page';

type AuthFixtures = {
  authenticatedPage: Page;
  loginPage: LoginPage;
  dashboardPage: DashboardPage;
};

export const test = base.extend<AuthFixtures>({
  authenticatedPage: async ({ page }, use) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.login(
      process.env.TEST_USERNAME || 'testuser',
      process.env.TEST_PASSWORD || 'password123'
    );
    await page.waitForURL(/\/combined/);
    await use(page);
  },

  loginPage: async ({ page }, use) => {
    const loginPage = new LoginPage(page);
    await use(loginPage);
  },

  dashboardPage: async ({ page }, use) => {
    const dashboardPage = new DashboardPage(page);
    await use(dashboardPage);
  },
});

export { expect };
```

### 7. API Helper for Test Data

**File:** `tests/helpers/api.helper.ts`

```typescript
import type { ApiEvent, ApiEventCreate, ApiIncident } from '@/lib/api-client';

export class APIHelper {
  constructor(private baseURL: string, private cookies?: string) {}

  async createEvent(data: Partial<ApiEventCreate>): Promise<ApiEvent> {
    const response = await fetch(`${this.baseURL}/api/events/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': this.cookies || ''
      },
      body: JSON.stringify({
        name: data.name || 'Test Event',
        training_flag: data.training_flag ?? false,
        auto_attach_divera: data.auto_attach_divera ?? false,
      }),
      credentials: 'include',
    });
    return response.json();
  }

  async createIncident(data: any): Promise<ApiIncident> {
    const response = await fetch(`${this.baseURL}/api/incidents/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': this.cookies || ''
      },
      body: JSON.stringify(data),
      credentials: 'include',
    });
    return response.json();
  }

  async createIncidentWithResources(data: {
    location: string;
    personnel?: string[];
    vehicles?: string[];
    materials?: string[];
  }): Promise<ApiIncident> {
    // Create incident
    const incident = await this.createIncident({
      location: data.location,
      address: data.location,
    });

    // Assign resources
    if (data.personnel) {
      for (const name of data.personnel) {
        const person = await this.getPersonnelByName(name);
        await this.assignPersonnelToIncident(incident.id, person.id);
      }
    }

    if (data.vehicles) {
      for (const name of data.vehicles) {
        const vehicle = await this.getVehicleByName(name);
        await this.assignVehicleToIncident(incident.id, vehicle.id);
      }
    }

    if (data.materials) {
      for (const name of data.materials) {
        const material = await this.getMaterialByName(name);
        await this.assignMaterialToIncident(incident.id, material.id);
      }
    }

    return incident;
  }

  async getPersonnelByName(name: string) {
    const response = await fetch(`${this.baseURL}/api/personnel/`, {
      headers: { 'Cookie': this.cookies || '' },
      credentials: 'include',
    });
    const personnel = await response.json();
    return personnel.find((p: any) => p.name === name);
  }

  async getVehicleByName(name: string) {
    const response = await fetch(`${this.baseURL}/api/vehicles/`, {
      headers: { 'Cookie': this.cookies || '' },
      credentials: 'include',
    });
    const vehicles = await response.json();
    return vehicles.find((v: any) => v.name === name);
  }

  async getMaterialByName(name: string) {
    const response = await fetch(`${this.baseURL}/api/materials/`, {
      headers: { 'Cookie': this.cookies || '' },
      credentials: 'include',
    });
    const materials = await response.json();
    return materials.find((m: any) => m.name === name);
  }

  async assignPersonnelToIncident(incidentId: string, personnelId: string) {
    await fetch(`${this.baseURL}/api/incidents/${incidentId}/personnel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': this.cookies || ''
      },
      body: JSON.stringify({ personnel_id: personnelId }),
      credentials: 'include',
    });
  }

  async assignVehicleToIncident(incidentId: string, vehicleId: string) {
    await fetch(`${this.baseURL}/api/incidents/${incidentId}/vehicles`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': this.cookies || ''
      },
      body: JSON.stringify({ vehicle_id: vehicleId }),
      credentials: 'include',
    });
  }

  async assignMaterialToIncident(incidentId: string, materialId: string) {
    await fetch(`${this.baseURL}/api/incidents/${incidentId}/materials`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': this.cookies || ''
      },
      body: JSON.stringify({ material_id: materialId }),
      credentials: 'include',
    });
  }

  async getActiveIncidents(): Promise<ApiIncident[]> {
    const response = await fetch(`${this.baseURL}/api/incidents/?status=active`, {
      headers: { 'Cookie': this.cookies || '' },
      credentials: 'include',
    });
    return response.json();
  }

  async assignAllPersonnel() {
    const personnel = await this.getAllPersonnel();
    const incident = await this.createIncident({
      location: 'Dummy Incident for Full Assignment'
    });

    for (const person of personnel) {
      await this.assignPersonnelToIncident(incident.id, person.id);
    }
  }

  async getAllPersonnel() {
    const response = await fetch(`${this.baseURL}/api/personnel/`, {
      headers: { 'Cookie': this.cookies || '' },
      credentials: 'include',
    });
    return response.json();
  }

  async cleanupTestData() {
    // Delete test events, incidents, etc.
    await fetch(`${this.baseURL}/api/test/cleanup`, {
      method: 'POST',
      headers: { 'Cookie': this.cookies || '' },
      credentials: 'include',
    });
  }

  async checkInPersonnel(name: string): Promise<string> {
    const personnel = await this.getPersonnelByName(name);
    const response = await fetch(`${this.baseURL}/api/personnel/${personnel.id}/check-in`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': this.cookies || ''
      },
      credentials: 'include',
    });
    const result = await response.json();
    return result.id;
  }

  async getRekoLink(incidentId: string): Promise<string> {
    const response = await fetch(`${this.baseURL}/api/incidents/${incidentId}/reko-link`, {
      headers: { 'Cookie': this.cookies || '' },
      credentials: 'include',
    });
    const data = await response.json();
    return data.url;
  }

  async getVehicle(name: string) {
    return this.getVehicleByName(name);
  }

  async getPersonnel(name: string) {
    return this.getPersonnelByName(name);
  }

  // Resource Conflict Helpers
  async assignDriverToVehicle(vehicleId: string, personnelId: string) {
    await fetch(`${this.baseURL}/api/vehicles/${vehicleId}/driver`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': this.cookies || ''
      },
      body: JSON.stringify({ personnel_id: personnelId }),
      credentials: 'include',
    });
  }

  async getResourceAssignments(resourceType: 'personnel' | 'vehicle' | 'material', resourceId: string) {
    const response = await fetch(
      `${this.baseURL}/api/${resourceType}/${resourceId}/assignments`,
      {
        headers: { 'Cookie': this.cookies || '' },
        credentials: 'include',
      }
    );
    return response.json();
  }

  async forceReassignResource(
    resourceType: 'personnel' | 'vehicle' | 'material',
    resourceId: string,
    fromIncidentId: string,
    toIncidentId: string
  ) {
    await fetch(`${this.baseURL}/api/incidents/${toIncidentId}/${resourceType}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': this.cookies || ''
      },
      body: JSON.stringify({
        [`${resourceType}_id`]: resourceId,
        force: true,
        from_incident_id: fromIncidentId
      }),
      credentials: 'include',
    });
  }

  // Offline Map Tiles Helpers
  async getTileServerHealth() {
    const response = await fetch('http://localhost:8080/health', {
      method: 'GET',
    });
    return response.json();
  }

  async getSetting(key: string) {
    const response = await fetch(`${this.baseURL}/api/settings/`, {
      headers: { 'Cookie': this.cookies || '' },
      credentials: 'include',
    });
    const settings = await response.json();
    return settings.find((s: any) => s.key === key);
  }

  async updateSetting(key: string, value: string) {
    await fetch(`${this.baseURL}/api/settings/`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': this.cookies || ''
      },
      body: JSON.stringify({ key, value }),
      credentials: 'include',
    });
  }

  async getTileCacheStats() {
    const response = await fetch('http://localhost:8080/data/basel-landschaft.json', {
      method: 'GET',
    });
    return response.json();
  }
}
```

### 8. Test Data Factories

**File:** `tests/data/factories.ts`

```typescript
import type { ApiEventCreate } from '@/lib/api-client';

export const EventFactory = {
  default: (): ApiEventCreate => ({
    name: `Test Event ${Date.now()}`,
    training_flag: false,
    auto_attach_divera: false,
  }),

  training: (): ApiEventCreate => ({
    name: `Übung ${Date.now()}`,
    training_flag: true,
    auto_attach_divera: false,
  }),

  withDivera: (): ApiEventCreate => ({
    name: `Divera Event ${Date.now()}`,
    training_flag: false,
    auto_attach_divera: true,
  }),
};

export const IncidentFactory = {
  default: () => ({
    location: 'Hauptstrasse 1, 4410 Liestal',
    description: 'Test incident description',
    criticality: 'normal' as const,
    type: 'brandbekaempfung' as const,
  }),

  critical: () => ({
    ...IncidentFactory.default(),
    criticality: 'critical' as const,
  }),

  technical: () => ({
    ...IncidentFactory.default(),
    type: 'strassenrettung' as const,
  }),
};

export const PersonnelFactory = {
  default: (index: number) => ({
    name: `Test Person ${index}`,
    role: 'Feuerwehrmann',
    availability: 'available' as const,
  }),

  driver: (index: number) => ({
    name: `Driver ${index}`,
    role: 'Fahrer',
    availability: 'available' as const,
  }),
};
```

---

## Configuration

### Playwright Main Config

**File:** `frontend/playwright.config.ts`

```typescript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 4 : 2,

  reporter: [
    ['html', { open: 'never' }],
    ['junit', { outputFile: 'test-results/junit.xml' }],
    ['json', { outputFile: 'test-results/results.json' }],
    ['list'],
  ],

  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',

    actionTimeout: 10000,
    navigationTimeout: 30000,
  },

  projects: [
    {
      name: 'setup',
      testMatch: /.*\.setup\.ts/,
    },

    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'playwright/.auth/user.json',
      },
      dependencies: ['setup'],
    },

    {
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'],
        storageState: 'playwright/.auth/user.json',
      },
      dependencies: ['setup'],
    },

    {
      name: 'webkit',
      use: {
        ...devices['Desktop Safari'],
        storageState: 'playwright/.auth/user.json',
      },
      dependencies: ['setup'],
    },

    {
      name: 'mobile-chrome',
      use: {
        ...devices['Pixel 5'],
        storageState: 'playwright/.auth/user.json',
      },
      dependencies: ['setup'],
    },
  ],

  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
```

### Environment Variables

**File:** `.env.test` (create this file)

```bash
# Test Environment Configuration
BASE_URL=http://localhost:3000
API_URL=http://localhost:8000

# Test User Credentials
TEST_USERNAME=testuser
TEST_PASSWORD=password123

# Database
DATABASE_URL=postgresql://postgres:testpassword@localhost:5432/kprueck_test

# Test Timeouts
DEFAULT_TIMEOUT=10000
NAVIGATION_TIMEOUT=30000
```

---

## CI/CD Integration

### GitHub Actions Workflow

**File:** `.github/workflows/e2e-tests.yml`

```yaml
name: E2E Tests

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  schedule:
    - cron: '0 2 * * *'  # Run nightly at 2 AM

jobs:
  test:
    timeout-minutes: 60
    runs-on: ubuntu-latest

    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_PASSWORD: testpassword
          POSTGRES_DB: kprueck_test
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
        ports:
          - 5432:5432

    strategy:
      matrix:
        browser: [chromium, firefox, webkit]

    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v2
        with:
          version: 9

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'

      - name: Install frontend dependencies
        run: cd frontend && pnpm install

      - name: Install Playwright browsers
        run: cd frontend && pnpm exec playwright install --with-deps ${{ matrix.browser }}

      - name: Setup Python
        uses: actions/setup-python@v4
        with:
          python-version: '3.12'

      - name: Setup backend
        run: |
          cd backend
          pip install uv
          uv sync
          DATABASE_URL=postgresql://postgres:testpassword@localhost:5432/kprueck_test uv run python -m app.seed

      - name: Start backend server
        run: |
          cd backend
          DATABASE_URL=postgresql://postgres:testpassword@localhost:5432/kprueck_test uv run uvicorn app.main:app &
          sleep 5

      - name: Run E2E tests
        run: cd frontend && pnpm test --project=${{ matrix.browser }}
        env:
          BASE_URL: http://localhost:3000
          DATABASE_URL: postgresql://postgres:testpassword@localhost:5432/kprueck_test

      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: playwright-report-${{ matrix.browser }}
          path: frontend/playwright-report/
          retention-days: 30

      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: test-results-${{ matrix.browser }}
          path: frontend/test-results/
          retention-days: 30

  smoke-tests:
    timeout-minutes: 20
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v2
        with:
          version: 9

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'

      - name: Install dependencies
        run: cd frontend && pnpm install

      - name: Install Playwright
        run: cd frontend && pnpm exec playwright install --with-deps chromium

      - name: Run smoke tests against production
        run: cd frontend && pnpm test --grep "@smoke"
        env:
          BASE_URL: https://fwo-kp.up.railway.app
```

---

## Best Practices

### 1. Use Data-testid Attributes

Add `data-testid` attributes to all interactive elements in your components:

```tsx
// components/incident-card.tsx
<div data-testid={`incident-${incident.id}`}>
  <h3 data-testid="incident-location">{incident.location}</h3>
  <button data-testid="edit-incident-btn">Edit</button>
  <button data-testid="delete-incident-btn">Delete</button>
  <div data-testid="status-indicator" className={statusClass} />
</div>
```

### 2. Custom Matchers

Extend Playwright's expect with custom matchers for domain-specific assertions:

```typescript
// tests/helpers/assertions.helper.ts
import { expect as baseExpect, Locator } from '@playwright/test';

export const expect = baseExpect.extend({
  async toHavePersonnelAssigned(received: Locator, personnelName: string) {
    const hasPersonnel = await received
      .locator(`[data-testid="assigned-personnel"]`)
      .locator(`text=${personnelName}`)
      .isVisible();

    return {
      pass: hasPersonnel,
      message: () => `Expected incident to have ${personnelName} assigned`,
    };
  },

  async toBeAvailable(received: Locator) {
    const indicator = received.locator('[data-testid="status-indicator"]');
    const isAvailable = await indicator.evaluate((el) => {
      return el.classList.contains('bg-emerald-500');
    });

    return {
      pass: isAvailable,
      message: () => `Expected resource to be available`,
    };
  },
});
```

### 3. Visual Regression Testing

```typescript
// tests/e2e/visual/incident-card.spec.ts
import { test, expect } from '@playwright/test';

test('incident card matches design', async ({ page }) => {
  await page.goto('/combined');

  const incidentCard = page.locator('[data-testid="incident-card"]').first();
  await incidentCard.waitFor({ state: 'visible' });

  // Compare against baseline screenshot
  await expect(incidentCard).toHaveScreenshot('incident-card.png', {
    maxDiffPixels: 100,
  });
});

test('dashboard layout matches design', async ({ page }) => {
  await page.goto('/combined');
  await page.waitForLoadState('networkidle');

  await expect(page).toHaveScreenshot('dashboard-layout.png', {
    fullPage: true,
    maxDiffPixelRatio: 0.02,
  });
});
```

### 4. Accessibility Testing

```typescript
// tests/e2e/accessibility/dashboard.spec.ts
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('Accessibility', () => {
  test('dashboard should be accessible', async ({ page }) => {
    await page.goto('/combined');

    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    expect(accessibilityScanResults.violations).toEqual([]);
  });

  test('incident dialog should be accessible', async ({ page }) => {
    await page.goto('/combined');
    await page.click('[data-testid="new-incident-btn"]');

    const accessibilityScanResults = await new AxeBuilder({ page })
      .include('[data-testid="incident-dialog"]')
      .analyze();

    expect(accessibilityScanResults.violations).toEqual([]);
  });
});
```

### 5. Test Isolation

Each test should be independent and clean up after itself:

```typescript
import { test } from './fixtures/auth.fixture';

test.describe('Incident Workflow', () => {
  let testIncidentId: string;

  test.afterEach(async ({ page }, testInfo) => {
    // Cleanup: delete test incident
    if (testIncidentId) {
      await fetch(`${process.env.API_URL}/api/incidents/${testIncidentId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
    }

    // Take screenshot on failure
    if (testInfo.status !== 'passed') {
      await page.screenshot({
        path: `screenshots/failure-${testInfo.title}.png`,
        fullPage: true
      });
    }
  });

  test('should create and complete incident', async ({ page, dashboardPage }) => {
    // Test implementation...
  });
});
```

### 6. Retry Logic for Flaky Tests

```typescript
// For flaky tests, use custom retry logic
test.describe('Real-time Updates', () => {
  test('should receive WebSocket notification', async ({ page }) => {
    // Retry up to 3 times with exponential backoff
    await test.step('wait for notification', async () => {
      await expect(async () => {
        const notification = page.locator('[role="alert"]');
        await expect(notification).toBeVisible({ timeout: 5000 });
      }).toPass({ timeout: 15000 });
    });
  });
});
```

### 7. Performance Testing

```typescript
// tests/e2e/performance/load-times.spec.ts
import { test, expect } from '@playwright/test';

test('dashboard should load within 3 seconds', async ({ page }) => {
  const startTime = Date.now();

  await page.goto('/combined');
  await page.waitForLoadState('networkidle');

  const loadTime = Date.now() - startTime;

  expect(loadTime).toBeLessThan(3000);
  console.log(`Dashboard loaded in ${loadTime}ms`);
});

test('API response times should be acceptable', async ({ page }) => {
  await page.goto('/combined');

  const [response] = await Promise.all([
    page.waitForResponse(resp => resp.url().includes('/api/incidents')),
    page.reload(),
  ]);

  const timing = response.timing();
  expect(timing.responseEnd - timing.requestStart).toBeLessThan(1000);
});
```

---

## Execution Strategy

### Test Organization Priority

1. **Smoke Tests** (Critical paths) - Run on every commit
   - Login flow
   - Create event
   - Create incident
   - Basic drag & drop

2. **Regression Tests** (Full suite) - Run nightly
   - All test scenarios
   - All browsers
   - Visual regression

3. **Visual Regression** - Run on UI changes
   - Screenshot comparisons
   - Component-level tests

4. **Performance Tests** - Run weekly
   - Load time benchmarks
   - API response times

### Parallel Execution

Group independent tests to run in parallel:

```typescript
// playwright.config.ts
export default defineConfig({
  fullyParallel: true,
  workers: process.env.CI ? 4 : 2,

  // Shard tests across multiple machines in CI
  shard: process.env.CI ? {
    current: parseInt(process.env.SHARD_INDEX || '1'),
    total: parseInt(process.env.SHARD_TOTAL || '1')
  } : undefined,
});
```

### Test Tagging

Use tags to categorize tests:

```typescript
test.describe('Login @smoke @auth', () => {
  // Smoke tests for authentication
});

test.describe('Drag and Drop @regression @ui', () => {
  // Regression tests for UI interactions
});

test.describe('Performance @performance @weekly', () => {
  // Performance benchmarks
});
```

Run specific tags:

```bash
# Run only smoke tests
pnpm test --grep @smoke

# Run all tests except performance
pnpm test --grep-invert @performance
```

---

## Implementation Progress

**Last Updated:** 2025-11-19

### Phase 1: Foundation ✅ COMPLETE

**Completed:**
- ✅ Set up comprehensive folder structure (`e2e/`, `fixtures/`, `pages/`, `helpers/`, `data/`, `config/`)
- ✅ Created base Page Object Model class (`pages/base.page.ts`)
- ✅ Created Login page object (`pages/login.page.ts`)
- ✅ Created Dashboard page object (`pages/dashboard.page.ts`)
- ✅ Implemented authentication fixture (`fixtures/auth.fixture.ts`)
- ✅ Created drag-drop helper (`helpers/drag-drop.helper.ts`)
- ✅ Created API helper for test data (`helpers/api.helper.ts`)
- ✅ Created test data factories (`data/factories.ts`)
- ✅ Written first authentication test suite (`e2e/01-auth/login.spec.ts`)

**Test Results Summary:**

✅ **PHASE 1 AUTHENTICATION TESTS: ALL PASSING** - 7/7 tests passing ✨

**All Tests Passing:**
- ✅ Should display login page with all required elements
- ✅ Should login with valid credentials
- ✅ Should show error for invalid credentials
- ✅ Should disable login button while loading
- ✅ Should require both username and password
- ✅ Should persist session after page reload
- ✅ Should access protected routes when authenticated

**Test Execution:**
- **Duration:** ~10-12 seconds
- **Stability:** Consistent passing (verified multiple runs)
- **Browser:** Chromium (Desktop Chrome)
- **Environment:** Docker containers (frontend:3000, backend:8000)

**Issues Resolved:**
- ✅ **Issue #1: Login page 404** - FIXED by restarting Next.js dev server
- ✅ **Issue #2: Page load timeout** - FIXED by changing from 'networkidle' to 'load'
- ✅ **Issue #3: Backend API timeout** - FIXED by restarting backend container and allowing it to stabilize

**Root Cause Analysis:**
The backend timeout issue was caused by the backend container constantly reloading due to file system changes during test infrastructure setup. After restarting the backend container and allowing it to stabilize, all authentication tests pass successfully.

**Next Steps:**
- ✅ Phase 1 Foundation Complete - Moving to Phase 2
- 🔄 Phase 2 Event Creation Tests (IN PROGRESS - 10/16 passing)
- [ ] Fix remaining event creation test issues (selector refinement)
- [ ] Begin implementing Incident Management tests (Phase 2)

### Files Created

```
frontend/tests/
├── e2e/
│   ├── 01-auth/
│   │   └── login.spec.ts               ✅ Complete (7/7 passing)
│   ├── 02-events/
│   │   └── event-creation.spec.ts      🔄 In Progress (10/16 passing)
│   ├── 03-check-in/
│   ├── 04-incidents/
│   ├── 05-vehicles/
│   ├── 06-reko/
│   ├── 07-drag-drop/
│   ├── 08-maps/
│   ├── 09-notifications/
│   ├── 10-workflows/
│   ├── 11-resource-conflicts/
│   └── 12-offline-maps/
├── fixtures/
│   └── auth.fixture.ts                 ✅ Implemented
├── pages/
│   ├── base.page.ts                    ✅ Implemented
│   ├── login.page.ts                   ✅ Implemented
│   ├── dashboard.page.ts               ✅ Implemented
│   └── events.page.ts                  ✅ Implemented
├── helpers/
│   ├── drag-drop.helper.ts             ✅ Implemented
│   └── api.helper.ts                   ✅ Implemented
├── data/
│   └── factories.ts                    ✅ Implemented
└── config/
```

## Next Steps

### Implementation Roadmap

#### Phase 1: Foundation (Week 1) - ✅ COMPLETE
- [x] Set up folder structure
- [x] Create base Page Object classes
- [x] Implement authentication fixture
- [x] Create drag-drop helper
- [x] Set up API helper
- [x] Debug and fix login page navigation
- [x] Create first working test suite (7/7 authentication tests passing)

#### Phase 2: Core Tests (Week 2-3)
- [x] Authentication tests (7/7 passing)
- [ ] Event creation tests
- [ ] Incident workflow tests
- [ ] Resource assignment tests
- [ ] Status transition tests

#### Phase 3: Advanced Features (Week 4)
- [ ] Check-in system tests
- [ ] Vehicle status tests
- [ ] Reko link tests
- [ ] Map view tests
- [ ] Notification tests
- [ ] Resource conflict warnings tests
- [ ] Offline map tiles tests

#### Phase 4: Quality & CI/CD (Week 5)
- [ ] Visual regression tests
- [ ] Accessibility tests
- [ ] Performance tests
- [ ] GitHub Actions workflow
- [ ] Test documentation

### Quick Start Commands

```bash
# Install dependencies
cd frontend
pnpm install

# Install Playwright browsers
pnpm exec playwright install

# Run all tests
pnpm test

# Run tests in UI mode (interactive)
pnpm test:ui

# Run tests in headed mode (see browser)
pnpm test:headed

# Run specific test file
pnpm test tests/e2e/01-auth/login.spec.ts

# Run tests in specific browser
pnpm test --project=chromium

# Generate test report
pnpm exec playwright show-report

# Debug tests
pnpm exec playwright test --debug
```

### Maintenance Guidelines

1. **Keep tests fast** - Aim for < 30 seconds per test
2. **Update tests with features** - Tests should evolve with the application
3. **Monitor flaky tests** - Fix or skip flaky tests, don't ignore them
4. **Review test coverage** - Ensure critical paths are always covered
5. **Clean up test data** - Prevent database bloat from test runs
6. **Document test patterns** - Share knowledge across team

---

## Resources

- [Playwright Documentation](https://playwright.dev/)
- [Playwright Best Practices](https://playwright.dev/docs/best-practices)
- [Page Object Model Pattern](https://playwright.dev/docs/pom)
- [Accessibility Testing](https://playwright.dev/docs/accessibility-testing)
- [Visual Comparisons](https://playwright.dev/docs/test-snapshots)

---

**End of E2E Testing Plan**
