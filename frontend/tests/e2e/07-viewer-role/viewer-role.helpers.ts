import { expect, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Shared setup for the viewer-role specs.
 *
 * Not a `.spec.ts`, so Playwright's default testMatch leaves it alone.
 */

/** EventContext reads the current event from this localStorage key. */
export const SELECTED_EVENT_KEY = 'kp-rueck-selected-event';

export const API_BASE = process.env.API_BASE_URL || 'http://localhost:8000';

/** Where ProtectedRoute sends every `viewer` account (components/protected-route.tsx). */
export const VIEWER_LANDING = '/display/board';

/** Serialise a page's session cookies for direct REST calls. */
export async function cookieHeaderFor(page: Page): Promise<string> {
  const cookies = await page.context().cookies();
  return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

export interface BoardFixture {
  eventId: string;
  /** Street part of the incident address — unique per fixture, safe to assert on. */
  address: string;
}

/**
 * Create a training event with exactly one active incident, as the editor.
 *
 * Every test gets its own event: the suite runs against one shared database, so
 * counts ("Aktiv (1)") are only stable when nothing else writes into the event
 * under assertion.
 */
export async function createEventWithIncident(
  request: APIRequestContext,
  cookieHeader: string,
  prefix: string,
): Promise<BoardFixture> {
  const headers = { 'Content-Type': 'application/json', cookie: cookieHeader };
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

  const eventResponse = await request.post(`${API_BASE}/api/events/`, {
    headers,
    data: { name: `${prefix} ${stamp}`, training_flag: true },
  });
  expect(eventResponse.ok(), await eventResponse.text()).toBeTruthy();
  const event = await eventResponse.json();

  const address = `${prefix}strasse ${stamp}`;
  const incidentResponse = await request.post(`${API_BASE}/api/incidents/`, {
    headers,
    data: {
      event_id: event.id,
      title: `${prefix} Brand`,
      type: 'brandbekaempfung',
      priority: 'high',
      status: 'active',
      location_address: `${address}, 4104 Oberwil`,
      location_lat: 47.4989,
      location_lng: 7.5567,
      description: `${prefix} Lagemeldung`,
    },
  });
  expect(incidentResponse.ok(), await incidentResponse.text()).toBeTruthy();

  return { eventId: event.id, address };
}

/**
 * Point a page at `eventId` and land it on `path`.
 *
 * `path` differs per role on purpose: an editor is parked on the board, a viewer
 * on the display board, because a viewer sent to `/` would just bounce and the
 * reload would race the redirect.
 */
export async function selectEvent(page: Page, path: string, eventId: string) {
  await page.goto(path);
  await page.evaluate(
    ([key, id]) => window.localStorage.setItem(key, id),
    [SELECTED_EVENT_KEY, eventId] as const,
  );
  await page.goto(path);
}

/**
 * Close anything floating over the board.
 *
 * The Setup-Checkliste popover opens itself once per newly selected event
 * (`autoOpenedEventRef` in app/page.tsx), and every test here selects a fresh
 * one — so on the editor board it is always up, and it swallows clicks on the
 * cards behind it. Retried rather than "press Escape and hope": the popover
 * appears on mount, so a single blind keypress could land before it.
 */
export async function dismissOverlays(page: Page) {
  const poppers = page.locator('[data-radix-popper-content-wrapper]');
  await expect(async () => {
    if (await poppers.count()) {
      await page.keyboard.press('Escape');
    }
    expect(await poppers.count()).toBe(0);
  }).toPass({ timeout: 15_000 });
}

/** Assert that `page` (a viewer) was bounced out of an editor-only route. */
export async function expectBouncedToDisplayBoard(page: Page, path: string) {
  await page.goto(path);
  await page.waitForURL(`**${VIEWER_LANDING}`, { timeout: 15_000 });
  expect(new URL(page.url()).pathname).toBe(VIEWER_LANDING);
}
