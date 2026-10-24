import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures/auth.fixture';

/**
 * Event Selection Empty State Tests
 * Tests the empty state component shown when no event is selected
 */

// The start screen depends on which Ereignisse were opened in the last 24 h, and every other
// spec creates some – so the list is stubbed here, never read from the shared database.
async function stubEventList(page: Page, events: Array<{ name: string; openedHoursAgo: number; activeHoursAgo: number }>) {
  const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
  const body = {
    events: events.map((e, i) => ({
      id: `00000000-0000-4000-8000-00000000000${i + 1}`,
      name: e.name,
      training_flag: false,
      auto_attach_divera: false,
      created_at: ago(e.openedHoursAgo),
      updated_at: ago(e.activeHoursAgo),
      archived_at: null,
      last_activity_at: ago(e.activeHoursAgo),
      incident_count: 4,
    })),
    total: events.length,
  };
  await page.route(/\/api\/events\/(\?.*)?$/, (route) =>
    route.request().method() === 'GET' ? route.fulfill({ json: body }) : route.fallback(),
  );
}

test.describe('Event Selection Empty State – nothing opened in 24 h', () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    await stubEventList(authenticatedPage, [{ name: 'Altes Ereignis', openedHoursAgo: 30, activeHoursAgo: 26 }]);
    await authenticatedPage.goto('/');
  });

  test('shows the fallback card with plain copy', async ({ authenticatedPage }) => {
    await expect(authenticatedPage.getByRole('heading', { name: 'Ereignis wählen' })).toBeVisible();
    await expect(authenticatedPage.getByText('In den letzten 24 Stunden wurde kein Ereignis eröffnet.')).toBeVisible();
    await expect(authenticatedPage.getByText(/Kein Problem/)).toHaveCount(0);
  });

  test('shows a calm, neutral calendar tile — no pulse, no red tagline', async ({ authenticatedPage }) => {
    // Red is priority/danger and a pulse means «something is happening» (CLAUDE.md → Colour
    // roles); an empty start screen is neither.
    const calendarIcon = authenticatedPage.locator('svg[class*="lucide-calendar"][class*="text-muted-foreground"]').first();
    await expect(calendarIcon).toBeVisible();
    await expect(authenticatedPage.locator('[class*="animate-gentle-pulse"]')).toHaveCount(0);
    await expect(authenticatedPage.locator('svg[class*="lucide-sparkles"]')).toHaveCount(0);
  });

  test('fits the viewport: the page itself does not scroll', async ({ authenticatedPage }) => {
    await expect(authenticatedPage.getByRole('heading', { name: 'Ereignis wählen' })).toBeVisible();
    const overflow = await authenticatedPage.evaluate(() => {
      const main = document.querySelector('main');
      return main ? main.scrollHeight - main.clientHeight : 0;
    });
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('create button navigates to events page with create action', async ({ authenticatedPage }) => {
    await authenticatedPage.getByRole('button', { name: 'Neues Ereignis' }).click();
    await expect(authenticatedPage).toHaveURL(/\/events\?action=create/);
  });

  test('view button navigates to events page', async ({ authenticatedPage }) => {
    await authenticatedPage.getByRole('button', { name: 'Ereignisse anzeigen' }).click();
    await expect(authenticatedPage).toHaveURL(/\/events/);
  });

  test('empty state is responsive on mobile', async ({ authenticatedPage }) => {
    await authenticatedPage.setViewportSize({ width: 375, height: 667 });
    await expect(authenticatedPage.getByRole('heading', { name: 'Ereignis wählen' })).toBeVisible();

    // The two actions stack instead of sitting side by side (`flex-col sm:flex-row`),
    // asserted through the geometry the operator actually sees.
    const createButton = authenticatedPage.getByRole('button', { name: 'Neues Ereignis' });
    const viewButton = authenticatedPage.getByRole('button', { name: 'Ereignisse anzeigen' });
    await expect(createButton).toBeVisible();
    await expect(viewButton).toBeVisible();

    const createBox = (await createButton.boundingBox())!;
    const viewBox = (await viewButton.boundingBox())!;
    expect(viewBox.y).toBeGreaterThanOrEqual(createBox.y + createBox.height);
    expect(viewBox.x).toBe(createBox.x);
  });
});

test.describe('Event Selection Empty State – open Ereignisse from the last 24 h', () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    await stubEventList(authenticatedPage, [
      { name: 'Übung Nacht', openedHoursAgo: 3, activeHoursAgo: 2 },
      { name: 'Unwetter Oberwil', openedHoursAgo: 8, activeHoursAgo: 0.1 },
    ]);
    await authenticatedPage.goto('/');
  });

  test('lists them, the most recently active first, with «Neues Ereignis» no longer the main action', async ({ authenticatedPage }) => {
    const rows = authenticatedPage.getByTestId('event-start-recent').getByRole('listitem');
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText('Unwetter Oberwil');
    await expect(authenticatedPage.getByRole('button', { name: 'Unwetter Oberwil: Öffnen' })).toHaveAttribute('aria-keyshortcuts', 'Enter');
    await expect(authenticatedPage.getByRole('button', { name: 'Alle Ereignisse' })).toBeVisible();
  });
});

test.describe('Event Selection Empty State - With Event Selected', () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    // First navigate to events page
    await authenticatedPage.goto('/events');
  });

  test('empty state does not show when event is selected', async ({ authenticatedPage }) => {
    // Create a test event
    const eventName = `Test Event ${Date.now()}`;
    const createButton = authenticatedPage.getByRole('button', { name: 'Neues Ereignis', exact: true });
    await createButton.click();

    // Fill in event name
    const dialog = authenticatedPage.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.locator('input#event-name').fill(eventName);

    // Submit. Scoped to the dialog and exact: the page behind it also carries the
    // word "erstellen" ("Neues Ereignis erstellen" is the dialog's own title), so
    // an unscoped substring match resolves to more than one element.
    await dialog.getByRole('button', { name: 'Erstellen', exact: true }).click();

    // `handleCreateEvent` selects the new event and pushes to '/' by itself, so the
    // events list is already on its way out here. Reaching for an "Auswählen" button
    // at this moment is a race — it is what made this test fail on a second run,
    // clicking a card that detached mid-click.
    await expect(authenticatedPage).toHaveURL('/');
    await expect(authenticatedPage.getByRole('heading', { name: eventName }).first()).toBeVisible();
    await expect(
      authenticatedPage.getByRole('heading', { name: 'Ereignis wählen' }),
    ).toHaveCount(0);

    // And picking that same event out of the list behaves the same way. Located by
    // name, not "the first Auswählen on the page" — the list is shared with every
    // other spec's events.
    await authenticatedPage.goto('/events');
    const eventCard = authenticatedPage
      .getByTestId('event-card')
      .filter({ hasText: eventName })
      .first();
    await expect(eventCard).toBeVisible();
    // The event is currently selected, so it renders as the banner — whose
    // button is "Zum Board"; an unselected row would offer "Auswählen".
    await eventCard
      .getByRole('button', { name: /Auswählen|Zum Board/ })
      .first()
      .click();

    await expect(authenticatedPage).toHaveURL('/');
    await expect(authenticatedPage.getByRole('heading', { name: eventName }).first()).toBeVisible();
    await expect(
      authenticatedPage.getByRole('heading', { name: 'Ereignis wählen' }),
    ).toHaveCount(0);
  });
});
