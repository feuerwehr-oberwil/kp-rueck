#!/usr/bin/env node
// Does KP Rück's loading snail still match KP Front's?
//
//   node scripts/check-snail-drift.mjs <kp-front checkout> [<kp-rueck checkout>]
//
// The firefighter snail is SHARED: KP Front owns it (public/firefighter-snail-loader.svg)
// and KP Rück carries a byte-identical copy in frontend/public/. The in-app shell trail
// (frontend/components/ui/shell-loader.tsx) is drawn from the SVG's `fs-shell-trail` path,
// inlined as SHELL_TRAIL_PATH. Two things can drift, so two checks:
//   1. our SVG is byte-identical with kp-front's;
//   2. SHELL_TRAIL_PATH equals the `fs-shell-trail` path in kp-front's SVG.
// Exit 0 when both hold, 1 on drift (with a reason per line on stderr), 2 on usage errors.
// No dependencies: CI runs it with the runner's own node, before any install.
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SVG = 'firefighter-snail-loader.svg'

export function shellTrailOf(svg) {
  return svg.match(/<path id="fs-shell-trail" d="([^"]+)"/)?.[1] ?? null
}

export function shellTrailConstantOf(source) {
  return source.match(/SHELL_TRAIL_PATH\s*=\s*\n?\s*'([^']+)'/)?.[1] ?? null
}

/** @returns {string[]} one message per problem; empty when nothing drifted */
export function findSnailDrift({ oursSvg, theirsSvg, componentSource }) {
  const problems = []
  if (!oursSvg.equals(theirsSvg)) {
    problems.push(`frontend/public/${SVG} differs from kp-front's public/${SVG}`)
  }
  const theirsPath = shellTrailOf(theirsSvg.toString('utf8'))
  const ourConstant = shellTrailConstantOf(componentSource)
  if (!theirsPath) problems.push(`kp-front's ${SVG} has no <path id="fs-shell-trail" d="…"> any more`)
  if (!ourConstant) problems.push('frontend/components/ui/shell-loader.tsx has no SHELL_TRAIL_PATH = \'…\'')
  if (theirsPath && ourConstant && theirsPath !== ourConstant) {
    problems.push('SHELL_TRAIL_PATH in shell-loader.tsx differs from the fs-shell-trail path in kp-front\'s SVG')
  }
  return problems
}

function main(argv) {
  const [front, rueckArg] = argv
  if (!front) {
    console.error('usage: check-snail-drift.mjs <kp-front checkout> [<kp-rueck checkout>]')
    return 2
  }
  const rueck = rueckArg ? resolve(rueckArg) : resolve(dirname(fileURLToPath(import.meta.url)), '..')
  let oursSvg, theirsSvg, componentSource
  try {
    theirsSvg = readFileSync(join(front, 'public', SVG))
  } catch {
    console.error(`kp-front's public/${SVG} is missing — the shared snail has moved or been renamed`)
    return 1
  }
  try {
    oursSvg = readFileSync(join(rueck, 'frontend', 'public', SVG))
    componentSource = readFileSync(join(rueck, 'frontend', 'components', 'ui', 'shell-loader.tsx'), 'utf8')
  } catch (error) {
    console.error(`cannot read this repository's copy: ${error.message}`)
    return 2
  }
  const problems = findSnailDrift({ oursSvg, theirsSvg, componentSource })
  if (!problems.length) {
    console.log(`  ✓ ${SVG} byte-identical`)
    console.log('  ✓ SHELL_TRAIL_PATH matches fs-shell-trail')
    return 0
  }
  for (const problem of problems) console.error(`::error::${problem}`)
  return 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)))
}
