#!/usr/bin/env node
/**
 * Capture the screenshots for the landing page and the README.
 *
 *   node site/capture.mjs                          # against the public demo
 *   node site/capture.mjs --base http://localhost:3000
 *   node site/capture.mjs --only board,feld        # only these names (both devices)
 *   node site/capture.mjs --device phone           # only one device
 *   node site/capture.mjs --scale 2 --docs-only    # the README PNGs in 2x
 *
 * Drives a real instance with Playwright as the demo editor and hides the demo chrome. Every
 * shot exists per device, in both themes:
 *
 *   desktop – 1500×937, the board as the KP sees it → shots/desktop/<name>.webp
 *   phone   – 390×844 at 3x, scaled to 780 wide    → shots/phone/<name>.webp
 *
 * Night twins go to shots/dark/<device>/. The board also writes the hero's small version
 * (desktop/board-992.webp) and the link preview (shots/board.jpg). The image names are the
 * contract with `hero.img` and `chapters.items[].img` in site/content/de.json – rename one
 * here, rename it there.
 *
 * Against a non-public instance: set KP_RUECK_USER / KP_RUECK_PASS.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// Playwright lives in the frontend workspace; the repo root has no node_modules.
const { chromium } = await import('@playwright/test')
  .catch(() => import('../frontend/node_modules/@playwright/test/index.mjs'))

const HERE = dirname(fileURLToPath(import.meta.url))
const SHOTS = join(HERE, 'shots')
// The README images come out of the same page states – a shot with `docs:` writes both in one
// pass, so they cannot drift apart.
const DOCS_IMAGES = join(HERE, '..', 'docs', 'images')

const DEFAULT_BASE = 'https://demo.kp-rueck.ch'
// KP Rück sets no `viewport-fit=cover`: on a phone the app starts below the status bar and ends
// above the home indicator. The picture adds those gaps back (`pad`, in points – KP Front keeps
// the same 19/14 of its safe area), filled with the page's own colours, so the screen's rounded
// corner never cuts into the app's first line. (Playwright's `devices['iPhone 14']` is the Safari
// viewport, 390×664 – too short for an installed app.)
const DEVICES = {
  desktop: { viewport: { width: 1500, height: 937 }, mobile: false, width: 1500 },
  phone: { viewport: { width: 390, height: 844 }, mobile: true, scale: 3, width: 780, pad: { top: 19, bottom: 14 } },
}
// The hero's desktop picture is never shown wider than 992 px (.wrap = 1040 px minus 2×24 px).
// This second, small version is the one phones and 1x screens load.
const HERO_W = 992
// The encoding happens inside the Chromium Playwright ships anyway – no second dependency.
const WEBP_QUALITY = 0.8
// The one JPEG: link previews (og:image). WhatsApp, Facebook and friends show no WebP.
const OG_QUALITY = 0.82

const argv = process.argv.slice(2)
const arg = (name) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : undefined
}
const base = (arg('base') || DEFAULT_BASE).replace(/\/$/, '')
const only = arg('only')?.split(',').map((s) => s.trim()).filter(Boolean)
// The README PNGs are viewed enlarged on GitHub and want 2x: the normal run first, then
// `--scale 2 --docs-only`.
const docsOnly = argv.includes('--docs-only')
const siteOnly = argv.includes('--site-only')
const requestedTheme = arg('theme')
if (requestedTheme && !['light', 'dark'].includes(requestedTheme)) throw new Error('--theme must be light or dark')
const themes = requestedTheme ? [requestedTheme] : docsOnly ? ['light'] : ['light', 'dark']
if (docsOnly && (siteOnly || requestedTheme === 'dark')) throw new Error('--docs-only requires light theme and cannot be combined with --site-only')
// Desktop capture resolution: 1 for the page, 2 for the README images (see above).
const scale = Number(arg('scale') || 1)
if (arg('device') && !['desktop', 'phone'].includes(arg('device'))) throw new Error('--device must be desktop or phone')

/** Demo and runtime chrome that has no business in a marketing picture. */
const HIDE_CSS = `
  [data-demo-ribbon],
  [data-sonner-toaster] { display: none !important; }
`

/** Fetches a tokenised share link through the signed-in session's API – the same endpoints the
 *  «Links & QR» sheet calls. */
const mintLink = async (page, path, method = 'POST') =>
  page.evaluate(
    async ([p, m]) => {
      const eventId = localStorage.getItem('kp-rueck-selected-event')
      const res = await fetch(`/backend-api${p}?event_id=${encodeURIComponent(eventId ?? '')}`, {
        method: m,
        credentials: 'include',
      })
      if (!res.ok) throw new Error(`${p}: HTTP ${res.status}`)
      return res.json()
    },
    [path, method],
  )

/** The Feld door: open the link, type the four-digit code (the fourth digit submits), then pick
 *  the person. The demo sandbox gives Schneider Peter the running Einsatz with Trawa and pumps –
 *  the fullest Schadenplatz. */
const enterFeldAs = async (page, name) => {
  const { link } = await mintLink(page, '/api/feld/generate-link')
  const { code } = await mintLink(page, '/api/feld/access', 'GET')
  await page.goto(base + link, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(2500)
  await page.keyboard.type(String(code), { delay: 120 })
  await page.waitForTimeout(3000)
  await page.getByPlaceholder(/^Name suchen( …|\.\.\.)$/).fill(name)
  await page.locator('button').filter({ hasText: new RegExp(name) }).first().click()
  await page.waitForTimeout(2500)
}

/** The map starts on the whole region: zoom two notches onto the cluster, then park the pointer
 *  where it opens no hover card. */
const zoomMap = async (page, { x, y }) => {
  await page.mouse.move(x, y)
  for (let i = 0; i < 2; i++) {
    await page.mouse.wheel(0, -400)
    await page.waitForTimeout(700)
  }
  await page.mouse.move(1, 1)
  await page.waitForTimeout(2500)
}

/** One shot = a route, the devices it is taken on, optionally a `prep` per device.
 *  `hero` marks the picture the page shows first (desktop): it also gets the small version and
 *  the link-preview JPEG. */
const shots = [
  { name: 'board', path: '/', settle: 2500, devices: ['desktop', 'phone'], docs: 'dashboard', hero: true },
  {
    name: 'karte',
    path: '/map',
    settle: 4000,
    devices: ['desktop', 'phone'],
    docs: 'map-view',
    // The desk opens with the legend laid over the map: fold it, then zoom. The phone's map is a
    // band above the list and frames the cluster well as it opens.
    prep: {
      desktop: async (page) => {
        await page.getByRole('button', { name: 'Legende ausblenden' }).click().catch(() => {})
        await zoomMap(page, { x: 560, y: 505 })
      },
    },
  },
  {
    name: 'verlauf',
    path: '/',
    settle: 2500,
    devices: ['desktop', 'phone'],
    prep: {
      desktop: async (page) => {
        await page.getByRole('button', { name: /^Verlauf$/ }).first().click()
        await page.waitForTimeout(2000)
      },
      phone: async (page) => {
        await page.getByRole('button', { name: 'Mehr Optionen' }).click()
        await page.waitForTimeout(1200)
        await page.getByRole('button', { name: /^Verlauf$/ }).first().click()
        await page.waitForTimeout(2000)
      },
    },
  },
  {
    name: 'meldung',
    path: '/',
    settle: 1500,
    devices: ['phone'],
    // The public intake form (phone calls, walk-ins) through its share link, with a sample report
    // typed in but not sent – an empty form with a red mandatory field reads as an error.
    prep: {
      phone: async (page) => {
        const { link } = await mintLink(page, '/api/intake/generate-link')
        await page.goto(base + link, { waitUntil: 'domcontentloaded', timeout: 60000 })
        await page.waitForTimeout(3500)
        const address = page.getByPlaceholder(/Adresse (suchen|eingeben)/i)
        await address.fill('Mühlemattstrasse 15, Oberwil')
        // Enter takes the free text; a blur with the geocoder list open does not.
        await address.press('Enter')
        await page.getByPlaceholder(/Brennt im Keller/i).fill('Wasser läuft über die Lichtschächte in den Heizungsraum')
        await page.getByPlaceholder(/Name der meldenden Person/i).fill('Marina Kaufmann')
        await page.getByPlaceholder(/079/).fill('079 123 45 67')
        // No focus ring on the last field, and back to the top of the form.
        await page.evaluate(() => {
          document.activeElement?.blur()
          window.scrollTo(0, 0)
        })
        await page.waitForTimeout(600)
      },
    },
  },
  {
    name: 'feld',
    path: '/',
    settle: 1500,
    devices: ['phone'],
    // Inside the Schadenplatz, not the list: Meldung, Mannschaft, and what the Trupp can report.
    prep: {
      phone: async (page) => {
        await enterFeldAs(page, 'Schneider Peter')
        await page.locator('button').filter({ hasText: /strasse|gasse|weg|platz/i }).first().click()
        await page.waitForTimeout(3000)
      },
    },
  },
]

const login = async (page) => {
  const demoEditor = page.getByRole('button', { name: /Anmelden als Bearbeiter/i })
  const isDemo = await demoEditor.waitFor({ state: 'visible', timeout: 20000 }).then(() => true, () => false)
  if (isDemo) return demoEditor.click()
  const user = process.env.KP_RUECK_USER
  const pass = process.env.KP_RUECK_PASS
  if (!user || !pass) throw new Error('No demo login found – set KP_RUECK_USER / KP_RUECK_PASS')
  await page.fill('#username', user)
  await page.fill('#password', pass)
  await page.click('button[type=submit]')
}

/** Scales a lossless capture to `width` and encodes it. `pad` adds gaps above and below (in
 *  points of a `points`-wide screen): the top one in `top` colour, the bottom one in the colour
 *  of the capture's last row. `page` is a blank tab – the app has nothing to do with it. */
const encode = async (page, png, { width, type, quality, pad, points }) => {
  const b64 = await page.evaluate(async ([src, width, type, quality, pad, points]) => {
    const img = new Image()
    img.src = src
    await img.decode()
    const k = width / img.naturalWidth
    const unit = pad ? width / points : 0
    const top = Math.round((pad?.top ?? 0) * unit)
    const bottom = Math.round((pad?.bottom ?? 0) * unit)
    const h = Math.round(img.naturalHeight * k)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = top + h + bottom
    const ctx = canvas.getContext('2d')
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, 0, top, width, h)
    if (pad) {
      ctx.fillStyle = pad.color
      ctx.fillRect(0, 0, width, top)
      const [r, g, b] = ctx.getImageData(4, top + h - 1, 1, 1).data
      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`
      ctx.fillRect(0, top + h, width, bottom)
    }
    return canvas.toDataURL(type, quality).split(',')[1]
  }, [`data:image/png;base64,${png.toString('base64')}`, width, type, quality, pad ?? null, points ?? null])
  return Buffer.from(b64, 'base64')
}

const capture = async (browser, device, theme) => {
  const d = DEVICES[device]
  const mine = shots.filter((s) => s.devices.includes(device) && (!only || only.includes(s.name)))
    .filter((s) => !docsOnly || (device === 'desktop' && s.docs))
  if (!mine.length) return
  const dir = theme === 'dark' ? join(SHOTS, 'dark') : SHOTS
  mkdirSync(join(dir, device), { recursive: true })
  const ctx = await browser.newContext({
    viewport: d.viewport,
    deviceScaleFactor: d.scale ?? scale,
    isMobile: d.mobile,
    hasTouch: d.mobile,
    locale: 'de-CH',
    timezoneId: 'Europe/Zurich',
    colorScheme: theme,
    reducedMotion: 'reduce',
  })
  // The app palette and the welcome dialog, before React starts.
  await ctx.addInitScript((theme) => {
    try {
      localStorage.setItem('kp-rueck.demo-welcome.v1', '1')
      localStorage.setItem('theme', theme)
    } catch { /* private mode */ }
  }, theme)
  const page = await ctx.newPage()
  const encoder = await ctx.newPage()
  page.on('pageerror', (e) => console.warn('  ! page error:', String(e).slice(0, 120)))

  console.log(`→ ${base} (${device}, ${theme})`)
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await login(page)
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 45000 })

  for (const shot of mine) {
    await page.goto(base + shot.path, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {})
    await page.waitForTimeout(shot.settle)
    await shot.prep?.[device]?.(page)
    // Only now: a prep may navigate away, and the style tag would go with the old page.
    await page.addStyleTag({ content: HIDE_CSS })
    await page.waitForTimeout(250)
    // Always from the lossless PNG: scaling and the one lossy step happen together.
    const png = await page.screenshot({ type: 'png' })
    // The status-bar gap takes the page's background, not whatever band the app draws first.
    const pad = d.pad && { ...d.pad, color: await page.evaluate(() => getComputedStyle(document.body).backgroundColor) }
    if (!docsOnly) {
      const write = async (file, opts) => {
        writeFileSync(join(dir, file), await encode(encoder, png, opts))
        console.log(`  ✓ ${file}`)
      }
      await write(join(device, `${shot.name}.webp`), { width: d.width, type: 'image/webp', quality: WEBP_QUALITY, pad, points: d.viewport.width })
      if (shot.hero && device === 'desktop') {
        await write(join(device, `${shot.name}-${HERO_W}.webp`), { width: HERO_W, type: 'image/webp', quality: WEBP_QUALITY })
        if (theme === 'light') await write(`${shot.name}.jpg`, { width: d.width, type: 'image/jpeg', quality: OG_QUALITY })
      }
    }
    if (shot.docs && device === 'desktop' && theme === 'light' && !siteOnly) {
      writeFileSync(join(DOCS_IMAGES, `${shot.docs}.png`), png)
      console.log(`  ✓ docs/images/${shot.docs}.png`)
    }
  }
  await ctx.close()
}

const run = async () => {
  if (only) {
    const names = shots.map((s) => s.name)
    const unknown = only.filter((n) => !names.includes(n))
    if (unknown.length) throw new Error(`--only: unknown ${unknown.join(', ')} (known: ${names.join(', ')})`)
  }
  const browser = await chromium.launch()
  try {
    const devices = arg('device') ? [arg('device')] : Object.keys(DEVICES)
    for (const theme of themes) for (const device of devices) await capture(browser, device, theme)
  } finally {
    await browser.close()
  }
  console.log('Screenshots captured. Rebuild with: node site/build.mjs')
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
