import baseConfig from './playwright.config'

import { defineConfig } from '@playwright/test'

/**
 * Config for the help-documentation screenshot capture — a tool, not a test.
 *
 * `tests/capture-help-screenshots.spec.ts` drives the app and writes PNGs into
 * `public/help/images/`. The main config ignores it so it does not run as part of
 * `pnpm test:e2e` (or the nightly CI suite, where regenerating screenshots into a
 * throwaway container is pure waste). This config exists purely to run it on purpose:
 *
 *     pnpm screenshots
 *
 * Needs the stack up (`just dev`). Review the resulting diff in public/help/images/
 * before committing — a re-capture rewrites every file whether or not it changed.
 */
export default defineConfig({
  ...baseConfig,
  testIgnore: [],
  testMatch: ['**/capture-help-screenshots.spec.ts'],
  // Never retry: a partial re-capture would leave a mix of old and new screenshots.
  retries: 0,
})
