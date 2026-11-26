import js from "@eslint/js";
import tseslint from "typescript-eslint";
import nextPlugin from "@next/eslint-plugin-next";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import kp from "./scripts/eslint-kp.mjs";

// Rules that the code meets everywhere today are ERRORS; the house rules in scripts/eslint-kp.mjs
// are WARNINGS that eslint-ratchet.json holds at today's counts (AGENTS.md › «A correction
// becomes a check»).
//
// A later block that sets the same rule REPLACES its options, so every block that narrows an
// import or a syntax rule spreads the shared lists below instead of restating them.
const TESTS = ["**/*.test.{ts,tsx}", "**/*.spec.{ts,tsx}"];

// One loading signal, always with words: components/ui/shell-loader.tsx (docs/FRONTEND.md › Loading states).
const SPINNER = "No spinners: LoadingStatus or ShellLoader from components/ui/shell-loader.tsx – docs/FRONTEND.md › Loading states.";
const IMPORTS = [
  { group: ["lucide-react"], importNamePattern: "^(Lucide)?Loader", message: SPINNER },
  { group: ["date-fns", "date-fns/*"], message: "Durations go through lib/duration.ts, dates through lib/date-locale.ts – docs/FRONTEND.md › Durations." },
];
const CAUGHT_MESSAGE =
  "Tell a caught error by its class, not its text: ApiError.isConflictError / .status, NetworkError.isNetworkError.";
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
  { selector: "TemplateElement[value.raw=/\\banimate-spin\\b/]", message: SPINNER },  // Sign-off 24.11.2026: the merge kept the base variant's `dark:` fill under the new one (dark
  // text on a dark Abbrechen). The look is the `variant` prop of components/ui/alert-dialog.tsx.
  {
    selector: "JSXOpeningElement[name.name=/^AlertDialog(Action|Cancel)$/] CallExpression[callee.name='buttonVariants']",
    message: "Set `variant` on AlertDialogAction / AlertDialogCancel – buttonVariants() in className keeps the base variant's dark: classes.",
  },
  // Sweep 25.11.2026: catches read `message.includes('409' | 'fetch' | German text)`. The text is
  // the browser's or the catalogue's (Safari says «Load failed», fr has its own words), so those
  // branches never ran. The error classes say what happened (lib/api/types/common.ts).
  ...["CatchClause", "CallExpression[callee.property.name='catch'] > :function"].map((scope) => ({
    selector: `${scope} CallExpression[callee.object.property.name='message'][callee.property.name=/^(includes|startsWith|endsWith|match|indexOf)$/]`,
    message: CAUGHT_MESSAGE,
  })),
];
// Every map goes through components/map/base-map.tsx: its `isolate` wrapper keeps markers and
// controls below the page's overlays, and it sets MapLibre's worker URL (docs/FRONTEND.md › Maps).
const MAP = "A map is components/map/base-map.tsx (<BaseMap>) – docs/FRONTEND.md › «Maps never rise above overlays».";
const MAP_COMPONENT = [{ name: "react-map-gl", importNames: ["default", "Map"], message: MAP }];
// every react-map-gl entry point (maplibre, mapbox, …) and MapLibre's JS files; its stylesheet stays free
const MAP_PATTERNS = [
  { group: ["react-map-gl/*"], importNames: ["default", "Map"], message: MAP },
  { regex: "^maplibre-gl/dist/.*\\.m?js$", message: MAP, allowTypeImports: true },
];
// import() of the same entry points (no-restricted-imports does not see it); the stylesheet stays free
const MAP_IMPORT_EXPRESSION = { selector: "ImportExpression[source.value=/^(maplibre-gl(\\u002Fdist\\u002F.*\\.m?js)?|react-map-gl(\\u002F.*)?)$/]", message: MAP };
// Sweep 25.11.2026 (FE.12): window events between components went by bare strings with an
// untyped `detail`. Every name and payload is in lib/app-events.ts (`emitAppEvent` / `onAppEvent`).
const APP_EVENTS = "Send and hear in-tab events through lib/app-events.ts (emitAppEvent / onAppEvent): one typed map of names and payloads.";
const APP_EVENT_NAME = "/^kp[:-]/";
const WINDOW_EVENTS = [
  { selector: `CallExpression[callee.property.name='dispatchEvent'] > NewExpression[callee.name=/^(Custom)?Event$/] > Literal.arguments:first-child[value=${APP_EVENT_NAME}]`, message: APP_EVENTS },
  { selector: "CallExpression[callee.object.name='window'][callee.property.name='dispatchEvent'] > NewExpression[callee.name='CustomEvent']", message: APP_EVENTS },
  { selector: `CallExpression[callee.property.name=/^(add|remove)EventListener$/] > Literal[value=${APP_EVENT_NAME}]`, message: APP_EVENTS },
];
// Sweep 25.11.2026 (TS.8): `.json()` and `JSON.parse` return `any`, and 25 of 30 sites let it
// flow on unchecked. Bind the result to `unknown` (`const body: unknown = await res.json()`),
// then narrow it – or let lib/api/http.ts's `request<T>` do it.
const UNKNOWN_BODIES = "Bind it to unknown first: `const body: unknown = await response.json()` (or JSON.parse), then narrow.";
const AS_UNKNOWN = "VariableDeclarator[id.typeAnnotation.typeAnnotation.type='TSUnknownKeyword']";
const JSON_BODY = "CallExpression[callee.property.name='json'][arguments.length=0]";
const JSON_PARSE = "CallExpression[callee.object.name='JSON'][callee.property.name='parse']";
const UNTYPED_PARSE = [
  // The result itself is the initialiser: `= await r.json()`, `= await r.json().catch(…)`,
  // `= JSON.parse(text)` – never a property read off it.
  { call: JSON_BODY, allowed: [`${AS_UNKNOWN} > AwaitExpression > ${JSON_BODY}`, `${AS_UNKNOWN} > AwaitExpression > CallExpression[callee.property.name='catch'] > MemberExpression > ${JSON_BODY}`] },
  { call: JSON_PARSE, allowed: [`${AS_UNKNOWN} > ${JSON_PARSE}`] },
].map(({ call, allowed }) => ({ selector: `${call}:not(${allowed.join(", ")})`, message: UNKNOWN_BODIES }));
const MAP_COMPONENT_IMPORT_EXPRESSION = { selector: "ImportExpression[source.value=/^react-map-gl(\\u002F.*)?$/]", message: MAP };

export default [
  // Generated from docs/openapi.json (`pnpm openapi:types`); lib/api/schema.test.ts holds it.
  { ignores: ["lib/api/schema.d.ts"] },
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
  // Server reads are queries (lib/query); the board store in lib/contexts keeps its own sync.
  {
    files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}", "lib/hooks/**/*.{ts,tsx}"],
    ignores: TESTS,
    rules: { "kp/no-effect-read": "warn" },
  },
  {
    files: ["app/**/*.tsx", "components/**/*.tsx", "lib/**/*.tsx"],
    ignores: TESTS,
    rules: { "kp/no-literal-copy": "warn" },
  },
  // A `!` hides a null the type says is possible: narrow where the value is known (a guard, an
  // early return, a prop that takes the non-null type). Ratcheted (eslint-ratchet.json).
  {
    files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}", "lib/**/*.{ts,tsx}"],
    ignores: TESTS,
    rules: { "@typescript-eslint/no-non-null-assertion": "warn" },
  },
  // The map door. components/map/ is the one place that imports MapLibre's values (types are
  // free), and base-map.tsx the one that renders react-map-gl's <Map>. Unit tests and the
  // Playwright tree (tests/) mock them freely. The same block holds the window-event door
  // (lib/app-events.ts is the one file that touches window events by name).
  {
    files: ["**/*.{ts,tsx}"],
    ignores: ["components/map/**", "tests/**", "lib/app-events.ts", ...TESTS],
    rules: {
      "@typescript-eslint/no-restricted-imports": ["error", {
        paths: [...MAP_COMPONENT, { name: "maplibre-gl", message: MAP, allowTypeImports: true }],
        patterns: [...IMPORTS, ...MAP_PATTERNS],
      }],
      "no-restricted-syntax": ["error", ...SYNTAX, ...WINDOW_EVENTS, ...UNTYPED_PARSE, MAP_IMPORT_EXPRESSION],
    },
  },
  {
    files: ["components/map/**/*.{ts,tsx}"],
    ignores: ["components/map/base-map.tsx", ...TESTS],
    rules: {
      "@typescript-eslint/no-restricted-imports": ["error", { paths: MAP_COMPONENT, patterns: [...IMPORTS, MAP_PATTERNS[0]] }],
      "no-restricted-syntax": ["error", ...SYNTAX, ...WINDOW_EVENTS, ...UNTYPED_PARSE, MAP_COMPONENT_IMPORT_EXPRESSION],
    },
  },
  // Unit tests build an Operation with makeOperation() (test-utils/operation-fixtures.ts): a cast
  // hides a new required field, and the test runs on a shape the board never makes.
  {
    files: TESTS,
    rules: {
      "no-restricted-syntax": ["error", ...SYNTAX, {
        selector: "TSAsExpression > TSTypeReference.typeAnnotation[typeName.name='Operation']",
        message: "Build the Operation with makeOperation() from @/test-utils/operation-fixtures – no cast.",
      }],
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
