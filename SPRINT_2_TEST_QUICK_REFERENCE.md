# Sprint 2 E2E Tests - Quick Reference

## Files Created

### Test Suites
```
frontend/tests/e2e/
├── 08-navigation/
│   └── mobile-bottom-navigation.spec.ts    (27 tests)
├── 09-resource-badges/
│   └── resource-status-badges.spec.ts      (31 tests)
├── 10-shortcuts/
│   └── categorized-shortcuts.spec.ts       (28 tests)
├── 11-check-in-widget/
│   └── check-in-widget.spec.ts             (26 tests)
└── 12-resource-assignment/
    └── click-to-assign.spec.ts             (23 tests)
```

### Page Object Updates
```
frontend/tests/pages/
└── main.page.ts                            (+12 methods)
```

## Quick Test Commands

```bash
# All Sprint 2 tests
pnpm test tests/e2e/{08-navigation,09-resource-badges,10-shortcuts,11-check-in-widget,12-resource-assignment}

# Individual suites
pnpm test tests/e2e/08-navigation
pnpm test tests/e2e/09-resource-badges
pnpm test tests/e2e/10-shortcuts
pnpm test tests/e2e/11-check-in-widget
pnpm test tests/e2e/12-resource-assignment

# Interactive UI mode
pnpm test:ui

# Generate report
pnpm test:report
```

## Coverage Summary

| Feature | Tests | Coverage | Priority |
|---------|-------|----------|----------|
| Mobile Bottom Navigation | 27 | 90% | High |
| Resource Status Badges | 31 | 85% | High |
| Keyboard Shortcuts | 28 | 80% | Medium |
| Check-In Widget | 26 | 85% | High |
| Click-to-Assign Dialog | 23 | 90% | High |
| **Total** | **135** | **86%** | - |

## New Page Object Methods

```typescript
// Mobile Navigation
mainPage.clickBottomTab('kanban' | 'map' | 'combined' | 'events' | 'more')
mainPage.openMobileMoreSheet()
mainPage.navigateFromMoreSheet(itemName)

// Resource Assignment
mainPage.openResourceAssignmentDialog('crew' | 'vehicles' | 'materials')
mainPage.assignResourceViaDialog(resourceName)
mainPage.searchResourceInDialog(searchTerm)

// Keyboard Shortcuts
mainPage.openShortcutsModal()
mainPage.closeShortcutsModal()

// Check-In Widget
mainPage.clickCheckInWidget()
mainPage.getCheckInCount() // Returns { checkedIn, total }

// Resource Badges
mainPage.getResourceBadgeCount(incidentLocation, resourceType)
mainPage.resourceBadgeHasCheckmark(incidentLocation, resourceType)
```

## Test Patterns Used

### Mobile Testing
```typescript
await authenticatedPage.setViewportSize({ width: 375, height: 667 })
await element.tap() // Use tap() on mobile instead of click()
```

### Accessibility
```typescript
const ariaLabel = await element.getAttribute('aria-label')
const ariaCurrent = await element.getAttribute('aria-current')
```

### Visual States
```typescript
const hasActiveClass = await element.evaluate(el => 
  el.className.includes('text-primary')
)
```

### Touch Targets
```typescript
const height = await element.evaluate(el => 
  el.getBoundingClientRect().height
)
expect(height).toBeGreaterThanOrEqual(44)
```

## Common Assertions

```typescript
// Visibility
await expect(element).toBeVisible()
await expect(element).not.toBeVisible()

// State
await expect(element).toBeEnabled()
await expect(element).toBeDisabled()

// Content
await expect(element).toContainText('text')
await expect(element).toHaveCount(3)

// Navigation
await expect(page).toHaveURL('/expected-path')

// Toast notifications
const toast = page.locator('[data-sonner-toast]')
await expect(toast.filter({ hasText: 'success' })).toBeVisible()
```

## Documentation

- Full report: `/SPRINT_2_TEST_SUMMARY.md`
- Test plan: `/E2E_TESTING_PLAN.md`
- Sprint 1 tests: `/SPRINT_1_TEST_SUMMARY.md`

