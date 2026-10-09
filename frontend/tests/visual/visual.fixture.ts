import { test as base, expect, type APIRequestContext, type BrowserContext, type Locator, type Page } from '@playwright/test';

/**
 * Shared arrangement for the screenshot regression tests (docs/VISUAL_TESTS.md).
 *
 * Everything that would make two runs of the same commit paint different pixels is pinned
 * here, once, so a spec only says WHERE to go and WHAT must be on screen before the shot:
 *
 * - the data: `backend/app/seed_visual.py` (the demo storm evening at one fixed instant);
 * - the clock: the browser's `Date` frozen at that same instant (`VISUAL_NOW`);
 * - the network: nothing leaves the box — basemap tiles become one flat colour, any other
 *   foreign request is refused;
 * - the device: viewport, scale 1, de-CH, Europe/Zurich, reduced motion, colour scheme
 *   (playwright.visual.config.ts and `use` per spec);
 * - the board's own first-visit chrome (setup checklist) is pre-dismissed for the event.
 */

/**
 * The seed's VISUAL_NOW (backend/app/seed_visual.py), 19:30 in Oberwil. Change both or
 * neither: `openBoard` checks it against the event and fails with this file's name.
 */
export const VISUAL_NOW = new Date('2026-07-11T17:30:00Z');
/** seed_demo: `event.created_at = ago(185)`. */
const EVENT_AGE_MIN = 185;

export const VISUAL_EVENT_NAME = 'Unwetter Oberwil';
export const API_BASE = process.env.API_BASE_URL || 'http://localhost:8000';
const USERNAME = process.env.TEST_USERNAME || 'admin';
const PASSWORD = process.env.TEST_PASSWORD || 'visual-not-a-secret';

/** `EventContext` (lib/contexts/event-context.tsx). */
const SELECTED_EVENT_KEY = 'kp-rueck-selected-event';
/** app/page.tsx: an event in this list never auto-opens its Bereitschaft checklist. */
const CHECKLIST_DISMISSED_KEY = 'kp-board-checklistDismissedEvents';

export const PHONE = { width: 390, height: 844 } as const;
/** A command-post screen: the board's seven columns fit side by side from here on. */
export const DESKTOP = { width: 1920, height: 1080 } as const;

// 1×1 flat PNGs; MapLibre stretches a raster tile to its tileSize, so a whole map of them
// is one even colour. Two, so the dark basemap stays dark and the light one light.
const TILE_LIGHT = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mN48ewhAAVpArBGH6AzAAAAAElFTkSuQmCC',
  'base64',
);
const TILE_DARK = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mNQU1MDAADoAHPsdYsAAAAAAElFTkSuQmCC',
  'base64',
);

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Nothing leaves the box. A foreign tile (OSM, CARTO, ArcGIS — lib/hooks/use-map-mode.ts)
 * becomes a flat tile; any other foreign request is aborted, so a new third-party call
 * shows up as a broken thing in a diff instead of as a flaky one. The local offline
 * tileserver (`/tiles/*`) answers 404: the seed sets map_mode «online», and a probe that
 * failed fast is the same on every run.
 */
async function stubNetwork(context: BrowserContext) {
  await context.route(
    (url) => !LOCAL_HOSTS.has(url.hostname),
    (route) => {
      const url = route.request().url();
      if (/\.(png|jpe?g)(\?|$)|\/tile\//.test(url)) {
        return route.fulfill({
          status: 200,
          contentType: 'image/png',
          body: /dark/.test(url) ? TILE_DARK : TILE_LIGHT,
        });
      }
      return route.abort('blockedbyclient');
    },
  );
  await context.route(/^https?:\/\/[^/]+\/tiles\//, (route) => route.fulfill({ status: 404, body: '' }));
  // The Warnungen (bell, toasts) are evaluated on every GET against the SERVER's wall clock
  // (backend/app/services/notification_service.py): «2141h im Status …» on a story that is
  // 3 hours old. The browser clock can be frozen, the backend's cannot — so the list is
  // answered empty here, and the bell and its toasts are not part of these screenshots.
  await context.route(/\/api\/notifications\/\?/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
}

type VisualFixtures = {
  /**
   * Log the context in as the seeded admin and point it at the seeded Ereignis (default).
   * `false` for the field page, which a phone opens with no session at all.
   */
  signedIn: boolean;
  /** REST as the seeded admin, for the few arrangements a spec makes (the Feld link). */
  adminRequest: APIRequestContext;
};

type VisualWorkerFixtures = {
  /** One API login per worker (the login route is rate limited), replayed into each context. */
  storage: Awaited<ReturnType<BrowserContext['storageState']>>;
  seededEventId: string;
};

export const test = base.extend<VisualFixtures, VisualWorkerFixtures>({
  signedIn: [true, { option: true }],

  storage: [
    async ({ playwright }, use) => {
      const request = await playwright.request.newContext();
      const res = await request.post(`${API_BASE}/api/auth/login`, {
        form: { username: USERNAME, password: PASSWORD },
      });
      expect(res.ok(), `login as ${USERNAME}: HTTP ${res.status()} — was the database seeded with app.seed_visual?`).toBeTruthy();
      const state = await request.storageState();
      await request.dispose();
      await use(state);
    },
    { scope: 'worker' },
  ],

  seededEventId: [
    async ({ playwright, storage }, use) => {
      const request = await playwright.request.newContext({ storageState: storage });
      const res = await request.get(`${API_BASE}/api/events/`);
      expect(res.ok()).toBeTruthy();
      const { events }: { events: { id: string; name: string; created_at: string }[] } = await res.json();
      const event = events.find((e) => e.name === VISUAL_EVENT_NAME);
      expect(event, `no «${VISUAL_EVENT_NAME}» — seed the database with \`python -m app.seed_visual\``).toBeTruthy();
      // The frozen clock and the seed must agree, or every age on screen is off.
      expect(
        new Date(event!.created_at).getTime(),
        'VISUAL_NOW in tests/visual/visual.fixture.ts and backend/app/seed_visual.py disagree',
      ).toBe(VISUAL_NOW.getTime() - EVENT_AGE_MIN * 60_000);
      await request.dispose();
      await use(event!.id);
    },
    { scope: 'worker' },
  ],

  adminRequest: async ({ playwright, storage }, use) => {
    const request = await playwright.request.newContext({ storageState: storage });
    // eslint-disable-next-line react-hooks/rules-of-hooks -- Playwright's fixture `use`, not React's
    await use(request);
    await request.dispose();
  },

  context: async ({ context, storage, signedIn, seededEventId }, use) => {
    await stubNetwork(context);
    if (signedIn) {
      await context.addCookies(storage.cookies);
      // Before the app's first script: EventContext reads the selection on mount, and the
      // board auto-opens the Bereitschaft checklist once per event unless it was closed.
      await context.addInitScript(
        ([eventKey, checklistKey, id]) => {
          window.localStorage.setItem(eventKey, id);
          window.localStorage.setItem(checklistKey, JSON.stringify([id]));
        },
        [SELECTED_EVENT_KEY, CHECKLIST_DISMISSED_KEY, seededEventId] as const,
      );
    }
    // eslint-disable-next-line react-hooks/rules-of-hooks -- Playwright's fixture `use`, not React's
    await use(context);
  },

  page: async ({ page }, use) => {
    // Date only; timers keep running, so polling, sockets and React behave as usual.
    await page.clock.setFixedTime(VISUAL_NOW);
    // eslint-disable-next-line react-hooks/rules-of-hooks -- Playwright's fixture `use`, not React's
    await use(page);
  },
});

/**
 * Wait until the page has stopped arriving: the named content visible (`ready` — pick things
 * only the SETTLED screen has, e.g. the last card, a stored value), the fonts in, no loader,
 * the top progress line idle, every scroller at rest. Not `networkidle`: polling and the
 * socket keep the network busy forever. toHaveScreenshot then still insists on two identical
 * frames in a row — this only keeps it from comparing two frames of a page still loading.
 */
export async function settle(page: Page, ...ready: Locator[]) {
  for (const locator of ready) await expect(locator).toBeVisible({ timeout: 20_000 });
  await page.evaluate(() => document.fonts.ready);
  // The launch cover (components/boot-cover.tsx) and every shell trail (components/ui/
  // shell-loader.tsx) — the one loading signal the app has, by its own rule.
  await expect(page.locator('[data-boot-cover], [data-slot="shell-loader"]')).toHaveCount(0, { timeout: 20_000 });
  // The 2px top progress line (components/ui/top-loading-bar.tsx) runs while data loads.
  const progress = page.locator('div[aria-hidden].fixed.top-0 > div').first();
  if (await progress.count()) await expect(progress).toHaveCSS('opacity', '0', { timeout: 20_000 });
  // A programmatic scroll (the board brings a selected card into view, smoothly) is not a
  // CSS animation, so `animations: 'disabled'` does not stop it: wait until every scroller
  // has come to rest.
  let previous = '';
  await expect
    .poll(
      async () => {
        const now = await page.evaluate(() =>
          Array.from(document.querySelectorAll('*'))
            .filter((el) => el.scrollTop !== 0 || el.scrollLeft !== 0)
            .map((el) => `${el.scrollTop},${el.scrollLeft}`)
            .join('|'),
        );
        const still = now === previous;
        previous = now;
        return still;
      },
      { intervals: [250], timeout: 10_000 },
    )
    .toBe(true);
}

/**
 * Things that differ on every build or every connection, never on purpose. Kept few, and
 * each one says why — a mask hides a regression as well as a flake.
 */
export function variableParts(page: Page): Locator[] {
  return [
    // «v0.7.0 · 1a2b3c4 · 09.10.2026»: commit and build day differ on every build.
    page.locator('p[aria-label^="Version"]'),
  ];
}

export { expect };
