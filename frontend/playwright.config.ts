import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  // capture-help-screenshots.spec.ts is a documentation tool, not a test: it drives the app
  // and writes PNGs into public/help/images/. It lives under testDir, so it was running as
  // 14 "tests" in every `pnpm test:e2e` — and, once the suite went nightly, in CI, where it
  // regenerated screenshots nobody would ever collect. Run it deliberately:
  //   pnpm screenshots
  testIgnore: ['**/capture-help-screenshots.spec.ts'],
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  // In CI the html report is written but never printed, so a run that is killed (the nightly
  // hit its 60-minute cap once) produced NO record of which specs had passed — the artifact
  // upload finds nothing either. `list` streams one line per spec as it finishes, so a
  // truncated run still tells you exactly how far it got; `github` turns failures into
  // annotations on the run. Locally the html report on its own is the nicer experience.
  //
  // E2E_JSON_REPORT adds a machine-readable copy: the nightly reads it to name the failing and
  // flaky specs in its issue (scripts/e2e-summary.mjs) instead of pointing at a 60 MB artifact.
  reporter: process.env.CI
    ? [
        ['list'],
        ['github'],
        ['html', { open: 'never' }],
        ...(process.env.E2E_JSON_REPORT
          ? [['json', { outputFile: process.env.E2E_JSON_REPORT }] as ['json', { outputFile: string }]]
          : []),
      ]
    : 'html',
  use: {
    // `just fat-perf` serves a production build on its own port
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // `just fat-perf <preset>`: a measurement, skipped unless FAT_PRESET is set
    // (tests/perf/fat-event.perf.ts). No trace: it would record every one of the thousands of
    // API calls and become the bottleneck. A tablet-sized landscape viewport, like the KP's.
    {
      name: 'perf',
      testMatch: '**/*.perf.ts',
      retries: 0,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 1024 }, trace: 'off', screenshot: 'off' },
    },
  ],

  // the perf run brings its own production build (scripts/fat-perf.sh)
  webServer: process.env.FAT_PRESET ? undefined : {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
