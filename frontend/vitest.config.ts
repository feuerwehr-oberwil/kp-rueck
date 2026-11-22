import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "."),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    // scripts/*.test.mjs: the node scripts' own tests (the eslint plugin's RuleTester cases)
    include: ["**/*.{test,spec}.{ts,tsx}", "scripts/**/*.test.mjs"],
    exclude: [
      "node_modules/**",
      ".next/**",
      "tests/**",
      "playwright-report/**",
      "test-results/**",
      "coverage/**",
      ".local/**",
      "reports/**",
    ],
    css: false,
    restoreMocks: true,
  },
});
