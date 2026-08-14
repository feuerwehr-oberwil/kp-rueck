import { describe, it, expect } from 'vitest'
import {
  AVAILABLE_LOCALES,
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  isSupportedLocale,
  loadMessages,
} from './i18n-messages'
import de from '@/messages/de.json'
import fr from '@/messages/fr.json'
import itMessages from '@/messages/it.json'

const catalogues: Record<string, object> = { de, fr, it: itMessages }

// Every leaf of a catalogue as path → string. Mirrors leafPaths() in
// i18n-messages.ts, kept separate on purpose: a test that imports the very
// function it checks would agree with any bug that function has.
const leaves = (node: unknown, prefix = '', out = new Map<string, string>()): Map<string, string> => {
  if (Array.isArray(node)) node.forEach((item, i) => leaves(item, `${prefix}[${i}]`, out))
  else if (node !== null && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) leaves(value, prefix ? `${prefix}.${key}` : key, out)
  } else out.set(prefix, String(node))
  return out
}

// The NAMES a message interpolates, as a set. Deliberately not a count: an ICU
// plural repeats `{count}` once per branch, and French may reach for `#` in a
// branch where German spelled the argument out. Which names must be supplied is
// the contract; how often each is written is style.
//
// The `[},]` tail is what separates an ARGUMENT from prose: `{count, plural, …}`
// and `{name}` are arguments, while the `{dem Einsatz …}` inside a plural branch
// is just text that happens to start with a word. Without it every translated
// plural branch reads as a renamed placeholder and the check cries wolf.
const placeholders = (value: string): string[] =>
  [...new Set([...value.matchAll(/\{(\w+)\s*[},]/g)].map((m) => m[1]))].sort()

// The i18n contract: German is the source of truth, every other catalogue is a
// deep-partial overlay merged over it. A missing key ANYWHERE must fall back to
// the German string, so a half-translated (or still empty) locale is always a
// complete catalogue. These tests pin that behaviour and the picker gating.
describe('locale catalogues', () => {
  it('supports de, fr and it', () => {
    expect(SUPPORTED_LOCALES).toEqual(['de', 'fr', 'it'])
    expect(isSupportedLocale('fr')).toBe(true)
    expect(isSupportedLocale('en')).toBe(false)
    expect(isSupportedLocale(undefined)).toBe(false)
  })

  it('an empty overlay falls back to German everywhere', () => {
    const de = loadMessages(DEFAULT_LOCALE)
    for (const locale of SUPPORTED_LOCALES) {
      const merged = loadMessages(locale)
      // Every German key must survive the merge — overlays may replace strings,
      // never remove them.
      expect(Object.keys(merged)).toEqual(Object.keys(de))
    }
    // While fr is an empty stub, the merged catalogue IS the German one.
    if (Object.keys(fr).length === 0) {
      expect(loadMessages('fr')).toEqual(de)
    }
  })

  it('offers exactly the locales that are COMPLETE, not merely started', () => {
    expect(AVAILABLE_LOCALES).toContain(DEFAULT_LOCALE)
    for (const locale of SUPPORTED_LOCALES) {
      if (locale === DEFAULT_LOCALE) continue
      expect(AVAILABLE_LOCALES.includes(locale)).toBe(
        leaves(catalogues[locale]).size === leaves(catalogues[DEFAULT_LOCALE]).size
      )
    }
  })

  // The picker gate is «covers every German key». These three assertions are what
  // «covered» has to mean for a locale that is switched on, checked for the locales
  // actually offered — a still-empty stub is governed by the test above instead.
  describe.each(AVAILABLE_LOCALES.filter((l) => l !== DEFAULT_LOCALE))('%s is complete', (locale) => {
    const german = leaves(catalogues[DEFAULT_LOCALE])
    const translated = leaves(catalogues[locale])

    it('translates every German key and invents none', () => {
      expect([...translated.keys()].sort()).toEqual([...german.keys()].sort())
    })

    it('has no empty string — a key resolving to "" is worse than a missing one', () => {
      const blanks = [...translated].filter(([, value]) => !value.trim()).map(([path]) => path)
      expect(blanks).toEqual([])
    })

    // A dropped or renamed {placeholder} does not throw, it renders the literal
    // «{count}» into an operator's screen. Only a comparison against German finds it.
    it('keeps every ICU placeholder German uses, per key', () => {
      const drifted = [...german]
        .map(([path, source]) => ({
          path,
          expected: placeholders(source),
          actual: placeholders(translated.get(path) ?? ''),
        }))
        .filter(({ expected, actual }) => expected.join() !== actual.join())
        .map(({ path, expected, actual }) => `${path}: expected ${expected}, got ${actual}`)
      expect(drifted).toEqual([])
    })
  })
})

// --- label coverage ------------------------------------------------------------------
//
// A status that has no label renders its raw key, and «1h 40m im Status reko_done» is what
// that looks like to a Kommandant. That one came from the backend and is fixed; these tests
// stop the frontend equivalent from appearing, since a missing key is invisible until the
// exact status/type happens to occur during an incident.
describe('label coverage', () => {
  const de = loadMessages('de') as unknown as Record<string, unknown>

  const at = (path: string): unknown =>
    path.split('.').reduce<unknown>((cur, part) => (
      cur && typeof cur === 'object' && part in cur ? (cur as Record<string, unknown>)[part] : undefined
    ), de)

  // Mirrors the DB constraint in backend/app/models.py, the IncidentStatus union in
  // lib/api/types/incidents.ts AND the board columns in lib/kanban-utils.ts — since the
  // rename there is only ONE status vocabulary, shared by database, API and board.
  const INCIDENT_STATUSES = [
    'incoming', 'reko', 'reko_done', 'enroute', 'active', 'returning', 'complete',
  ]
  // Every message block reached by a DYNAMIC lookup keyed on a status value. Those
  // resolve at runtime, so neither tsc nor a render test notices when a key and a status
  // drift apart — the board just prints the raw key. Enumerated here so they cannot.
  const STATUS_KEYED_BLOCKS = [
    'kanban.statusLabels', // t(`statusLabels.${status}`) — map search, timeline popover
    'kanban.columns', // t(`columns.${column.id}`) — board, display board/status, hover card
    'incidents.status', // t(`status.${…}`) + translateOutsideReact(`incidents.status.${…}`)
    'print.view.statusHeading', // t(`statusHeading.${status}`) — print view
    // NOT listed: `incidents.columns`. It held an ALL-CAPS copy of these labels and was
    // documented here as "the variant for /display/*" — but /display/* reads
    // `kanban.columns` and uppercases it in CSS (`app/display/board/page.tsx`). Nothing
    // ever read `incidents.columns`; this list was the only thing keeping it alive, which
    // is why the orphan sweep could not see it. Deleted 2026-07-30.
  ]
  // Mirrors incidentTypeLabels in lib/incident-types.ts
  const INCIDENT_TYPES = [
    'brandbekaempfung', 'elementarereignis', 'strassenrettung', 'technische_hilfeleistung',
    'oelwehr', 'chemiewehr', 'strahlenwehr', 'einsatz_bahnanlagen', 'bma_unechte_alarme',
    'dienstleistungen', 'diverse_einsaetze', 'gerettete_menschen', 'gerettete_tiere',
  ]

  it.each(STATUS_KEYED_BLOCKS)('%s is keyed on exactly the status vocabulary', (block) => {
    const node = at(block)
    expect(node).toEqual(expect.any(Object))
    // Both directions: no status without a label, and no label left behind under a
    // status name that no longer exists.
    expect(Object.keys(node as Record<string, unknown>).sort()).toEqual([...INCIDENT_STATUSES].sort())
    for (const status of INCIDENT_STATUSES) {
      expect(at(`${block}.${status}`)).toEqual(expect.any(String))
    }
  })

  it.each(INCIDENT_TYPES)('has a German label for incident type %s', (type) => {
    expect(at(`incidents.types.${type}`)).toEqual(expect.any(String))
  })

  it('contains no blank strings — a key that resolves to "" is worse than a missing one', () => {
    const blanks: string[] = []
    const walk = (node: unknown, path: string) => {
      if (typeof node === 'string') {
        if (!node.trim()) blanks.push(path)
      } else if (node && typeof node === 'object' && !Array.isArray(node)) {
        for (const [k, v] of Object.entries(node)) walk(v, path ? `${path}.${k}` : k)
      }
    }
    walk(de, '')
    expect(blanks).toEqual([])
  })
})
