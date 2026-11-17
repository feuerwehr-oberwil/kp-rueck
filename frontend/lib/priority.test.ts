import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { PRIORITY_COLORS } from '@/lib/priority'

// `PRIORITY_COLORS` is the hex mirror of the light `--prio-*` tokens for what cannot read a
// CSS variable (MapLibre, the SVG markers, the print map). Mirrors drift, which is how Hoch
// came in three reds and Mittel in four ambers (COL-03) – so the mirror is held to the tokens.

const ROOT_BLOCK = readFileSync(join(__dirname, '..', 'app', 'globals.css'), 'utf8').split('.dark {')[0]

/** The light value of a custom property, following `var(--…)` references. */
function lightValue(name: string): string {
  const match = new RegExp(`--${name}:\\s*([^;]+);`).exec(ROOT_BLOCK)
  if (!match) throw new Error(`--${name} not in :root`)
  const value = match[1].trim()
  const ref = /^var\(--([\w-]+)\)$/.exec(value)
  return ref ? lightValue(ref[1]) : value
}

/** `oklch(L C H)` → `#rrggbb` (Björn Ottosson's matrices, sRGB gamma). */
function oklchToHex(value: string): string {
  const [l, c, h] = /oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)/.exec(value)!.slice(1).map(Number)
  const a = c * Math.cos((h * Math.PI) / 180)
  const b = c * Math.sin((h * Math.PI) / 180)
  const L = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const M = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const S = (l - 0.0894841775 * a - 1.291485548 * b) ** 3
  const linear = [
    4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
    -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
    -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S,
  ]
  const gamma = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055)
  return `#${linear.map((x) => Math.round(Math.min(1, Math.max(0, gamma(x))) * 255).toString(16).padStart(2, '0')).join('')}`
}

/** Largest channel difference between two hex colours – the tokens round to 3 decimals. */
function distance(a: string, b: string): number {
  const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  const [x, y] = [channels(a), channels(b)]
  return Math.max(...x.map((v, i) => Math.abs(v - y[i])))
}

describe('PRIORITY_COLORS', () => {
  it.each(['high', 'medium', 'low'] as const)('%s mirrors the light --prio token', (priority) => {
    const token = oklchToHex(lightValue(`prio-${priority}`))
    expect(distance(PRIORITY_COLORS[priority], token)).toBeLessThanOrEqual(1)
  })
})
