/**
 * Suche über die Einstellungen.
 *
 * Siebzehn Abschnitte sind zu viele, um sie zu kennen, und zu wenige, um sie zu
 * durchklicken. Eine Gliederung beantwortet «wo gehört das hin»; sie beantwortet nicht
 * «wo war noch mal der Port». Dafür ist das hier.
 *
 * **Der Index kommt aus dem Übersetzungskatalog, nicht aus einer Liste von Hand.** Jede
 * Beschriftung und jeder Hinweis der Seite ist ohnehin schon ein Eintrag in `de.json`
 * unter einem bekannten Namensraum; eine zweite, gepflegte Liste würde ab dem ersten neuen
 * Feld auseinanderlaufen, und zwar unbemerkt. Hier wird stattdessen der Teilbaum
 * durchlaufen, der zu einem Abschnitt gehört – neue Zeilen sind damit am Tag ihrer
 * Übersetzung auffindbar, ohne dass jemand daran denken muss.
 *
 * Der Preis: der Katalog enthält in denselben Namensräumen auch Meldungen, Knopftexte und
 * Fehlertexte. Die filtert `NOISE` grob heraus; was durchrutscht, ist ein Treffer zu viel,
 * nicht ein Treffer zu wenig – und die Suche ist ein Findehilfsmittel, kein Inventar.
 */

/** Woher die durchsuchbaren Texte eines Abschnitts stammen (Pfade in den `messages`). */
const SECTION_NAMESPACES: Record<string, readonly string[]> = {
  general: ['settings.page.general'],
  integrations: ['settings.integrations'],
  printer: ['settings.printer'],
  gps: ['settings.gps'],
  users: ['settings.users'],
  // Die Karte holt ihre Texte aus `sync.config` (top-level, nicht unter settings.*) –
  // der Eintrag hier war lange leer, und «railway» fand auf einer Seite mit einem
  // Abschnitt «Railway Offline» nichts. Eine Suche, die einmal lügt, wird nicht mehr
  // gefragt.
  sync: ['sync.config'],
  alerting: ['settings.page.alerting'],
  alarmIntake: ['settings.page.alarmIntake'],
  notifications: ['notifications.settings'],
  checklist: ['settings.page.checklist'],
  auftragTemplates: ['settings.page.auftragTemplates'],
  fallback: ['settings.fallback'],
  personnel: ['settings.personnel'],
  vehicles: ['settings.vehicles'],
  materials: ['settings.materials'],
  import: ['settings.page.import'],
  audit: ['settings.page.audit'],
  telemetry: ['settings.page.telemetry'],
  device: ['settings.device', 'settings.page.general.appearance', 'settings.page.general.language'],
}

/**
 * Teilbäume, die zwar im Namensraum liegen, aber keine Einstellung beschreiben. Ein
 * Treffer in einer Toast-Meldung führt niemanden zu dem Feld, das er sucht.
 */
const NOISE = new Set([
  'toasts',
  'errors',
  'placeholder',
  'placeholders',
  'confirm',
  'loadFailed',
  'saveFailed',
  'saveError',
  'loadSettingsError',
])

/** Ein Treffer: der Abschnitt, und der Text, der gepasst hat. */
export interface SettingsSearchHit {
  section: string
  /** Der Katalogtext, in dem die Suche fündig wurde – wird als Beleg angezeigt. */
  text: string
  /** Punktzahl, klein ist besser: Treffer am Wortanfang schlagen Treffer in der Mitte. */
  score: number
  /** Wo im Text der Treffer beginnt/endet – die Anzeige hebt genau das hervor
   *  und kürzt UM die Fundstelle herum, nie davor. */
  matchStart: number
  matchEnd: number
}

type MessageTree = Record<string, unknown>

function resolve(messages: MessageTree, path: string): unknown {
  return path.split('.').reduce<unknown>((node, key) => {
    if (node && typeof node === 'object') return (node as MessageTree)[key]
    return undefined
  }, messages)
}

/** Alle Blatt-Zeichenketten eines Teilbaums, ohne die Rausch-Zweige. */
function* leaves(node: unknown, depth = 0): Generator<string> {
  if (typeof node === 'string') {
    yield node
    return
  }
  if (!node || typeof node !== 'object' || depth > 6) return
  for (const [key, value] of Object.entries(node as MessageTree)) {
    if (NOISE.has(key)) continue
    yield* leaves(value, depth + 1)
  }
}

/** Höchstens so viele Treffer pro Abschnitt. Einer war zu wenig: «radius» fand den
 *  Magazinradius und verschluckte den Ankunftsradius wortlos. */
const HITS_PER_SECTION = 3

/**
 * Die Fundstellen für `query` – gruppierbar nach Abschnitt, bester Treffer zuerst,
 * höchstens `HITS_PER_SECTION` je Abschnitt und `limit` insgesamt.
 *
 * `sections` kommt von der Seite und trägt schon die Rechte: wer keine Fahrzeuge bearbeiten
 * darf, soll sie auch nicht über die Suche finden. Der Abschnittsname zählt als bester
 * möglicher Treffer – wer «Drucker» tippt, meint den Abschnitt, nicht die Zeile, in der das
 * Wort zufällig auch vorkommt.
 */
export function searchSettings(
  messages: MessageTree,
  query: string,
  sections: readonly { id: string; label: string }[],
  limit = 12,
): SettingsSearchHit[] {
  const needle = query.trim().toLowerCase()
  if (needle.length < 2) return []

  const hits: SettingsSearchHit[] = []

  for (const { id: section, label } of sections) {
    const sectionHits: SettingsSearchHit[] = []

    const labelAt = label.toLowerCase().indexOf(needle)
    if (labelAt >= 0) {
      sectionHits.push({
        section,
        text: label,
        score: -100,
        matchStart: labelAt,
        matchEnd: labelAt + needle.length,
      })
    }

    const namespaces = SECTION_NAMESPACES[section] ?? []
    for (const namespace of namespaces) {
      for (const text of leaves(resolve(messages, namespace))) {
        const at = text.toLowerCase().indexOf(needle)
        if (at < 0) continue
        // Wortanfang schlägt Wortmitte; kurzer Text schlägt langen, weil ein kurzer
        // Katalogtext eher eine Beschriftung ist und ein langer eher ein Hinweis.
        const startsWord = at === 0 || /[\s(«"'\-/]/.test(text[at - 1] ?? '')
        const score = (startsWord ? 0 : 100) + Math.min(text.length, 400)
        sectionHits.push({ section, text, score, matchStart: at, matchEnd: at + needle.length })
      }
    }

    sectionHits.sort((a, b) => a.score - b.score)
    hits.push(...sectionHits.slice(0, HITS_PER_SECTION))
  }

  // Abschnitte in der Reihenfolge ihres jeweils besten Treffers, die Treffer eines
  // Abschnitts beieinander – die Anzeige gruppiert nach Abschnitt, und eine Liste,
  // die zwischen zwei Abschnitten hin- und herspringt, liest sich als Unordnung.
  const bestPerSection = new Map<string, number>()
  for (const hit of hits) {
    const best = bestPerSection.get(hit.section)
    if (best === undefined || hit.score < best) bestPerSection.set(hit.section, hit.score)
  }
  return hits
    .sort((a, b) =>
      (bestPerSection.get(a.section)! - bestPerSection.get(b.section)!) ||
      a.section.localeCompare(b.section) ||
      (a.score - b.score),
    )
    .slice(0, limit)
}
