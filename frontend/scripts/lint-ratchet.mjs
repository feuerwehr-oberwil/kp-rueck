#!/usr/bin/env node
// `pnpm lint`: ESLint with a per-rule ratchet on warnings and on eslint-disable comments.
//
// Errors fail as always. Warnings are counted PER RULE against eslint-ratchet.json, which is
// the one place the allowed numbers are written down (CI, package.json and the docs only point
// here). A rule may never go above its number, a rule missing from the file is allowed none,
// and a rule that has dropped BELOW its number fails too, with the exact line to change — so
// the file always says what the tree really has, and a fixed warning cannot quietly come back.
//
// `// eslint-disable-next-line <rule>` comments are counted the same way, per rule, under
// "suppressed": a disable produces no warning, so without this a new one would slip past the
// warning cap (FE-08: 30 silenced exhaustive-deps sat outside the number that «only goes down»).
// A disable that suppresses nothing is ESLint's own «unused directive» warning, under "(no rule)".
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
const budgets = { warnings: ratchet.warnings ?? {}, suppressed: ratchet.suppressed ?? {} };

const eslint = new ESLint({ cwd: root, fix });
const results = await eslint.lintFiles(["."]);
if (fix) await ESLint.outputFixes(results);

const formatter = await eslint.loadFormatter("stylish");
const report = await formatter.format(results);
if (report) console.log(report);

const counts = { warnings: {}, suppressed: {} };
const bump = (kind, rule) => (counts[kind][rule ?? "(no rule)"] = (counts[kind][rule ?? "(no rule)"] ?? 0) + 1);
let errors = 0;
for (const file of results) {
  for (const m of file.messages) {
    if (m.severity === 2) errors += 1;
    else bump("warnings", m.ruleId);
  }
  for (const m of file.suppressedMessages) {
    if (m.suppressions.some((s) => s.kind === "directive")) bump("suppressed", m.ruleId);
  }
}

// Per kind: the rules above their number and the ones below it.
const compare = (kind) => {
  const budget = budgets[kind];
  const rules = [...new Set([...Object.keys(budget), ...Object.keys(counts[kind])])].sort();
  const over = [];
  const under = [];
  for (const rule of rules) {
    const have = counts[kind][rule] ?? 0;
    const allowed = budget[rule] ?? 0;
    if (have > allowed) over.push({ rule, have, allowed });
    else if (have < allowed) under.push({ rule, have, allowed });
  }
  return { rules, over, under };
};
const checks = { warnings: compare("warnings"), suppressed: compare("suppressed") };

if (tighten) {
  let changed = false;
  for (const [kind, { under }] of Object.entries(checks)) {
    if (!under.length) continue;
    const next = { ...budgets[kind] };
    for (const { rule, have, allowed } of under) {
      if (have === 0) delete next[rule];
      else next[rule] = have;
      console.log(`eslint-ratchet.json: ${kind} ${rule} ${allowed} -> ${have}`);
    }
    ratchet[kind] = next;
    budgets[kind] = next;
    under.length = 0;
    changed = true;
  }
  if (changed) writeFileSync(ratchetPath, JSON.stringify(ratchet, null, 2) + "\n");
}

const label = { warnings: "warnings", suppressed: "eslint-disable comments" };
for (const [kind, { rules }] of Object.entries(checks)) {
  console.log(`${kind === "warnings" ? "Warnings" : "Eslint-disable comments"} per rule (have / allowed):`);
  for (const rule of rules) {
    console.log(`  ${rule}: ${counts[kind][rule] ?? 0} / ${budgets[kind][rule] ?? 0}`);
  }
}

let failed = errors > 0;
if (errors > 0) console.error(`\n${errors} ESLint error(s). Errors are never allowed.`);
const fixHint = {
  warnings: "Fix the new one(s) listed above",
  suppressed:
    "Fix the cause instead of silencing it (for exhaustive-deps: useEffectEvent from" +
    " lib/hooks/use-effect-event for «the latest X without re-running»)",
};
for (const [kind, { over, under }] of Object.entries(checks)) {
  for (const { rule, have, allowed } of over) {
    failed = true;
    console.error(
      `\n${rule}: ${have} ${label[kind]}, the ratchet allows ${allowed}. ${fixHint[kind]};` +
        ` raising the number under "${kind}" in frontend/eslint-ratchet.json is not the fix.`,
    );
  }
  for (const { rule, have, allowed } of under) {
    failed = true;
    console.error(
      `\n${rule}: ${have} ${label[kind]}, the ratchet still says ${allowed}. Good — now lock it in:` +
        " run `pnpm lint --tighten` and commit frontend/eslint-ratchet.json.",
    );
  }
}
process.exit(failed ? 1 : 0);
