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
 * mit site/index.html – wer hier umbenennt, muss dort mitziehen.
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

const DEFAULT_BASE = 'https://demo.kp-rueck.ch'
const VIEWPORT = { width: 1500, height: 937 } // 1.6:1 – dieselbe Kachelform wie bei KP Front
// Die öffentlichen Formulare sind für das Handy gebaut; enger Ausschnitt, gleiches Verhältnis.
const FORM_VIEWPORT = { width: 900, height: 562 }
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
  {
    name: 'auftraege',
    path: '/',
    settle: 1500,
    note: 'Auftrag aufgeklappt: die Einsätze der Route mit den nächsten Schritten',
    prep: async (page) => {
      await page.getByRole('button', { name: /^Aufträge$/ }).click()
      await page.waitForTimeout(1500)
      // Den bestehenden Auftrag aufklappen, damit die Route und die nächsten
      // Schritte sichtbar werden (nicht «Neuer Auftrag» erwischen).
      await page.getByText(/erledigt$/).first().click()
      await page.waitForTimeout(2000)
    },
  },
  {
    name: 'meldung',
    path: '/',
    settle: 1500,
    viewport: FORM_VIEWPORT,
    note: 'Das öffentliche Meldeformular (Telefon/Laufkundschaft), über den Teilen-Link',
    prep: async (page) => {
      const url = await openShareLink(page, /^Alarm$/)
      await page.goto(url, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(3500)
      // Beispielmeldung eintippen (nicht abschicken) — ein leeres Formular mit rot
      // markiertem Pflichtfeld sieht nach Fehler aus, nicht nach Werkzeug.
      await page.getByPlaceholder(/Brennt im Keller/i).fill('Wasser läuft über die Lichtschächte in den Heizungsraum')
      await page.getByPlaceholder(/Name der meldenden Person/i).fill('Marina Kaufmann')
      await page.getByPlaceholder(/079/).fill('079 123 45 67')
      // Das Tippen scrollt mit — für das Bild zurück an den Anfang des Formulars
      await page.evaluate(() => window.scrollTo(0, 0))
      await page.waitForTimeout(600)
    },
  },
  {
    name: 'reko',
    path: '/',
    settle: 1500,
    viewport: FORM_VIEWPORT,
    note: 'Das Reko-Formular auf dem Handy des Trupps, über den Teilen-Link',
    prep: async (page) => {
      const url = await openShareLink(page, /^Reko$/)
      await page.goto(url, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(3000)
      // Erst die Personenauswahl, dann der offene Einsatz — Ziel ist das Formular
      await page.locator('button, [role=button]').filter({ hasText: /offen/ }).first().click()
      await page.waitForTimeout(2000)
      const openForm = page.getByRole('button', { name: /Formular öffnen/i }).first()
      if (await openForm.isVisible({ timeout: 5000 }).catch(() => false)) {
        await openForm.click()
        await page.waitForTimeout(3000)
      }
    },
  },
  // Bewusst dunkel: das Board an der Wand im abgedunkelten KP. Der einzige
  // dunkle Shot – er belegt die dunkle Oberfläche aus der Funktionsliste.
  { name: 'display', path: '/display/board', settle: 4000, theme: 'dark', note: 'Beamer-Ansicht im KP' },
  { name: 'status', path: '/display/status', settle: 4000, note: 'Beamer-Ansicht: Gesamtübersicht' },
  { name: 'training', path: '/training', settle: 2500 },
]

/** Öffnet ein Teilen-Sheet (Alarm / Reko) und liest die tokenisierte URL daraus.
 *  Damit landen die echten öffentlichen Formulare im Bild statt nur des QR-Dialogs. */
const openShareLink = async (page, buttonName) => {
  await page.getByRole('button', { name: buttonName }).click()
  const field = page.locator('input[readonly]').first()
  await field.waitFor({ timeout: 15000 })
  const url = await field.inputValue()
  if (!/token=/.test(url)) throw new Error(`Kein Token im Teilen-Link: ${url}`)
  return url
}

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
    colorScheme: 'light',
    reducedMotion: 'reduce',
  })

  // Standard ist hell: die Landingpage ist hell, dunkle Shots stechen darin als
  // Fremdkörper heraus. Einzelne Shots dürfen per `theme: 'dark'` abweichen –
  // die Beamer-Ansicht an der Wand im abgedunkelten KP ist genau dieser Fall.
  // Den Willkommensdialog der Demo als "gesehen" markieren, bevor React startet.
  await ctx.addInitScript(() => {
    try {
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
    // Theme vor dem Laden setzen – next-themes liest den Wert beim Mount aus
    // localStorage; danach ist es für einen Nachzügler zu spät.
    const theme = shot.theme ?? 'light'
    await page.evaluate((t) => {
      try { localStorage.setItem('theme', t) } catch { /* private mode */ }
    }, theme)
    await page.emulateMedia({ colorScheme: theme })
    await page.setViewportSize(shot.viewport ?? VIEWPORT)
    await page.goto(base + shot.path, { waitUntil: 'domcontentloaded' })
    await page.waitForLoadState('networkidle').catch(() => {})
    await page.waitForTimeout(shot.settle)
    if (shot.prep) await shot.prep(page)
    // Erst hier ausblenden: prep() navigiert teils weg, ein früheres addStyleTag
    // wäre dann wieder verloren.
    await page.addStyleTag({ content: HIDE_CSS })
    await page.waitForTimeout(250)
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
