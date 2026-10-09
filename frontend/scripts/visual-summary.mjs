#!/usr/bin/env node
/**
 * The visual job's summary: which screenshots differed, and by how much.
 *
 *   node scripts/visual-summary.mjs [test-results/visual-report.json] >> "$GITHUB_STEP_SUMMARY"
 *
 * Reads the JSON reporter's output (playwright.visual.config.ts writes it in CI) and prints a
 * Markdown table: one row per state, its verdict, and the share of pixels that differed. The
 * PNGs themselves (expected / actual / diff) are in the job's `visual-diff` artifact — this
 * only says which ones to open. No dependencies: the image size comes from the PNG header.
 */
import { readFileSync, existsSync } from 'node:fs'

const reportPath = process.argv[2] ?? 'test-results/visual-report.json'

if (!existsSync(reportPath)) {
  console.log(`### Screenshots\n\nNo report at \`${reportPath}\` — the run stopped before Playwright finished (see the log).`)
  process.exit(0)
}

const report = JSON.parse(readFileSync(reportPath, 'utf8'))

/** Width × height from a PNG's IHDR chunk (bytes 16–23). */
function pngPixels(path) {
  try {
    const head = readFileSync(path).subarray(0, 24)
    return head.readUInt32BE(16) * head.readUInt32BE(20)
  } catch {
    return null
  }
}

/** Every spec with the describe titles above it (the file's own suite is the file name). */
function* specsOf(suite, path = []) {
  const here = suite.file && suite.title === suite.file ? path : [...path, suite.title]
  for (const spec of suite.specs ?? []) yield [[...here, spec.title], spec]
  for (const child of suite.suites ?? []) yield* specsOf(child, here)
}

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')
const stripAnsi = (text) => text.replace(ANSI, '')

const rows = []
for (const suite of report.suites ?? []) {
  for (const [titles, spec] of specsOf(suite)) {
    for (const test of spec.tests ?? []) {
      const result = test.results?.at(-1)
      if (!result) continue
      const message = stripAnsi((result.errors ?? []).map((e) => e.message ?? '').join('\n'))
      const actual = (result.attachments ?? []).find((a) => a.name?.endsWith('-actual.png'))
      // «4343 pixels (ratio 0.01 of all image pixels) are different» — Playwright rounds the
      // ratio to two places, which reads 0.01 for anything from 0.5 % down; recompute it.
      const counts = [...message.matchAll(/(\d+) pixels \(ratio [\d.]+ of all image pixels\) are different/g)]
      const pixels = counts.length ? Number(counts.at(-1)[1]) : null
      const total = actual?.path ? pngPixels(actual.path) : null

      let verdict = '✅ same'
      if (result.status === 'skipped') verdict = '⏭️ skipped'
      else if (result.status !== 'passed') {
        if (/snapshot doesn't exist/i.test(message)) verdict = '🆕 no baseline'
        else if (/two consecutive stable screenshots/i.test(message)) verdict = '〰️ never settled'
        else if (pixels !== null) verdict = '❌ differs'
        else verdict = '💥 error'
      }
      const share =
        pixels === null ? '' : total ? `${pixels.toLocaleString('en')} px (${((pixels / total) * 100).toFixed(3)} %)` : `${pixels} px`
      rows.push({ title: titles.filter(Boolean).join(' › '), file: spec.file, verdict, share, failed: result.status !== 'passed' && result.status !== 'skipped', message })
    }
  }
}

const failed = rows.filter((r) => r.failed)
const lines = ['### Screenshots', '']
lines.push(
  failed.length
    ? `**${failed.length} of ${rows.length} states differ from their baseline.** Open the \`visual-diff\` artifact (expected / actual / diff per state). If the change is deliberate, regenerate the baselines on CI (docs/VISUAL_TESTS.md § Accepting a change) — never to turn this green.`
    : `All ${rows.length} states match their baselines.`,
  '',
  '| State | File | Result | Pixels past the threshold |',
  '| --- | --- | --- | --- |',
)
for (const r of rows) lines.push(`| ${r.title} | \`${r.file}\` | ${r.verdict} | ${r.share} |`)
for (const r of failed.filter((r) => r.verdict === '💥 error')) {
  lines.push('', `<details><summary>${r.title}</summary>`, '', '```', r.message.slice(0, 2000), '```', '</details>')
}
console.log(lines.join('\n'))
