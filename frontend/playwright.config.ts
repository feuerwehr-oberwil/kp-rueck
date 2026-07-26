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
  reporter: process.env.CI
    ? [['list'], ['github'], ['html', { open: 'never' }]]
    : 'html',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
