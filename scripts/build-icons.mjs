#!/usr/bin/env node
// The KP Rück app icon — ONE source for the favicon, the iOS home-screen icon and the PWA icons.
//
//   node scripts/build-icons.mjs           # writes frontend/app/icon.svg, renders the PNGs
//   node scripts/build-icons.mjs --check [<checkout>]   # writes nothing; exit 1 on drift
//
// The mark is the sibling of KP Front's (kp-front tools/icons/gen.py): same ink tile and radial
// gradient, same red, same layout — white «kp», the app's word in red below it, a glyph with a
// ground shadow. Front's glyph is a folded map with a pin; ours stands the map's three panels
// upright as the columns of the Magnettafel and puts a red card with a white magnet where the
// pin sits. Owner's pick, 02.10.2026 (option C).
//
// Everything is drawn here, nowhere else. Outputs, all committed:
//   frontend/app/icon.svg                        favicon — glyph only (text is mud at 16px)
//   frontend/public/icons/apple-touch-icon.png   180, full-bleed: iOS applies its own squircle,
//                                                a rounded tile of ours would leave dark slivers
//   frontend/public/icons/icon-192.png, -512     manifest «any», rounded tile like Front's
//   frontend/public/icons/icon-maskable-512.png  manifest «maskable», full-bleed, content
//                                                scaled to 0.88 so it stays inside the 80 % safe
//                                                circle Android crops to
// iOS does NOT accept an SVG apple-touch-icon (it falls back to a page screenshot), which is
// why the home-screen icons are PNGs at all.
//
// The lettering is OUTLINED (path data below), so neither the build nor any device needs a font.
// It is Sora — the app's own face (frontend/app/fonts/sora.woff2) — shaped with HarfBuzz and
// centred on its ink box: «kp» wght 800 / 134px / tracking -1 on baseline 176, «rück» wght 600 /
// 64px / tracking 5 on baseline 262 (512 space). To re-cut it, outline those strings again with
// fontTools + uharfbuzz (instantiate the variable font, SVGPathPen) and replace the constants.
//
// The PNGs are rendered by Playwright's Chromium from the frontend's devDependencies. --check
// needs no dependencies: it compares icon.svg byte for byte and, for each PNG, the hash of the
// SVG it must be rendered from and the hash of the file itself against build-icons.lock.json —
// so an artwork change without a re-render, or a hand-edited PNG, fails the frontend tests.
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const LOCK = join(ROOT, 'scripts', 'build-icons.lock.json')
const FAVICON = 'frontend/app/icon.svg'

const RED = '#e8392b'
const INK = ['#26344a', '#1b2330', '#141a24'] // gradient centre, tile, edge — Front's values

const KP = 'M224 176 202.2 141.4H192.2L221.2 102H246.7L219.2 139.2V127.4L251.2 176ZM171.5 176V78.2H195.9V176ZM259.1 202.8V102H278.3V133.9H276.2Q276.6 123.1 280.6 115.4Q284.5 107.8 291.3 103.8Q298.2 99.9 307 99.9Q314.7 99.9 320.8 102.6Q327 105.4 331.4 110.4Q335.8 115.4 338.2 122.3Q340.5 129.1 340.5 137.3V140.5Q340.5 148.7 338.4 155.6Q336.2 162.5 331.9 167.6Q327.7 172.8 321.4 175.6Q315.2 178.4 307.2 178.4Q298.6 178.4 292 175Q285.4 171.6 281.6 164.7Q277.8 157.8 277.5 147.3L283.4 154.6V202.8ZM299.8 158.3Q304.6 158.3 308.3 155.8Q312 153.4 314.1 148.9Q316.1 144.5 316.1 138.9Q316.1 133.1 314.1 128.9Q312 124.7 308.4 122.3Q304.7 120 299.8 120Q295.4 120 291.5 122Q287.7 124 285.3 127.9Q282.9 131.8 282.9 137.3V141.8Q282.9 147.1 285.4 150.7Q288 154.4 291.9 156.4Q295.8 158.3 299.8 158.3Z'
const RUECK = 'M178 262V227.2H185V242H184.9Q184.9 234.5 188.1 230.7Q191.3 226.8 197.5 226.8H198.7V234.5H196.3Q191.8 234.5 189.3 237Q186.9 239.4 186.9 243.9V262ZM221.5 263.1Q215.5 263.1 212.2 259.1Q208.9 255.2 208.9 247.4V227.2H217.8V248.1Q217.8 251.3 219.6 253.2Q221.4 255.1 224.4 255.1Q227.5 255.1 229.5 253.1Q231.5 251.2 231.5 247.8V227.2H240.3V262H233.3V247.2H234Q234 252.5 232.7 256Q231.3 259.5 228.6 261.3Q225.9 263.1 221.9 263.1ZM217.9 221.4Q215.4 221.4 214.2 220Q213 218.6 213 216.5Q213 214.4 214.2 213.1Q215.4 211.7 217.9 211.7Q220.5 211.7 221.7 213.1Q222.8 214.4 222.8 216.5Q222.8 218.6 221.7 220Q220.5 221.4 217.9 221.4ZM231.4 221.4Q228.8 221.4 227.6 220Q226.4 218.6 226.4 216.5Q226.4 214.4 227.6 213.1Q228.8 211.7 231.4 211.7Q233.9 211.7 235.1 213.1Q236.3 214.4 236.3 216.5Q236.3 218.6 235.1 220Q233.9 221.4 231.4 221.4ZM271 263.2Q266.5 263.2 263.2 261.7Q259.8 260.2 257.7 257.6Q255.5 255 254.4 251.8Q253.3 248.6 253.3 245.3V244.1Q253.3 240.6 254.4 237.4Q255.5 234.1 257.7 231.6Q260 229 263.3 227.5Q266.6 226 270.9 226Q275.5 226 279.1 227.8Q282.6 229.6 284.8 232.7Q286.9 235.8 287.2 240H278.5Q278.2 237.3 276.3 235.5Q274.3 233.7 270.9 233.7Q268 233.7 266 235.1Q264.1 236.5 263.1 239Q262.2 241.5 262.2 244.7Q262.2 247.8 263.1 250.2Q264 252.7 266 254.1Q267.9 255.5 271 255.5Q273.3 255.5 275 254.7Q276.6 253.9 277.6 252.4Q278.6 251 278.9 249.1H287.5Q287.3 253.3 285.1 256.5Q282.9 259.7 279.2 261.4Q275.6 263.2 271 263.2ZM323.9 262 312.3 245.8H307.1L321.9 227.2H331.2L317.5 244.3L317.7 239.9L334 262ZM299.6 262V215.3H308.5V262Z'

// The board glyph, in 512 space; bbox ~ x100..414, y137..429.
const GLYPH = `      <ellipse cx="256" cy="410" rx="150" ry="19" fill="#000" opacity="0.22"/>
      <g stroke="#c4cedb" stroke-width="3" stroke-linejoin="round">
        <rect x="100" y="196" width="98" height="206" rx="6" fill="#e7edf4"/>
        <rect x="208" y="196" width="98" height="206" rx="6" fill="#ffffff"/>
        <rect x="316" y="196" width="98" height="206" rx="6" fill="#d8e1ec"/>
      </g>
      <g fill="#aebbcc">
        <rect x="114" y="214" width="70" height="48" rx="7"/>
        <rect x="114" y="276" width="70" height="48" rx="7"/>
        <rect x="222" y="300" width="70" height="48" rx="7"/>
        <rect x="330" y="214" width="70" height="48" rx="7"/>
      </g>
      <g transform="rotate(-6 256 200)">
        <rect x="194" y="156" width="132" height="104" rx="14" fill="#000" opacity="0.18"/>
        <rect x="190" y="148" width="132" height="104" rx="14" fill="${RED}"/>
        <circle cx="256" cy="184" r="22" fill="#fff"/>
      </g>`

function appIcon({ rounded, fit }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs><radialGradient id="bg" cx="50%" cy="36%" r="80%">
    <stop offset="0%" stop-color="${INK[0]}"/><stop offset="58%" stop-color="${INK[1]}"/><stop offset="100%" stop-color="${INK[2]}"/>
  </radialGradient></defs>
  <rect width="512" height="512"${rounded ? ' rx="114"' : ''} fill="url(#bg)"/>
  <g transform="translate(256 256) scale(${fit}) translate(-256 -262)">
    <path fill="#fff" d="${KP}"/>
    <path fill="${RED}" d="${RUECK}"/>
    <g transform="translate(256 366) scale(0.56) translate(-256 -275)">
${GLYPH}
    </g>
  </g>
</svg>
`
}

export const faviconSvg = () => `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
  <!-- GENERATED by scripts/build-icons.mjs — edit the artwork there, not here. The app icon's
       board glyph without the lettering, on a rounded tile: browser tab, bookmarks, history. -->
  <rect width="32" height="32" rx="7" fill="${INK[1]}"/>
  <g transform="translate(16 16.6) scale(0.085) translate(-257 -279)">
${GLYPH}
  </g>
</svg>
`

// fit: Front uses 1.06 for «any» (fills its own rounded tile), 1.0 for iOS, 0.88 for maskable.
export const PNGS = [
  { file: 'frontend/public/icons/apple-touch-icon.png', size: 180, svg: appIcon({ rounded: false, fit: 1.0 }) },
  { file: 'frontend/public/icons/icon-192.png', size: 192, svg: appIcon({ rounded: true, fit: 1.06 }) },
  { file: 'frontend/public/icons/icon-512.png', size: 512, svg: appIcon({ rounded: true, fit: 1.06 }) },
  { file: 'frontend/public/icons/icon-maskable-512.png', size: 512, svg: appIcon({ rounded: false, fit: 0.88 }) },
]

const sha = (data) => createHash('sha256').update(data).digest('hex')
const sourceHash = (png) => sha(`${png.size}\n${png.svg}`)

/** @returns {string[]} one message per problem; empty when nothing drifted */
export function findIconDrift(root = ROOT) {
  const problems = []
  const fav = join(root, FAVICON)
  if (!existsSync(fav) || readFileSync(fav, 'utf8') !== faviconSvg()) {
    problems.push(`${FAVICON} is not what scripts/build-icons.mjs generates`)
  }
  let lock = {}
  try {
    lock = JSON.parse(readFileSync(join(root, 'scripts', 'build-icons.lock.json'), 'utf8'))
  } catch {
    problems.push('scripts/build-icons.lock.json is missing or unreadable')
  }
  for (const png of PNGS) {
    const entry = lock[png.file]
    const path = join(root, png.file)
    if (!existsSync(path)) problems.push(`${png.file} is missing`)
    else if (!entry || entry.source !== sourceHash(png)) problems.push(`${png.file} was rendered from different artwork`)
    else if (entry.png !== sha(readFileSync(path))) problems.push(`${png.file} was changed by hand`)
  }
  return problems
}

async function build() {
  writeFileSync(join(ROOT, FAVICON), faviconSvg())
  const require = createRequire(join(ROOT, 'frontend', 'package.json'))
  const { chromium } = require('@playwright/test')
  const browser = await chromium.launch()
  const page = await browser.newPage({ deviceScaleFactor: 1 })
  const lock = {}
  for (const png of PNGS) {
    const svg = png.svg.replace('width="512" height="512"', `width="${png.size}" height="${png.size}"`)
    await page.setViewportSize({ width: png.size, height: png.size })
    await page.setContent(`<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block}</style>${svg}`)
    const data = await page.screenshot({ clip: { x: 0, y: 0, width: png.size, height: png.size }, omitBackground: true })
    writeFileSync(join(ROOT, png.file), data)
    lock[png.file] = { source: sourceHash(png), png: sha(data) }
    console.log(`  ✓ ${png.file} (${png.size}px)`)
  }
  await browser.close()
  writeFileSync(LOCK, `${JSON.stringify(lock, null, 2)}\n`)
  console.log(`  ✓ ${FAVICON}\n  ✓ scripts/build-icons.lock.json`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const at = process.argv.indexOf('--check')
  if (at !== -1) {
    const problems = findIconDrift(process.argv[at + 1] ? resolve(process.argv[at + 1]) : ROOT)
    for (const problem of problems) console.error(`::error::${problem}`)
    if (!problems.length) console.log('  ✓ app icons match scripts/build-icons.mjs')
    process.exit(problems.length ? 1 : 0)
  } else {
    await build()
  }
}
