import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { THEME_COLOR, applyThemeColor } from '@/lib/theme-color'

const FRONTEND = resolve(__dirname, '..')

/** oklch → sRGB hex, the conversion the two constants were taken from. */
function oklchToHex(L: number, C: number, h: number): string {
  const a = C * Math.cos((h * Math.PI) / 180)
  const b = C * Math.sin((h * Math.PI) / 180)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
  const enc = (x: number) => {
    const v = x > 0.0031308 ? 1.055 * x ** (1 / 2.4) - 0.055 : 12.92 * x
    return Math.round(255 * Math.min(1, Math.max(0, v))).toString(16).padStart(2, '0')
  }
  return `#${lin.map(enc).join('')}`
}

/** The first `--background` of a CSS block that starts with `selector {`. */
function backgroundOf(css: string, selector: string): string {
  const block = css.slice(css.indexOf(`${selector} {`))
  const m = block.match(/--background:\s*oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)\)/)
  if (!m) throw new Error(`no --background under ${selector}`)
  return oklchToHex(Number(m[1]), Number(m[2]), Number(m[3]))
}

describe('theme-color', () => {
  afterEach(() => {
    document.head.innerHTML = ''
  })

  it('is the page background of each scheme (no drift from globals.css)', () => {
    const css = readFileSync(resolve(FRONTEND, 'app/globals.css'), 'utf8')
    expect(THEME_COLOR.light).toBe(backgroundOf(css, ':root'))
    expect(THEME_COLOR.dark).toBe(backgroundOf(css, '.dark'))
  })

  it('is declared per scheme by the root layout, with the default status bar', () => {
    const layout = readFileSync(resolve(FRONTEND, 'app/layout.tsx'), 'utf8')
    expect(layout).toContain("{ media: '(prefers-color-scheme: light)', color: THEME_COLOR.light }")
    expect(layout).toContain("{ media: '(prefers-color-scheme: dark)', color: THEME_COLOR.dark }")
    expect(layout).toContain("statusBarStyle: 'default'")
    expect(layout).toContain('<ThemeColorSync />')
  })

  it('rewrites every theme-color meta to the scheme the app shows', () => {
    document.head.innerHTML = `
      <meta name="theme-color" media="(prefers-color-scheme: light)" content="${THEME_COLOR.light}">
      <meta name="theme-color" media="(prefers-color-scheme: dark)" content="${THEME_COLOR.dark}">`
    applyThemeColor('dark')
    const values = [...document.querySelectorAll('meta[name="theme-color"]')].map((m) => m.getAttribute('content'))
    expect(values).toEqual([THEME_COLOR.dark, THEME_COLOR.dark])
  })
})
