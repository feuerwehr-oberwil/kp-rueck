import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

/**
 * Files that replace `window.location` (to catch `reload()` / `assign()` / a `mailto:` href,
 * which jsdom cannot perform). Under `vmThreads` the page's `location` is the real,
 * non-configurable one, so these run in `forks`. A new test failing with «Cannot redefine
 * property: location» belongs here – a test that only needs another URL should call
 * `jsdom.reconfigure({ url })` or `history.replaceState` instead (see lib/env.test.ts).
 */
const STUBS_LOCATION = [
  "app/login/login-i18n.test.tsx",
  "app/setup/page.test.tsx",
  "components/boot-screen.test.tsx",
  "components/settings/telemetry-settings.test.tsx",
  "lib/hooks/use-update-notice.test.tsx",
];

const exclude = [
  "node_modules/**",
  ".next/**",
  "tests/**",
  "playwright-report/**",
  "test-results/**",
  "coverage/**",
];

const shared = {
  environment: "jsdom",
  setupFiles: ["./vitest.setup.ts"],
  css: false,
  restoreMocks: true,
};

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "."),
    },
  },
  test: {
    // `vmThreads` builds one jsdom per worker and gives each file a fresh VM context on it,
    // instead of a new jsdom per file – that creation was ~40 % of the run (TESTS-09).
    projects: [
      {
        extends: true,
        test: {
          ...shared,
          name: "vm",
          pool: "vmThreads",
          include: ["**/*.{test,spec}.{ts,tsx}"],
          exclude: [...exclude, ...STUBS_LOCATION],
        },
      },
      {
        extends: true,
        test: { ...shared, name: "forks", pool: "forks", include: STUBS_LOCATION, exclude },
      },
    ],
  },
});
