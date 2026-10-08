#!/usr/bin/env node
// Quarantined E2E specs carry an expiry date, and this is what holds them to it.
//
// A spec that flakes is tagged `@quarantine-until-YYYY-MM-DD` (at most 14 days out) with a
// line saying why:
//
//   test('…', { tag: '@quarantine-until-2026-10-22' }, async () => { … })  // flakes on …
//
// The nightly then runs it SEPARATELY: its result is reported but cannot turn the night red,
// and the @smoke gate skips it. What stops a quarantine from becoming a quiet delete is the
// date. Once it has passed, the nightly fails on this check (and so files its issue) until
// the spec is fixed and untagged, or deleted on purpose. Extending means editing the date in
// a reviewed commit.
//
//   node scripts/e2e-quarantine.mjs              format + expiry (the nightly)
//   node scripts/e2e-quarantine.mjs --format-only  format only (the PR gate: no date can make
//                                                  an unrelated PR red)
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const MAX_DAYS = 14;
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const testsDir = join(root, "tests");
const formatOnly = process.argv.includes("--format-only");

function* specFiles(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* specFiles(p);
    else if (/\.(spec|perf)\.ts$/.test(name)) yield p;
  }
}

const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
const problems = [];
const active = [];

for (const file of specFiles(testsDir)) {
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    for (const m of line.matchAll(/@quarantine[\w-]*/g)) {
      const where = `${relative(root, file)}:${i + 1}`;
      const tag = m[0];
      const date = /^@quarantine-until-(\d{4}-\d{2}-\d{2})$/.exec(tag)?.[1];
      if (!date || Number.isNaN(Date.parse(date + "T00:00:00Z"))) {
        problems.push(`${where}: \`${tag}\` – write it as @quarantine-until-YYYY-MM-DD`);
        continue;
      }
      const until = new Date(date + "T00:00:00Z");
      const days = Math.round((until - today) / 86_400_000);
      if (days > MAX_DAYS) {
        problems.push(`${where}: \`${tag}\` is ${days} days out – at most ${MAX_DAYS}`);
      } else if (!formatOnly && days < 0) {
        problems.push(`${where}: \`${tag}\` expired ${-days} day(s) ago – fix the spec and drop the tag, or delete it`);
      } else {
        active.push(`${where}: ${tag}`);
      }
    }
  });
}

if (active.length) {
  console.log(`Quarantined (${active.length}):`);
  for (const a of active) console.log(`  ${a}`);
} else {
  console.log("No quarantined E2E specs.");
}
if (problems.length) {
  for (const p of problems) console.error(`::error::${p}`);
  process.exit(1);
}
