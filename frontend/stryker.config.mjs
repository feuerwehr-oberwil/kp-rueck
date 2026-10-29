/** Mutation-test the board's safety and persistence decisions. Expand with --mutate. */
// The pnpm patch for core 10.1.1 activates static mutants before imports even
// when testFiles is set; otherwise constants appear to survive without changing.
export default {
  $schema: "./node_modules/@stryker-mutator/core/schema/stryker-schema.json",
  testRunner: "vitest",
  plugins: ["@stryker-mutator/vitest-runner"],
  vitest: { configFile: "vitest.mutation.config.ts", pool: "forks" },
  mutate: [
    "lib/assignment-refusal.ts",
    "lib/display-staleness.ts",
    "lib/duplicates.ts",
    "lib/duration.ts",
    "lib/feld-assignment.ts",
    "lib/feld-delivery.ts",
    "lib/field-save.ts",
    "lib/operation-equality.ts",
    "lib/pickup.ts",
    "lib/release-undo.ts",
    "lib/resource-status.ts",
    "lib/restore-incident.ts",
    "lib/route-start.ts",
    "lib/stale-data.ts",
    "lib/sync-cooldown.ts",
  ],
  testFiles: [
    "lib/{assignment-refusal,display-staleness,duplicates,duration,feld-assignment,feld-delivery,field-save,operation-equality,pickup,release-undo,resource-status,restore-incident,route-start,stale-data,sync-cooldown}.test.ts",
    "lib/hooks/use-release-undo.test.ts",
    "lib/contexts/operations-context.field-save.test.tsx",
    "lib/contexts/operations-context.sync.test.tsx",
  ],
  concurrency: 3,
  thresholds: { high: 95, low: 90, break: 90 },
  ignorePatterns: [".local/**", "reports/**", ".next/**"],
  reporters: ["clear-text", "progress", "html", "json"],
  htmlReporter: { fileName: "reports/mutation/index.html" },
  jsonReporter: { fileName: "reports/mutation/mutation.json" },
};
