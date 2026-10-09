#!/usr/bin/env node
// `pnpm lint`: ESLint with a per-rule warning ratchet.
//
// Errors fail as always. Warnings are counted PER RULE against eslint-ratchet.json, which is
// the one place the allowed numbers are written down (CI, package.json and the docs only point
// here). A rule may never go above its number, a rule missing from the file is allowed none,
// and a rule that has dropped BELOW its number fails too, with the exact line to change — so
// the file always says what the tree really has, and a fixed warning cannot quietly come back.
//
//   pnpm lint             check (what CI runs)
//   pnpm lint --fix       apply ESLint's autofixes first, then check
//   pnpm lint --tighten   rewrite eslint-ratchet.json to today's counts where they went DOWN
//                         (it never raises a number — raising one is a reviewed, hand edit)
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ratchetPath = join(root, "eslint-ratchet.json");
const args = new Set(process.argv.slice(2));
const fix = args.has("--fix");
const tighten = args.has("--tighten");

const ratchet = JSON.parse(readFileSync(ratchetPath, "utf8"));
const budget = ratchet.warnings ?? {};

const eslint = new ESLint({ cwd: root, fix });
const results = await eslint.lintFiles(["."]);
if (fix) await ESLint.outputFixes(results);

const formatter = await eslint.loadFormatter("stylish");
const report = await formatter.format(results);
if (report) console.log(report);

const counts = {};
let errors = 0;
for (const file of results) {
  for (const m of file.messages) {
    if (m.severity === 2) errors += 1;
    else counts[m.ruleId ?? "(no rule)"] = (counts[m.ruleId ?? "(no rule)"] ?? 0) + 1;
  }
}

const rules = [...new Set([...Object.keys(budget), ...Object.keys(counts)])].sort();
const over = [];
const under = [];
for (const rule of rules) {
  const have = counts[rule] ?? 0;
  const allowed = budget[rule] ?? 0;
  if (have > allowed) over.push({ rule, have, allowed });
  else if (have < allowed) under.push({ rule, have, allowed });
}

if (tighten && under.length) {
  const next = { ...budget };
  for (const { rule, have } of under) {
    if (have === 0) delete next[rule];
    else next[rule] = have;
  }
  ratchet.warnings = next;
  writeFileSync(ratchetPath, JSON.stringify(ratchet, null, 2) + "\n");
  for (const { rule, have, allowed } of under) {
    console.log(`eslint-ratchet.json: ${rule} ${allowed} -> ${have}`);
  }
  under.length = 0;
}

console.log("Warnings per rule (have / allowed):");
for (const rule of rules) {
  console.log(`  ${rule}: ${counts[rule] ?? 0} / ${budget[rule] ?? 0}`);
}

let failed = errors > 0;
if (errors > 0) console.error(`\n${errors} ESLint error(s). Errors are never allowed.`);
for (const { rule, have, allowed } of over) {
  failed = true;
  console.error(
    `\n${rule}: ${have} warnings, the ratchet allows ${allowed}. Fix the new one(s) listed above;` +
      " raising the number in frontend/eslint-ratchet.json is not the fix.",
  );
}
for (const { rule, have, allowed } of under) {
  failed = true;
  console.error(
    `\n${rule}: ${have} warnings, the ratchet still says ${allowed}. Good — now lock it in:` +
      " run `pnpm lint --tighten` and commit frontend/eslint-ratchet.json.",
  );
}
process.exit(failed ? 1 : 0);
