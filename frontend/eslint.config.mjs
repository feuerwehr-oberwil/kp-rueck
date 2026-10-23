import js from "@eslint/js";
import tseslint from "typescript-eslint";
import nextPlugin from "@next/eslint-plugin-next";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";

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
      // The App Router runs on the React Next vendors, which has no `useEffectEvent` yet:
      // the import type-checks and passes Vitest, then crashes the page. See the hook's file.
      "no-restricted-syntax": ["error",
        {
          selector: "ImportDeclaration[source.value='react'] > ImportSpecifier[imported.name=/^(experimental_)?useEffectEvent$/]",
          message: "Import useEffectEvent from '@/lib/hooks/use-effect-event' – Next 15's vendored React does not export it.",
        },
        {
          selector: "MemberExpression[object.name='React'][property.name=/^(experimental_)?useEffectEvent$/]",
          message: "Use useEffectEvent from '@/lib/hooks/use-effect-event' – Next 15's vendored React does not export it.",
        },
      ],
    },
    settings: {
      react: {
        version: "detect",
      },
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
    ignores: [
      ".next/**",
      "node_modules/**",
      "playwright-report/**",
      "test-results/**",
      "coverage/**",
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
