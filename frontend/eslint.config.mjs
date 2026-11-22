import js from "@eslint/js";
import tseslint from "typescript-eslint";
import nextPlugin from "@next/eslint-plugin-next";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import kp from "./scripts/eslint-kp.mjs";

// Rules that the code meets everywhere today are ERRORS; the house rules in scripts/eslint-kp.mjs
// are WARNINGS that eslint-ratchet.json holds at today's counts (CLAUDE.md › «A correction
// becomes a check»).
//
// A later block that sets the same rule REPLACES its options, so every block that narrows an
// import or a syntax rule spreads the shared lists below instead of restating them.
const TESTS = ["**/*.test.{ts,tsx}", "**/*.spec.{ts,tsx}"];

// One loading signal, always with words: components/ui/shell-loader.tsx (CLAUDE.md › Loading states).
const SPINNER = "No spinners: LoadingStatus or ShellLoader from components/ui/shell-loader.tsx – CLAUDE.md › Loading states.";
const IMPORTS = [
  { group: ["lucide-react"], importNamePattern: "^(Lucide)?Loader", message: SPINNER },
  { group: ["date-fns", "date-fns/*"], message: "Durations go through lib/duration.ts, dates through lib/date-locale.ts – CLAUDE.md › Durations." },
];
const SYNTAX = [
  // The App Router runs on the React Next vendors, which has no `useEffectEvent` yet:
  // the import type-checks and passes Vitest, then crashes the page. See the hook's file.
  {
    selector: "ImportDeclaration[source.value='react'] > ImportSpecifier[imported.name=/^(experimental_)?useEffectEvent$/]",
    message: "Import useEffectEvent from '@/lib/hooks/use-effect-event' – Next 15's vendored React does not export it.",
  },
  {
    selector: "MemberExpression[object.name='React'][property.name=/^(experimental_)?useEffectEvent$/]",
    message: "Use useEffectEvent from '@/lib/hooks/use-effect-event' – Next 15's vendored React does not export it.",
  },
  { selector: "Literal[value=/\\banimate-spin\\b/]", message: SPINNER },
  { selector: "TemplateElement[value.raw=/\\banimate-spin\\b/]", message: SPINNER },
];
// Every map goes through components/map/base-map.tsx: its `isolate` wrapper keeps markers and
// controls below the page's overlays, and it sets MapLibre's worker URL (CLAUDE.md › Maps).
const MAP = "A map is components/map/base-map.tsx (<BaseMap>) – CLAUDE.md › «Maps never rise above overlays».";
const MAP_COMPONENT = [{ name: "react-map-gl", importNames: ["default", "Map"], message: MAP }];
// every react-map-gl entry point (maplibre, mapbox, …) and MapLibre's JS files; its stylesheet stays free
const MAP_PATTERNS = [
  { group: ["react-map-gl/*"], importNames: ["default", "Map"], message: MAP },
  { regex: "^maplibre-gl/dist/.*\\.m?js$", message: MAP, allowTypeImports: true },
];
// import() of the same entry points (no-restricted-imports does not see it); the stylesheet stays free
const MAP_IMPORT_EXPRESSION = { selector: "ImportExpression[source.value=/^(maplibre-gl(\\u002Fdist\\u002F.*\\.m?js)?|react-map-gl(\\u002F.*)?)$/]", message: MAP };
const MAP_COMPONENT_IMPORT_EXPRESSION = { selector: "ImportExpression[source.value=/^react-map-gl(\\u002F.*)?$/]", message: MAP };

export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{js,jsx,ts,tsx}"],
    plugins: {
      "@next/next": nextPlugin,
      "react": reactPlugin,
      "react-hooks": reactHooksPlugin,
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
      // React rules
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
      // React Hooks
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      // TypeScript rules
      "@typescript-eslint/no-unused-vars": ["warn", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_"
      }],
      "@typescript-eslint/no-explicit-any": "warn",
      // General rules
      "prefer-const": "error",
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "no-restricted-syntax": ["error", ...SYNTAX],
      "@typescript-eslint/no-restricted-imports": ["error", { patterns: IMPORTS }],
      // A question is a ConfirmDialog (components/ui/confirm-dialog.tsx), never the browser's own.
      "no-restricted-globals": ["error",
        ...["alert", "confirm", "prompt"].map((name) => ({ name, message: "Ask with ConfirmDialog (components/ui/confirm-dialog.tsx), tell with a toast." })),
      ],
      "no-restricted-properties": ["error",
        ...["alert", "confirm", "prompt"].map((property) => ({ object: "window", property, message: "Ask with ConfirmDialog (components/ui/confirm-dialog.tsx), tell with a toast." })),
      ],
    },
    settings: {
      react: {
        version: "detect",
      },
    },
  },
  // Every linted file (no `files`: .mjs and .cjs too): a disable says why.
  { plugins: { kp }, rules: { "kp/disable-reason": "warn" } },
  // Product code (app/, components/; not lib/, not tests): effects and timers go through named
  // helpers in lib/, screen text through the catalogue. Ratcheted warnings – scripts/eslint-kp.mjs.
  {
    files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}"],
    ignores: TESTS,
    rules: { "kp/no-raw-effect": "warn", "kp/no-raw-timer": "warn" },
  },
  {
    files: ["app/**/*.tsx", "components/**/*.tsx", "lib/**/*.tsx"],
    ignores: TESTS,
    rules: { "kp/no-literal-copy": "warn" },
  },
  // The map door. components/map/ is the one place that imports MapLibre's values (types are
  // free), and base-map.tsx the one that renders react-map-gl's <Map>. Unit tests and the
  // Playwright tree (tests/) mock them freely.
  {
    files: ["**/*.{ts,tsx}"],
    ignores: ["components/map/**", "tests/**", ...TESTS],
    rules: {
      "@typescript-eslint/no-restricted-imports": ["error", {
        paths: [...MAP_COMPONENT, { name: "maplibre-gl", message: MAP, allowTypeImports: true }],
        patterns: [...IMPORTS, ...MAP_PATTERNS],
      }],
      "no-restricted-syntax": ["error", ...SYNTAX, MAP_IMPORT_EXPRESSION],
    },
  },
  {
    files: ["components/map/**/*.{ts,tsx}"],
    ignores: ["components/map/base-map.tsx", ...TESTS],
    rules: {
      "@typescript-eslint/no-restricted-imports": ["error", { paths: MAP_COMPONENT, patterns: [...IMPORTS, MAP_PATTERNS[0]] }],
      "no-restricted-syntax": ["error", ...SYNTAX, MAP_COMPONENT_IMPORT_EXPRESSION],
    },
  },
  {
    // Node scripts. The overflow scanner also carries a function that runs IN the page
    // (serialised by Playwright), hence the DOM names beside Node's.
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: {
        process: "readonly", console: "readonly", URL: "readonly",
        window: "readonly", document: "readonly", getComputedStyle: "readonly", NodeFilter: "readonly", localStorage: "readonly",
      },
    },
    rules: { "no-console": "off" },
  },
  {
    // Playwright's fixture callback is called `use` – not React's hook, and nothing in a
    // fixture file is a component.
    files: ["tests/**/*.fixture.ts"],
    rules: {
      "react-hooks/rules-of-hooks": "off",
    },
  },
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "playwright-report/**",
      "test-results/**",
      "coverage/**",
      ".local/**",
      "reports/**",
      "*.config.js",
      "*.config.mjs",
      "*.config.ts",
      "next-env.d.ts",
      // MapLibre's worker, copied from node_modules by scripts/copy-maplibre-worker.mjs.
      "public/maplibre/**",
      // Throwaway browser probes. They are Node scripts, not app code, and they
      // live for one debugging session -- but while one exists it fails the
      // whole lint gate on `no-undef` for `process`/`console`, which turns a
      // scratch file into a blocked commit.
      "probe*.mjs",
      "*-tmp.mjs",
      "scratch-*.mjs",
      "tests/e2e/zz-*/**",
    ],
  },
];
