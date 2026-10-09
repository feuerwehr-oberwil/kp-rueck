import { defineConfig, devices } from '@playwright/test'

/**
 * Screenshot regression tests — docs/VISUAL_TESTS.md.
 *
 * Its own config, like playwright.screenshots.config.ts, rather than a project in
 * playwright.config.ts: the nightly runs `playwright test` over EVERY project there, and
 * these specs only mean something against the visual seed (backend/app/seed_visual.py) and
 * a production build, which the nightly's dev stack is neither. Run through
 * `just visual` (scripts/visual-test.sh), which brings that stack up and down; CI runs the
 * same script (the `visual` job in .github/workflows/ci.yml).
 */
export default defineConfig({
  testDir: './tests/visual',
  testMatch: '**/*.visual.ts',
  // One file per area, one PNG per state, all in one readable folder:
  // tests/visual/__screenshots__/board-desktop-dark.png
  snapshotPathTemplate: '{testDir}/__screenshots__/{arg}{ext}',
  // In CI a missing baseline FAILS — it never writes one. Baselines come from the
  // visual-baselines workflow only (fonts and rasterisation differ off CI).
  updateSnapshots: process.env.CI ? 'none' : 'missing',
  forbidOnly: !!process.env.CI,
  // No retries: a screenshot that needs a second try is the flake this suite must not have.
  retries: 0,
  fullyParallel: true,
  workers: process.env.CI ? 2 : 1,
  reporter: process.env.CI
    ? [
        ['list'],
        ['github'],
        ['html', { open: 'never' }],
        // read by scripts/visual-summary.mjs for the job summary
        ['json', { outputFile: 'test-results/visual-report.json' }],
      ]
    : [['list'], ['html', { open: 'never' }]],
  expect: {
    toHaveScreenshot: {
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
      // MEASURED (docs/VISUAL_TESTS.md § Threshold). `threshold` — the per-pixel colour
      // distance (YIQ) below which a pixel counts as equal — stays at Playwright's 0.2: it
      // absorbs anti-aliasing jitter (up to ~30 px at threshold 0 between runs). Past it,
      // 0 px differed in 15 runs on fresh databases. A 12→8 px corner radius changed only
      // 4–302 px per state, so an absolute count, not a ratio: 0.1 % of 1920×1080 is 2 074 px
      // and would have let the whole radius change through. 20 px is KP Front's number too.
      maxDiffPixels: 20,
    },
  },
  use: {
    ...devices['Desktop Chrome'],
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:3000',
    deviceScaleFactor: 1,
    locale: 'de-CH',
    timezoneId: 'Europe/Zurich',
    reducedMotion: 'reduce',
    colorScheme: 'dark',
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  projects: [{ name: 'visual' }],
})
