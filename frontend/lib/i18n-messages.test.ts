import { describe, it, expect } from 'vitest'
import {
  AVAILABLE_LOCALES,
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  isSupportedLocale,
  loadMessages,
} from './i18n-messages'
import fr from '@/messages/fr.json'
import itMessages from '@/messages/it.json'

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

  it('offers exactly the locales that have translations in the picker', () => {
    expect(AVAILABLE_LOCALES).toContain(DEFAULT_LOCALE)
    expect(AVAILABLE_LOCALES.includes('fr')).toBe(Object.keys(fr).length > 0)
    expect(AVAILABLE_LOCALES.includes('it')).toBe(Object.keys(itMessages).length > 0)
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
    'incidents.columns', // the ALL-CAPS variant for /display/*
    'print.view.statusHeading', // t(`statusHeading.${status}`) — print view
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
