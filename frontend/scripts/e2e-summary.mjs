#!/usr/bin/env node
// Turns the nightly's Playwright JSON reports into a short Markdown list: what failed (with
// the first line of its error), what only passed on a retry, and how the quarantined specs
// did. The nightly puts it in the job summary and in its tracking issue, so the issue names
// the specs instead of pointing at a 60 MB artifact.
//
//   node scripts/e2e-summary.mjs <gate.json> [quarantine.json]
// A missing or unreadable report is said so in the output, never silently skipped.
import { existsSync, readFileSync } from "node:fs";

const [gatePath, quarantinePath] = process.argv.slice(2);

function load(path) {
  if (!path || !existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function* specs(suite) {
  for (const s of suite.specs ?? []) yield s;
  for (const child of suite.suites ?? []) yield* specs(child);
}

function firstErrorLine(test) {
  for (const r of [...(test.results ?? [])].reverse()) {
    const msg = r.error?.message ?? r.errors?.[0]?.message;
    if (msg) {
      // eslint-disable-next-line no-control-regex
      const line = msg.replace(/\u001b\[[0-9;]*m/g, "").split("\n").find((l) => l.trim());
      return line ? line.trim().slice(0, 200) : "";
    }
  }
  return "";
}

function classify(report) {
  const out = { failed: [], flaky: [], passed: 0, skipped: 0 };
  for (const suite of report.suites ?? []) {
    for (const spec of specs(suite)) {
      for (const test of spec.tests ?? []) {
        const name = `\`${spec.file}:${spec.line}\` ${spec.title}`;
        if (test.status === "unexpected") out.failed.push({ name, error: firstErrorLine(test) });
        else if (test.status === "flaky") out.flaky.push({ name });
        else if (test.status === "skipped") out.skipped += 1;
        else out.passed += 1;
      }
    }
  }
  return out;
}

const lines = [];
const gate = load(gatePath);
if (!gate) {
  lines.push(`**No gate report** (\`${gatePath}\`) – the run died before Playwright finished; see the log.`);
} else {
  const g = classify(gate);
  lines.push(
    `**Gate:** ${g.failed.length} failed · ${g.flaky.length} flaky · ${g.passed} passed · ${g.skipped} skipped`,
  );
  if (g.failed.length) {
    lines.push("", "Failed (every retry):");
    for (const f of g.failed) lines.push(`- ${f.name}${f.error ? `\n  > ${f.error}` : ""}`);
  }
  if (g.flaky.length) {
    lines.push("", "Flaky (passed on a retry) – fix it or tag it `@quarantine-until-YYYY-MM-DD`:");
    for (const f of g.flaky) lines.push(`- ${f.name}`);
  }
}

if (quarantinePath) {
  const q = load(quarantinePath);
  if (!q) {
    lines.push("", "**Quarantine:** no report.");
  } else {
    const r = classify(q);
    const total = r.failed.length + r.flaky.length + r.passed;
    if (total === 0) {
      lines.push("", "**Quarantine:** empty.");
    } else {
      lines.push(
        "",
        `**Quarantine** (reported, never fails the night): ${r.failed.length} failed · ${r.flaky.length} flaky · ${r.passed} passed`,
      );
      for (const f of r.failed) lines.push(`- ✘ ${f.name}${f.error ? `\n  > ${f.error}` : ""}`);
      for (const f of r.flaky) lines.push(`- ~ ${f.name}`);
    }
  }
}

console.log(lines.join("\n"));
