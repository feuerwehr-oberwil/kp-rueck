#!/usr/bin/env node
/**
 * Screenshots für die Landingpage aufnehmen.
 *
 *   node site/capture.mjs                       # gegen die öffentliche Demo
 *   node site/capture.mjs --base http://localhost:3000
 *   node site/capture.mjs --only board,karte    # nur einzelne Shots
 *
 * Fährt eine echte Instanz mit Playwright an, meldet sich als Editor an, schaltet
 * auf das dunkle Board-Theme, blendet Demo-Chrome (Willkommensdialog, DEMO-Banderole,
 * Toasts) aus und legt die Bilder in site/shots/ ab. Die Bildnamen sind der Vertrag
 * mit site/index.html — wer hier umbenennt, muss dort mitziehen.
 *
 * Gegen eine nicht-öffentliche Instanz: KP_RUECK_USER / KP_RUECK_PASS setzen.
 */
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// Playwright liegt im Frontend-Workspace; im Repo-Root gibt es keine node_modules.
const { chromium } = await import('@playwright/test')
  .catch(() => import('../frontend/node_modules/@playwright/test/index.mjs'))

const HERE = dirname(fileURLToPath(import.meta.url))
const SHOTS = join(HERE, 'shots')

const DEFAULT_BASE = 'https://kp-rueck-demo.up.railway.app'
const VIEWPORT = { width: 1500, height: 937 } // 1.6:1 — dieselbe Kachelform wie bei KP Front
const QUALITY = 82

const argv = process.argv.slice(2)
const arg = (name) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : undefined
}
const base = (arg('base') || DEFAULT_BASE).replace(/\/$/, '')
const only = arg('only')?.split(',').map((s) => s.trim()).filter(Boolean)

/** Ein Shot = eine Route, optional eine Vorbereitung (Dialog öffnen o. ä.). */
const shots = [
  { name: 'board', path: '/', settle: 2500, note: 'Hero: Einsatzboard' },
  {
    name: 'karte',
    path: '/map',
    settle: 4000,
    note: 'Karte mit Einsätzen und Fahrzeugen',
    // Die Karte startet auf der ganzen Region; für das Bild auf das Einsatzgebiet
    // hineinzoomen (Leaflet-Scrollzoom auf den Cluster).
    prep: async (page) => {
      await page.mouse.move(560, 505)
      let i = 0
      while (i < 2) {
        await page.mouse.wheel(0, -400)
        await page.waitForTimeout(700)
        i++
      }
      await page.waitForTimeout(2500)
    },
  },
  {
    name: 'disposition',
    path: '/',
    settle: 1500,
    prep: async (page) => {
      await page.getByRole('button', { name: /^Fahrzeuge$/ }).click()
      await page.waitForTimeout(1200)
    },
  },
  { name: 'training', path: '/training', settle: 2500 },
]

/** Demo- und Laufzeit-Chrome, die im Marketing-Bild nichts zu suchen hat. */
// Der Attribut-Selektor auf die Tailwind-Klassen fängt Instanzen ab, die noch vor
// dem data-demo-ribbon-Hook deployt wurden.
const HIDE_CSS = `
  [data-demo-ribbon],
  [class~="-rotate-45"][class~="bg-amber-500"],
  [data-sonner-toaster] { display: none !important; }
`

const login = async (page) => {
  const demoEditor = page.getByRole('button', { name: /Als Editor einloggen/i })
  const isDemo = await demoEditor.waitFor({ state: 'visible', timeout: 20000 }).then(() => true, () => false)
  if (isDemo) {
    await demoEditor.click()
    return
  }
  const user = process.env.KP_RUECK_USER
  const pass = process.env.KP_RUECK_PASS
  if (!user || !pass) throw new Error('Kein Demo-Login gefunden – KP_RUECK_USER / KP_RUECK_PASS setzen')
  await page.fill('#username', user)
  await page.fill('#password', pass)
  await page.click('button[type=submit]')
}

const run = async () => {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    locale: 'de-CH',
    timezoneId: 'Europe/Zurich',
    colorScheme: 'dark',
    reducedMotion: 'reduce',
  })

  // Dunkles Board-Theme erzwingen und den Willkommensdialog der Demo als
  // "gesehen" markieren, bevor React startet.
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('theme', 'dark')
      localStorage.setItem('kp-rueck.demo-welcome.v1', '1')
    } catch { /* private mode */ }
  })

  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.warn('  ! page error:', String(e).slice(0, 120)))

  console.log(`→ ${base}`)
  await page.goto(base, { waitUntil: 'domcontentloaded' })
  await login(page)
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 45000 })
  await page.waitForLoadState('networkidle').catch(() => {})

  const wanted = shots.filter((s) => !only || only.includes(s.name))
  if (!wanted.length) throw new Error(`--only passt auf keinen Shot (${shots.map((s) => s.name).join(', ')})`)

  for (const shot of wanted) {
    await page.goto(base + shot.path, { waitUntil: 'domcontentloaded' })
    await page.addStyleTag({ content: HIDE_CSS })
    await page.waitForLoadState('networkidle').catch(() => {})
    await page.waitForTimeout(shot.settle)
    if (shot.prep) await shot.prep(page)
    const path = join(SHOTS, `${shot.name}.jpg`)
    await page.screenshot({ path, type: 'jpeg', quality: QUALITY })
    console.log(`  ✓ ${shot.name}.jpg  (${shot.path})`)
  }

  await browser.close()
  console.log('Fertig. Danach: node site/build.mjs')
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
