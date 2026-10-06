#!/usr/bin/env node
// The KP Rück app icon — ONE source for the favicon, the in-app mark, the iOS home-screen icon,
// the PWA icons and the landing page's mark.
//
//   node scripts/build-icons.mjs           # writes the SVGs, renders the PNGs
//   node scripts/build-icons.mjs --check [<checkout>]   # writes nothing; exit 1 on drift
//
// The mark is the sibling of KP Front's (kp-front tools/icons/gen.py): same ink tile and radial
// gradient, same red, same illustration language — off-white objects with hairline edges, one
// red accent, a ground shadow. Front's glyph is a folded map with a pin; ours is the Magnettafel
// the app replaces: a whiteboard on an easel, magnet cards in three columns, one card red
// because something is running. Mark only, no lettering — the OS prints «KP Rück» under the
// icon, and in the app the name is real text next to the mark. Owner's pick, 06.10.2026 (A2);
// replaces the «kp / rück» wordmark icon of 02.10.
//
// Two cuts of the glyph:
//   GLYPH  shadow, hairlines, column rules, magnet dots, marker tray — 40 px and up
//   SMALL  fewer, bigger cards, thick legs, no hairlines — the 16/32 px favicon
//
// Everything is drawn here, nowhere else. Outputs, all committed:
//   frontend/app/icon.svg                        favicon — SMALL on the rounded tile
//   frontend/public/icons/mark.svg               in-app mark (login), GLYPH on the rounded tile
//   site/index.template.html, 404.template.html  kp-rueck.ch favicon (data: URI) and header mark,
//                                                spliced between `<!--@template icon:… -->` and
//                                                `<!--@template /icon -->` lines (the site build
//                                                strips those) — then run `node site/build.mjs`
//   frontend/public/icons/apple-touch-icon.png   180, full-bleed: iOS applies its own squircle,
//                                                a rounded tile of ours would leave dark slivers
//   frontend/public/icons/icon-192.png, -512     manifest «any», rounded tile like Front's
//   frontend/public/icons/icon-maskable-512.png  manifest «maskable», full-bleed, content
//                                                scaled to 0.84 so it stays inside the 80 % safe
//                                                circle Android crops to
// iOS does NOT accept an SVG apple-touch-icon (it falls back to a page screenshot), which is
// why the home-screen icons are PNGs at all.
//
// The PNGs are rendered by Playwright's Chromium from the frontend's devDependencies. --check
// needs no dependencies: it compares the SVGs byte for byte and, for each PNG, the hash of the
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
const EDGE = '#c4cedb'
const RULE = '#d8e1ec'

// Board in 512 space; the glyph's bbox is ~ x92..420, y100..436, centred on (256, 264).
const B = { x: 92, y: 100, w: 328, h: 268 }
const COL = B.w / 3
const FLOOR = 420
const LEG_TOP = B.y + B.h - 4

/** Magnet cards: `stacks` cards per column, the first card of the middle column is red. */
function cards(stacks, { pad, h, gap, top, rx, grey, magnets }) {
  let out = ''
  stacks.forEach((n, c) => {
    for (let i = 0; i < n; i++) {
      const red = c === 1 && i === 0
      const x = B.x + c * COL + pad
      const y = top + i * gap
      out += `\n      <rect x="${x}" y="${y}" width="${COL - pad * 2}" height="${h}" rx="${rx}" fill="${red ? RED : grey}"/>`
      if (magnets) out += `\n      <circle cx="${x + 12}" cy="${y + h / 2}" r="6" fill="${red ? '#fff' : '#a9b6c6'}"${red ? ' opacity=".9"' : ''}/>`
    }
  })
  return out
}

const legs = (stroke, width) => `      <g stroke="${stroke}" stroke-width="${width}" stroke-linecap="round">
        <line x1="${B.x + B.w * 0.2}" y1="${LEG_TOP}" x2="${B.x + B.w * 0.12}" y2="${FLOOR}"/>
        <line x1="${B.x + B.w * 0.8}" y1="${LEG_TOP}" x2="${B.x + B.w * 0.88}" y2="${FLOOR}"/>
      </g>`

const GLYPH = `      <ellipse cx="256" cy="${FLOOR - 2}" rx="${B.w * 0.42}" ry="18" fill="#000" opacity="0.22"/>
${legs(EDGE, 12)}
      <rect x="${B.x}" y="${B.y}" width="${B.w}" height="${B.h}" rx="10" fill="#fff" stroke="${EDGE}" stroke-width="3"/>
      <g stroke="${RULE}" stroke-width="4">
        <line x1="${B.x + COL}" y1="${B.y + 14}" x2="${B.x + COL}" y2="${B.y + B.h - 14}"/>
        <line x1="${B.x + 2 * COL}" y1="${B.y + 14}" x2="${B.x + 2 * COL}" y2="${B.y + B.h - 14}"/>
      </g>${cards([3, 2, 1], { pad: 14, h: 44, gap: 56, top: B.y + 18, rx: 6, grey: '#c3cdda', magnets: true })}
      <rect x="${B.x + 18}" y="${B.y + B.h - 2}" width="${B.w - 36}" height="14" rx="5" fill="${RULE}" stroke="${EDGE}" stroke-width="2"/>`

const SMALL = `${legs('#b9c4d2', 18)}
      <rect x="${B.x}" y="${B.y}" width="${B.w}" height="${B.h}" rx="14" fill="#fff"/>${cards([2, 2, 1], { pad: 12, h: 60, gap: 80, top: B.y + 22, rx: 7, grey: '#9fadbf', magnets: false })}`

const GRADIENT = `  <defs><radialGradient id="kpr-tile" cx="50%" cy="36%" r="80%">
    <stop offset="0%" stop-color="${INK[0]}"/><stop offset="58%" stop-color="${INK[1]}"/><stop offset="100%" stop-color="${INK[2]}"/>
  </radialGradient></defs>`

function tile({ glyph, rounded, fit, size = 512, note = '' }) {
  const bg = rounded
    ? `  <rect width="512" height="512" rx="114" fill="url(#kpr-tile)"/>
  <rect x="3" y="3" width="506" height="506" rx="111" fill="none" stroke="#fff" stroke-opacity=".09" stroke-width="6"/>`
    : '  <rect width="512" height="512" fill="url(#kpr-tile)"/>'
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
${note}${GRADIENT}
${bg}
  <g transform="translate(256 256) scale(${fit}) translate(-256 -264)">
${glyph}
  </g>
</svg>
`
}

const appIcon = ({ rounded, fit }) => tile({ glyph: GLYPH, rounded, fit })

export const faviconSvg = () => tile({
  glyph: SMALL, rounded: true, fit: 1, size: 32,
  note: `  <!-- GENERATED by scripts/build-icons.mjs — edit the artwork there, not here. The small cut
       of the board (bigger cards, no hairlines) for browser tabs, bookmarks and history. -->
`,
})

export const markSvg = () => tile({
  glyph: GLYPH, rounded: true, fit: 1, size: 56,
  note: `  <!-- GENERATED by scripts/build-icons.mjs — edit the artwork there, not here. -->
`,
})

/** Text outputs, compared byte for byte by --check. */
export const SVGS = [
  { file: FAVICON, svg: faviconSvg },
  { file: 'frontend/public/icons/mark.svg', svg: markSvg },
]

// kp-rueck.ch inlines everything (its hand-out variant is one self-contained file), so the
// favicon goes in as a data: URI and the header mark as inline SVG — the favicon's small cut.
const inline = (svg) => svg.replace(/<!--[\s\S]*?-->\n/, '')
const siteFavicon = () => {
  const flat = inline(faviconSvg()).replace(/\n\s*/g, '').replace(/"/g, "'")
  return `<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,${encodeURIComponent(flat)}">`
}
const siteMark = () => inline(faviconSvg())
  .replace('width="32" height="32"', 'width="30" height="30" aria-hidden="true"')
  .trimEnd().split('\n').map((line) => `      ${line}`).join('\n')

const SITE = [
  { file: 'site/index.template.html', blocks: { favicon: siteFavicon, mark: siteMark } },
  { file: 'site/404.template.html', blocks: { favicon: siteFavicon } },
]
const BLOCK = /(<!--@template icon:(\w+) -->\n)[\s\S]*?(\n[ \t]*<!--@template \/icon -->)/g
const splice = (text, blocks) => text.replace(BLOCK, (_, open, name, close) => `${open}${blocks[name]()}${close}`)

// fit: the board already fills the tile like Front's map does at 1.06; maskable shrinks to 0.84.
export const PNGS = [
  { file: 'frontend/public/icons/apple-touch-icon.png', size: 180, svg: appIcon({ rounded: false, fit: 1.0 }) },
  { file: 'frontend/public/icons/icon-192.png', size: 192, svg: appIcon({ rounded: true, fit: 1.0 }) },
  { file: 'frontend/public/icons/icon-512.png', size: 512, svg: appIcon({ rounded: true, fit: 1.0 }) },
  { file: 'frontend/public/icons/icon-maskable-512.png', size: 512, svg: appIcon({ rounded: false, fit: 0.84 }) },
]

const sha = (data) => createHash('sha256').update(data).digest('hex')
const sourceHash = (png) => sha(`${png.size}\n${png.svg}`)

/** @returns {string[]} one message per problem; empty when nothing drifted */
export function findIconDrift(root = ROOT) {
  const problems = []
  for (const { file, svg } of SVGS) {
    const path = join(root, file)
    if (!existsSync(path) || readFileSync(path, 'utf8') !== svg()) {
      problems.push(`${file} is not what scripts/build-icons.mjs generates`)
    }
  }
  for (const { file, blocks } of SITE) {
    const path = join(root, file)
    if (!existsSync(path)) continue // --check on a partial copy (the drift test) has no site/
    const text = readFileSync(path, 'utf8')
    if (splice(text, blocks) !== text) problems.push(`${file}: the icon blocks are not what scripts/build-icons.mjs generates`)
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
  for (const { file, svg } of SVGS) writeFileSync(join(ROOT, file), svg())
  for (const { file, blocks } of SITE) {
    const path = join(ROOT, file)
    writeFileSync(path, splice(readFileSync(path, 'utf8'), blocks))
  }
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
  for (const { file } of [...SVGS, ...SITE]) console.log(`  ✓ ${file}`)
  console.log('  ✓ scripts/build-icons.lock.json')
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
