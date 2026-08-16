import { expect, type APIRequestContext, type Page } from '@playwright/test';

/**
 * REST setup for E2E tests.
 *
 * Arranging state through the interface is what made this suite slow: creating one
 * incident through the board's "Neuer Einsatz" modal commits its address through a
 * LocationInput popover backed by the *external* Nominatim geocoder, so every test
 * that merely needed an incident to exist paid a network round trip to
 * openstreetmap.org — and inherited its rate limiting as flake. Specs whose subject
 * IS the modal still drive it; everything else arranges here.
 *
 * The shapes below are the backend's, checked against `docs/openapi.json`. The
 * previous version of this file described an API that never existed — `location` /
 * `address` / `criticality` fields, a `'new' | 'in_progress' | 'done'` status
 * vocabulary, `PUT /api/incidents/{id}`, and separate `/personnel`, `/vehicles`,
 * `/materials` assignment endpoints. Nothing imported it, so nothing ever failed.
 */

export const API_BASE = process.env.API_BASE_URL || 'http://localhost:8000';

/** EventContext reads the current event from this localStorage key. */
export const SELECTED_EVENT_KEY = 'kp-rueck-selected-event';

/** `IncidentStatus` in backend/app/schemas/incidents.py — the kanban columns. */
export type TestIncidentStatus =
  | 'incoming'
  | 'reko'
  | 'reko_done'
  | 'enroute'
  | 'active'
  | 'returning'
  | 'complete';

/** `IncidentPriority`. */
export type TestIncidentPriority = 'low' | 'medium' | 'high';

/** `IncidentType` — the subset the tests use; the enum has 13 members. */
export type TestIncidentType =
  | 'brandbekaempfung'
  | 'elementarereignis'
  | 'strassenrettung'
  | 'technische_hilfeleistung';

export interface TestEvent {
  id: string;
  name: string;
  training_flag: boolean;
}

export interface TestIncident {
  id: string;
  event_id: string;
  title: string;
  type: TestIncidentType;
  priority: TestIncidentPriority;
  status: TestIncidentStatus;
  location_address?: string | null;
  description?: string | null;
}

/** Serialise a page's session cookies so REST calls run as that page's user. */
export async function cookieHeaderFor(page: Page): Promise<string> {
  const cookies = await page.context().cookies();
  return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

function jsonHeaders(cookieHeader: string) {
  return { 'Content-Type': 'application/json', cookie: cookieHeader };
}

export async function createEvent(
  request: APIRequestContext,
  cookieHeader: string,
  name: string,
  options: { training_flag?: boolean; auto_attach_divera?: boolean } = {},
): Promise<TestEvent> {
  const response = await request.post(`${API_BASE}/api/events/`, {
    headers: jsonHeaders(cookieHeader),
    data: {
      name,
      training_flag: options.training_flag ?? true,
      auto_attach_divera: options.auto_attach_divera ?? false,
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

/**
 * Create one incident.
 *
 * The defaults reproduce exactly what the "Neuer Einsatz" modal submits
 * (`components/kanban/new-emergency-modal.tsx`: type `elementarereignis`,
 * priority `low`, status `incoming`, and `title === location_address`, per
 * `operations-context.tsx`). Specs converted from UI setup therefore see the same
 * card they saw before — the arrangement changed, the subject did not.
 */
export async function createIncident(
  request: APIRequestContext,
  cookieHeader: string,
  eventId: string,
  overrides: Partial<Omit<TestIncident, 'id' | 'event_id'>> & { location_address?: string } = {},
): Promise<TestIncident> {
  const address = overrides.location_address ?? overrides.title ?? 'Teststrasse 1, 4104 Oberwil';
  const response = await request.post(`${API_BASE}/api/incidents/`, {
    headers: jsonHeaders(cookieHeader),
    data: {
      event_id: eventId,
      title: overrides.title ?? address,
      type: overrides.type ?? 'elementarereignis',
      priority: overrides.priority ?? 'low',
      status: overrides.status ?? 'incoming',
      location_address: address,
      // Oberwil BL, the seed's home city — coordinates the modal would have got
      // back from the geocoder, supplied directly so no geocoder is involved.
      location_lat: 47.4989,
      location_lng: 7.5567,
      description: overrides.description ?? null,
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

/**
 * Point a page at `eventId` and land it on `path`.
 *
 * The obvious shape — load the page, write localStorage, load it again — costs two
 * full navigations per test because EventContext reads the key on mount and cannot
 * see a value written after it. `addInitScript` runs before the page's own scripts,
 * so the key is already there the first time EventContext looks, and one navigation
 * does. In a Next dev server that is the single most expensive thing a setup does.
 */
export async function selectEvent(page: Page, path: string, eventId: string) {
  await page.addInitScript(
    ([key, id]) => window.localStorage.setItem(key, id),
    [SELECTED_EVENT_KEY, eventId] as const,
  );
  await page.goto(path);
}

/**
 * Close anything floating over the board.
 *
 * The Setup-Checkliste popover opens itself once per newly selected event
 * (`autoOpenedEventRef` in app/page.tsx), and every test here selects a fresh one,
 * so on the editor board it is always up and it swallows clicks on the cards
 * behind it. Retried rather than "press Escape and hope": the popover appears on
 * mount, so a single blind keypress could land before it.
 */
export async function dismissOverlays(page: Page) {
  const poppers = page.locator('[data-radix-popper-content-wrapper]');
  await expect(async () => {
    if (await poppers.count()) {
      await page.keyboard.press('Escape');
    }
    // Twice, half a second apart. Once is not enough: the checklist mounts a tick
    // after the board does, so a single reading of 0 can simply be early — which is
    // how "0 Personen eingecheckt" ended up intercepting card clicks in the suites
    // that arrange over REST and therefore reach the board sooner than a UI setup did.
    expect(await poppers.count()).toBe(0);
    await page.waitForTimeout(500);
    expect(await poppers.count()).toBe(0);
  }).toPass({ timeout: 20_000 });
}

export interface BoardFixture {
  eventId: string;
  /** Street part of the address — unique per fixture, safe to assert on. */
  address: string;
  incidents: TestIncident[];
}

/** Below `MOBILE_BREAKPOINT` (768px) the board is a different component. */
export const MOBILE_VIEWPORT = { width: 375, height: 667 } as const;

/**
 * The incident cards on the board, in whichever layout is rendered.
 *
 * Below 768px `app/page.tsx` renders `MobileIncidentListView` instead of the
 * kanban columns, and its `MobileIncidentCard` carries no `data-testid` — so
 * every spec that set a 375px viewport and then looked for
 * `[data-testid="incident-card"]` was asserting against an element the phone
 * layout has never rendered. On mobile the list is the only thing on the page,
 * so the shadcn `Card` slot identifies its cards without a class substring.
 */
export function incidentCards(page: Page, layout: 'desktop' | 'mobile' = 'desktop') {
  return layout === 'mobile'
    ? page.locator('[data-slot="card"]')
    : page.getByTestId('incident-card');
}

/**
 * Wait until the board has caught up with what REST just wrote.
 *
 * An incident created over REST reaches an open board through the Socket.IO push,
 * or through the ~5s polling fallback if the socket is down — so this is the one
 * place the conversion still has to wait for something, and it waits for the
 * condition rather than for a duration.
 */
export async function expectCardCount(
  page: Page,
  atLeast: number,
  layout: 'desktop' | 'mobile' = 'desktop',
) {
  await expect
    .poll(() => incidentCards(page, layout).count(), { timeout: 20_000 })
    .toBeGreaterThanOrEqual(atLeast);
}

/**
 * Add `count` more incidents to an already-open board, over REST.
 *
 * For tests that need incidents to appear *while* the board is up; `setupBoard`
 * covers the commoner case of wanting them there from the start.
 */
export async function addIncidents(
  page: Page,
  board: BoardFixture,
  count: number,
  prefix = 'Nachschub',
): Promise<TestIncident[]> {
  const cookieHeader = await cookieHeaderFor(page);
  const before = board.incidents.length;
  const added: TestIncident[] = [];
  for (let i = 0; i < count; i += 1) {
    added.push(
      await createIncident(page.request, cookieHeader, board.eventId, {
        location_address: `${prefix}weg ${before + i + 1} ${Date.now()}, 4104 Oberwil`,
      }),
    );
  }
  board.incidents.push(...added);
  await expectCardCount(page, before + count);
  return added;
}

/**
 * The whole arrangement most specs need: a fresh training event with `count`
 * incidents in it, selected, with the board open and nothing covering it.
 *
 * A fresh event per test rather than a shared one: the suite runs against one
 * database, so per-column counts are only stable when nothing else writes into the
 * event under assertion.
 */
export async function setupBoard(
  page: Page,
  prefix: string,
  options: {
    count?: number;
    path?: string;
    incidents?: Partial<TestIncident>[];
    /** Set for specs that have shrunk the viewport below 768px — see `incidentCards`. */
    layout?: 'desktop' | 'mobile';
  } = {},
): Promise<BoardFixture> {
  const cookieHeader = await cookieHeaderFor(page);
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const event = await createEvent(page.request, cookieHeader, `${prefix} ${stamp}`);

  const address = `${prefix}strasse ${stamp}`;
  const specs: Partial<TestIncident>[] =
    options.incidents ?? Array.from({ length: options.count ?? 1 }, () => ({}));
  const incidents: TestIncident[] = [];
  for (const [index, spec] of specs.entries()) {
    incidents.push(
      await createIncident(page.request, cookieHeader, event.id, {
        ...spec,
        location_address:
          spec.location_address ?? `${address}${specs.length > 1 ? ` ${index + 1}` : ''}, 4104 Oberwil`,
      }),
    );
  }

  const path = options.path ?? '/';
  await selectEvent(page, path, event.id);

  // Wait for the event to actually be the selected one, by its name in the page
  // heading. Nothing waited for this before, because arranging through the events
  // page took long enough to hide it; REST setup arrives while the app is still
  // mounting, and the specs then assert against an empty board.
  //
  // The heading rather than the kanban columns: `[data-column]` does not exist at
  // all on a 375px viewport, so a column-based check cost `08-navigation` a 20s
  // timeout on every one of its mobile tests. The event name is on every layout.
  await expect(page.getByRole('heading', { name: event.name }).first()).toBeVisible({
    timeout: 20_000,
  });
  if (incidents.length) {
    await expectCardCount(page, incidents.length, options.layout ?? 'desktop');
  }
  // After the cards, not before: the checklist popover mounts alongside the board,
  // so dismissing it is only meaningful once the board itself has rendered.
  await dismissOverlays(page);

  return { eventId: event.id, address, incidents };
}

/**
 * Create a training event with exactly one active incident.
 *
 * Kept as its own name because the viewer-role specs read better with it, and
 * because `status: 'active'` (not the modal's `incoming`) is load-bearing there:
 * those specs assert on the "Aktiv (1)" column.
 */
export async function createEventWithIncident(
  request: APIRequestContext,
  cookieHeader: string,
  prefix: string,
): Promise<BoardFixture> {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const event = await createEvent(request, cookieHeader, `${prefix} ${stamp}`);
  const address = `${prefix}strasse ${stamp}`;
  const incident = await createIncident(request, cookieHeader, event.id, {
    title: `${prefix} Brand`,
    type: 'brandbekaempfung',
    priority: 'high',
    status: 'active',
    location_address: `${address}, 4104 Oberwil`,
    description: `${prefix} Lagemeldung`,
  });
  return { eventId: event.id, address, incidents: [incident] };
}

/* ------------------------------------------------------------------ plan 25
 * The field surface (`/feld`).
 *
 * Everything below arranges the *preconditions* of a field walk over REST — a
 * crew, an assignment, an Einsatzleiter, a token — so the spec itself only ever
 * drives the two things under test: the phone and the board.
 */

export interface TestPersonnel {
  id: string;
  name: string;
  role: string | null;
}

/**
 * Create one firefighter.
 *
 * Fresh people per spec rather than the seeded roster: a seeded person may
 * already be assigned to somebody else's incident, and `assign` answers that
 * with a 409 — which would make this suite fail for a reason that has nothing
 * to do with `/feld`.
 *
 * `roleSortOrder` is the rank the automatic Einsatzleiter resolver sorts on
 * (lower = more senior, `backend/app/crud/assignments.py`).
 */
export async function createPersonnel(
  request: APIRequestContext,
  cookieHeader: string,
  name: string,
  options: { role?: string; roleSortOrder?: number } = {},
): Promise<TestPersonnel> {
  const response = await request.post(`${API_BASE}/api/personnel/`, {
    headers: jsonHeaders(cookieHeader),
    data: {
      name,
      role: options.role ?? 'Feuerwehrmann',
      role_sort_order: options.roleSortOrder ?? 10,
      status: 'available',
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

/** Soft-delete a person again, so a dev database does not grow a roster of ghosts. */
export async function deletePersonnel(
  request: APIRequestContext,
  cookieHeader: string,
  personnelId: string,
): Promise<void> {
  await request.delete(`${API_BASE}/api/personnel/${personnelId}`, { headers: jsonHeaders(cookieHeader) });
}

/** Put a person on an incident; returns the assignment id (needed to pin the EL). */
export async function assignPersonnel(
  request: APIRequestContext,
  cookieHeader: string,
  incidentId: string,
  personnelId: string,
): Promise<{ id: string }> {
  const response = await request.post(`${API_BASE}/api/incidents/${incidentId}/assign`, {
    headers: jsonHeaders(cookieHeader),
    data: { resource_type: 'personnel', resource_id: personnelId },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

/**
 * Pin this assignment's person as Einsatzleiter.
 *
 * Deliberate rather than relying on the automatic resolver: pinning also sets
 * `Incident.leader_manual`, so nothing that happens later in a spec can re-derive
 * the role and change the name the assertions read.
 */
export async function pinLeader(
  request: APIRequestContext,
  cookieHeader: string,
  incidentId: string,
  assignmentId: string,
): Promise<void> {
  const response = await request.patch(
    `${API_BASE}/api/incidents/${incidentId}/assignments/${assignmentId}`,
    { headers: jsonHeaders(cookieHeader), data: { is_leader: true } },
  );
  expect(response.ok(), await response.text()).toBeTruthy();
}

/** Move an incident between kanban columns without touching the board. */
export async function setIncidentStatus(
  request: APIRequestContext,
  cookieHeader: string,
  incidentId: string,
  from: TestIncidentStatus,
  to: TestIncidentStatus,
): Promise<void> {
  const response = await request.post(`${API_BASE}/api/incidents/${incidentId}/status`, {
    headers: jsonHeaders(cookieHeader),
    data: { from_status: from, to_status: to },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
}

/**
 * Remove a test Ereignis and everything hanging off it.
 *
 * Two calls, because `DELETE /api/events/{id}` refuses an event that is not
 * archived (`backend/app/api/events.py`) — a bare DELETE answers 400 and, if
 * nobody checks the status, leaves the event behind. The dev database is the
 * user's own board, so a suite that arranges freely has to tidy up properly.
 */
export async function deleteEvent(
  request: APIRequestContext,
  cookieHeader: string,
  eventId: string,
): Promise<void> {
  await request.post(`${API_BASE}/api/events/${eventId}/archive`, { headers: jsonHeaders(cookieHeader) });
  const deleted = await request.delete(`${API_BASE}/api/events/${eventId}`, {
    headers: jsonHeaders(cookieHeader),
  });
  expect(deleted.ok(), await deleted.text()).toBeTruthy();
}

/** The one global `/feld` link of an Ereignis — what the printed poster carries. */
export async function generateFeldLink(
  request: APIRequestContext,
  cookieHeader: string,
  eventId: string,
): Promise<string> {
  const response = await request.post(`${API_BASE}/api/feld/generate-link?event_id=${eventId}`, {
    headers: jsonHeaders(cookieHeader),
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  const { link } = await response.json();
  expect(link).toContain('/feld?token=');
  return link;
}

/**
 * The Ereignis' Feld-Code (plan 26, decision 22).
 *
 * Every field test needs it now: the poster link opens nothing without it, so
 * this is the arrange-step equivalent of reading the four digits off the board.
 */
export async function getFeldCode(
  request: APIRequestContext,
  cookieHeader: string,
  eventId: string,
): Promise<string> {
  const response = await request.get(`${API_BASE}/api/feld/access?event_id=${eventId}`, {
    headers: jsonHeaders(cookieHeader),
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  const { code } = await response.json();
  return code;
}

/**
 * Give somebody a role for this Ereignis: `driver` (needs a vehicle), `reko`
 * or `magazin`.
 *
 * These are what the `/feld` visibility union reads beyond a plain assignment —
 * a driver holds no personnel row at all, and a Magazin person none anywhere.
 */
export async function setSpecialFunction(
  request: APIRequestContext,
  cookieHeader: string,
  eventId: string,
  personnelId: string,
  functionType: 'driver' | 'reko' | 'magazin',
  vehicleId?: string,
): Promise<void> {
  const response = await request.post(`${API_BASE}/api/events/${eventId}/special-functions/`, {
    headers: jsonHeaders(cookieHeader),
    data: { personnel_id: personnelId, function_type: functionType, vehicle_id: vehicleId ?? null },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
}

/** Assign a vehicle or material to an incident — the non-personnel resources. */
export async function assignResource(
  request: APIRequestContext,
  cookieHeader: string,
  incidentId: string,
  resourceType: 'vehicle' | 'material',
  resourceId: string,
): Promise<{ id: string }> {
  const response = await request.post(`${API_BASE}/api/incidents/${incidentId}/assign`, {
    headers: jsonHeaders(cookieHeader),
    data: { resource_type: resourceType, resource_id: resourceId },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

/** The first vehicle on the station's fleet — enough to make somebody a driver. */
export async function firstVehicleId(request: APIRequestContext, cookieHeader: string): Promise<string> {
  const response = await request.get(`${API_BASE}/api/vehicles/`, { headers: jsonHeaders(cookieHeader) });
  expect(response.ok(), await response.text()).toBeTruthy();
  const vehicles = await response.json();
  expect(vehicles.length, 'the dev fleet is empty — seed it first').toBeGreaterThan(0);
  return vehicles[0].id;
}

/** The first material — enough to put something "out" for the Magazin. */
export async function firstMaterialId(request: APIRequestContext, cookieHeader: string): Promise<string> {
  const response = await request.get(`${API_BASE}/api/materials/`, { headers: jsonHeaders(cookieHeader) });
  expect(response.ok(), await response.text()).toBeTruthy();
  const materials = await response.json();
  expect(materials.length, 'the dev material list is empty — seed it first').toBeGreaterThan(0);
  return materials[0].id;
}

/** Assign somebody as the Reko through the board's own path (sets purpose='reko').
 *
 *  Under `/api/reko` since plan 26 removed `/reko-dashboard`: the endpoint was
 *  never that page's — it is editor-authed and always was — so it moved rather
 *  than went. */
export async function assignReko(
  request: APIRequestContext,
  cookieHeader: string,
  incidentId: string,
  personnelId: string,
): Promise<void> {
  const response = await request.post(
    `${API_BASE}/api/reko/incidents/${incidentId}/assign-reko`,
    { headers: jsonHeaders(cookieHeader), data: { personnel_id: personnelId } },
  );
  expect(response.ok(), await response.text()).toBeTruthy();
}
