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
  // Die Synchronisation bringt ihre Texte in den Karten selbst mit, nicht im Katalog –
  // auffindbar bleibt sie über ihren Abschnittsnamen (siehe `searchSettings`).
  sync: [],
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

/**
 * Die Abschnitte, in denen `query` vorkommt – höchstens `limit`, bester Treffer zuerst.
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
  limit = 8,
): SettingsSearchHit[] {
  const needle = query.trim().toLowerCase()
  if (needle.length < 2) return []

  const hits: SettingsSearchHit[] = []

  for (const { id: section, label } of sections) {
    let best: SettingsSearchHit | null = null

    if (label.toLowerCase().includes(needle)) {
      best = { section, text: label, score: -100 }
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
        if (!best || score < best.score) best = { section, text, score }
      }
    }
    if (best) hits.push(best)
  }

  return hits.sort((a, b) => a.score - b.score).slice(0, limit)
}
