#!/usr/bin/env node
/**
 * Screenshots für die Landingpage aufnehmen.
 *
 *   node site/capture.mjs                       # gegen die öffentliche Demo
 *   node site/capture.mjs --scale 2 --only board,karte   # README-Bilder in 2x nachziehen
 *   node site/capture.mjs --base http://localhost:3000
 *   node site/capture.mjs --only board,karte    # nur einzelne Shots
 *
 * Fährt eine echte Instanz mit Playwright an, meldet sich als Editor an, schaltet
 * auf das dunkle Board-Theme, blendet Demo-Chrome (Willkommensdialog, DEMO-Banderole,
 * Toasts) aus und legt die Bilder in site/shots/ ab – WebP für die Seite, dazu ein JPEG des
 * Hero-Bildes für die Linkvorschau. Die Bildnamen sind der Vertrag
 * mit `shots.items` in site/content/de.json – wer hier umbenennt, muss dort
 * mitziehen (nur dort: die Übersetzungen erben den Dateinamen und beschriften bloss).
 *
 * Gegen eine nicht-öffentliche Instanz: KP_RUECK_USER / KP_RUECK_PASS setzen.
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// Playwright liegt im Frontend-Workspace; im Repo-Root gibt es keine node_modules.
const { chromium } = await import('@playwright/test')
  .catch(() => import('../frontend/node_modules/@playwright/test/index.mjs'))

const HERE = dirname(fileURLToPath(import.meta.url))
const SHOTS = join(HERE, 'shots')
// Die README-Bilder entstehen aus denselben Seitenzuständen wie die Landingpage-Shots.
// Vorher wurden sie von Hand geschossen und waren dadurch ein halbes Jahr alt, während
// site/shots/ aktuell blieb — ein Shot mit `docs:` schreibt jetzt beides in einem Durchgang.
const DOCS_IMAGES = join(HERE, '..', 'docs', 'images')

const DEFAULT_BASE = 'https://demo.kp-rueck.ch'
const VIEWPORT = { width: 1500, height: 937 } // 1.6:1 – dieselbe Kachelform wie bei KP Front
// Die öffentlichen Formulare sind für das Handy gebaut; enger Ausschnitt, gleiches Verhältnis.
const FORM_VIEWPORT = { width: 900, height: 562 }
// Die Landingpage liefert WebP: dieselbe Aufnahme wiegt rund halb so viel wie das JPEG von
// früher. Encodiert wird im Chromium, den Playwright ohnehin mitbringt – keine zweite
// Abhängigkeit, nichts, was auf dem Rechner installiert sein müsste.
const WEBP_QUALITY = 0.8
// Breiter als das wird das Hero-Bild nie gezeigt (.wrap = 1040 px minus 2×24 px Innenabstand).
// Diese zweite, kleine Fassung ist die, die Telefone und 1x-Bildschirme laden.
const HERO_W = 992
// Das einzige verbliebene JPEG: die Linkvorschau (og:image). WhatsApp, Facebook und Co.
// zeigen kein WebP.
const OG_QUALITY = 0.82

const argv = process.argv.slice(2)
const arg = (name) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : undefined
}
const base = (arg('base') || DEFAULT_BASE).replace(/\/$/, '')
const only = arg('only')?.split(',').map((s) => s.trim()).filter(Boolean)
// Nur die README-Bilder neu schreiben und die Landingpage-JPEGs in Ruhe lassen. Nötig,
// weil beide Ausgaben aus derselben Aufnahme stammen, aber nicht dieselbe Auflösung
// wollen: die Landingpage bindet inline ein (1x), die README-Bilder werden auf GitHub
// vergrössert (2x). Also: erst der normale Lauf, dann `--scale 2 --docs-only`.
const docsOnly = argv.includes('--docs-only')
// Auflösung der Aufnahme. 1 reicht für die Landingpage (sie bindet die Bilder inline ein,
// Seitengewicht zählt dort). Die README-Bilder werden auf GitHub auf Retina-Displays
// betrachtet und wurden früher von Hand mit 2x geschossen — darum `--scale 2` für den
// docs-Durchgang. Die width/height-Angaben in content/de.json bleiben davon unberührt.
const scale = Number(arg('scale') || 1)

/** Ein Shot = eine Route, optional eine Vorbereitung (Dialog öffnen o. ä.).
 *  `hero` markiert das eine Bild, das die Landingpage zuoberst zeigt – es bekommt zusätzlich
 *  die kleine Fassung fürs Telefon und das JPEG für die Linkvorschau. */
const shots = [
  { name: 'board', path: '/', settle: 2500, note: 'Hero: Einsatzboard', docs: 'dashboard', hero: true },
  {
    name: 'karte',
    path: '/map',
    settle: 4000,
    note: 'Karte mit Einsätzen und Fahrzeugen',
    docs: 'map-view',
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
      const { link } = await mintLink(page, '/api/intake/generate-link')
      await page.goto(base + link, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(3500)
      // Beispielmeldung eintippen (nicht abschicken) — ein leeres Formular mit rot
      // markiertem Pflichtfeld sieht nach Fehler aus, nicht nach Werkzeug. Die
      // Adresse gehört seit dem Einsatzort-Zwang dazu; Enter übernimmt den
      // Freitext (ein Blur mit offenem Geocoder-Dropdown tut es nicht).
      await page.getByPlaceholder(/Adresse eingeben/i).fill('Mühlemattstrasse 15, Oberwil')
      await page.getByPlaceholder(/Adresse eingeben/i).press('Enter')
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
      // Der Reko-Link ist weg — /feld hat die Fläche übernommen. Der Weg zum
      // Formular ist die Feld-Tür, als die Reko-Person, die die Sandbox säät
      // (Brunner Sarah auf «Wasser in Tiefgarage»).
      await enterFeldDoor(page, base)
      await page.getByPlaceholder('Name suchen...').fill('Brunner')
      await page.locator('button').filter({ hasText: /Brunner Sarah/ }).first().click()
      await page.waitForTimeout(2500)
      await page.locator('button').filter({ hasText: /Reko erfassen/ }).first().click()
      await page.waitForTimeout(3000)
    },
  },
  {
    name: 'feld',
    path: '/',
    settle: 1500,
    viewport: FORM_VIEWPORT,
    note: 'Die eigenen Schadenplätze auf dem Handy des Trupps, über den Feld-Link',
    // Überspringt sich, solange die Instanz den Feld-Knopf nicht hat. Die Demo
    // hinkt dem Board naturgemäss hinterher — sie wird aus `main` deployt, und
    // ein Shot kann erst entstehen, wenn das Feature dort angekommen ist. Ohne
    // diesen Ausstieg risse ein voller `node site/capture.mjs`-Lauf ab und man
    // verlöre auch die acht Bilder, die sich sehr wohl aufnehmen liessen.
    skipIf: async (page) =>
      // Kein Feld-Link auf dieser Instanz = die Ansicht gibt es dort nicht.
      !(await mintLink(page, '/api/feld/access', 'GET').then(() => true, () => false)),
    prep: async (page) => {
      await enterFeldDoor(page, base)
      // Die Personenauswahl zuerst: ein Trupp MIT Zuteilung, sonst bliebe
      // «Meine Schadenplätze» leer. Die Sandbox gibt Schneider Peter den
      // laufenden Einsatz mit Trawa und Pumpen — die vollste Kachel.
      // Die Liste ist ein Stationsbestand — erst suchen, dann klicken.
      await page.getByPlaceholder('Name suchen...').fill('Schneider')
      await page.locator('button').filter({ hasText: /Schneider Peter/ }).first().click()
      await page.waitForTimeout(2500)
      // Dann in den Schadenplatz hinein. Die Liste allein füllt das Bild nicht
      // — drinnen steht, worum es geht: Meldung, Mannschaft, und was der Trupp
      // von hier aus melden kann.
      const firstPlatz = page.locator('button').filter({ hasText: /strasse|gasse|weg|platz/i }).first()
      if (await firstPlatz.isVisible({ timeout: 5000 }).catch(() => false)) {
        await firstPlatz.click()
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

/** Holt einen tokenisierten Teilen-Link über die API der eingeloggten Sitzung.
 *  Früher wurde er aus dem Teilen-Sheet gelesen; seit die Footer-Buttons in
 *  einem «Links & QR»-Sheet aufgehen, ist der API-Weg der robuste — dieselben
 *  Endpunkte, die das Sheet selbst aufruft. */
const mintLink = async (page, path, method = 'POST') => {
  const data = await page.evaluate(
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
  return data
}

/** Die Feld-Tür: Link öffnen, den vierstelligen Code tippen (die vierte Ziffer
 *  schickt selbst ab), auf die Personenliste warten. */
const enterFeldDoor = async (page, base) => {
  const { link } = await mintLink(page, '/api/feld/generate-link')
  const { code } = await mintLink(page, '/api/feld/access', 'GET')
  await page.goto(base + link, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)
  await page.keyboard.type(String(code), { delay: 120 })
  await page.waitForTimeout(3000)
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

/**
 * Rechnet eine Aufnahme (verlustfreies PNG) auf `width` herunter und encodiert sie – WebP für
 * die Seite, JPEG für die Linkvorschau. `page` ist ein leerer zweiter Tab: die Instanz selbst
 * hat damit nichts zu tun.
 */
const encode = async (page, png, { width, type, quality }) => {
  const b64 = await page.evaluate(async ([src, width, type, quality]) => {
    const img = new Image()
    img.src = src
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = Math.round(img.naturalHeight * (width / img.naturalWidth))
    const ctx = canvas.getContext('2d')
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL(type, quality).split(',')[1]
  }, [`data:image/png;base64,${png.toString('base64')}`, width, type, quality])
  return Buffer.from(b64, 'base64')
}

const run = async () => {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: scale,
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
  // Der leere Tab, auf dem die Bilder encodiert werden (siehe `encode`).
  const encoder = await ctx.newPage()
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
    // Ein Shot darf sich abmelden, wenn die Instanz das Feature noch nicht hat.
    // Nur das: kein Ersatzbild, keine Notlösung — ein fehlendes Bild ist ein
    // ehrlicheres Ergebnis als eines, das etwas anderes zeigt als es behauptet.
    if (shot.skipIf && (await shot.skipIf(page))) {
      console.log(`  – ${shot.name} übersprungen (Instanz kennt die Ansicht noch nicht)`)
      continue
    }
    if (shot.prep) await shot.prep(page)
    // Erst hier ausblenden: prep() navigiert teils weg, ein früheres addStyleTag
    // wäre dann wieder verloren.
    await page.addStyleTag({ content: HIDE_CSS })
    await page.waitForTimeout(250)
    if (!docsOnly) {
      // Immer aus dem verlustfreien PNG heraus: Verkleinerung und die einzige verlustbehaftete
      // Stufe passieren so in einem Schritt – und `--scale 2` liefert dadurch ein schärferes
      // Bild statt eines doppelt so breiten.
      const png = await page.screenshot({ type: 'png' })
      const width = (shot.viewport ?? VIEWPORT).width
      const write = async (file, opts) => {
        writeFileSync(join(SHOTS, file), await encode(encoder, png, opts))
        console.log(`  ✓ ${file}  (${shot.path})`)
      }
      await write(`${shot.name}.webp`, { width, type: 'image/webp', quality: WEBP_QUALITY })
      if (shot.hero) {
        await write(`${shot.name}-${HERO_W}.webp`, { width: HERO_W, type: 'image/webp', quality: WEBP_QUALITY })
        await write(`${shot.name}.jpg`, { width, type: 'image/jpeg', quality: OG_QUALITY })
      }
    }
    // Derselbe Seitenzustand, zweite Ausgabe: das README-Bild. PNG, weil README-Bilder
    // auf GitHub oft vergrössert betrachtet werden und Text dort verlustfrei bleiben soll.
    if (shot.docs) {
      const docsPath = join(DOCS_IMAGES, `${shot.docs}.png`)
      await page.screenshot({ path: docsPath, type: 'png' })
      console.log(`  ✓ docs/images/${shot.docs}.png`)
    }
  }

  await browser.close()
  console.log('Fertig. Danach: node site/build.mjs')
  console.log('README-Bilder (docs/images/) wurden mitgeschrieben, wo ein Shot `docs:` trägt.')
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
