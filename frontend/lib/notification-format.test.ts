/**
 * Notifications are `type` + `params` from the backend
 * (backend/app/services/notification_params.py — the params below are the
 * shapes its tests pin), said here in the operator's language. German is
 * expected to read as the backend's own sentence did; French is the point of
 * the exercise; a legacy row (no params) shows its German sentence whole.
 */
import { createTranslator } from 'next-intl'
import { describe, expect, it } from 'vitest'

import { loadMessages, type SupportedLocale } from './i18n-messages'
import { notificationDetail, notificationParts, type NotificationTranslator } from './notification-format'

/** A strict translator: a missing key or a bad placeholder fails the test instead of rendering the key path. */
function translator(locale: SupportedLocale): NotificationTranslator {
  return createTranslator({
    locale,
    messages: loadMessages(locale),
    onError: (error) => {
      throw error
    },
  }) as unknown as NotificationTranslator
}

const de = translator('de')
const fr = translator('fr')

type Row = { type: string; params?: Record<string, unknown> | null; message?: string }
/** NBSP (a figure stays with its «h») compared as a plain space, so the expectations stay readable. */
const plain = (text: string | undefined) => text?.replace(/\u00a0/g, ' ')
const parts = (row: Row, t: NotificationTranslator = de) => {
  const p = notificationParts({ type: row.type as never, params: row.params, message: row.message ?? 'German fallback' }, t)
  return Object.fromEntries(
    Object.entries(p).map(([key, value]) => [key, typeof value === 'string' ? plain(value) : value]),
  ) as typeof p
}

describe('notificationParts — /feld', () => {
  it('field_message: what is asked first, then where · who (the owner’s case)', () => {
    const row = {
      type: 'field_message',
      params: { place: 'Bahnhofstrasse 1, Coop Center', text: 'Verstärkung nötig', actor_kind: 'field', actor_name: 'Bendik Dimitri' },
    }
    const p = parts(row)
    expect(p).toEqual({ what: 'Verstärkung nötig', where: 'Bahnhofstrasse 1, Coop Center', who: 'Bendik Dimitri', source: 'feld' })
    expect(notificationDetail(p)).toBe('Bahnhofstrasse 1, Coop Center · Bendik Dimitri')
    // The crew's words stay theirs; the frame is the operator's.
    expect(parts({ ...row, params: { ...row.params, actor_kind: 'kp', actor_name: null } }, fr)).toEqual({
      what: 'Verstärkung nötig', where: 'Bahnhofstrasse 1, Coop Center', who: 'saisi au PC', source: 'feld',
    })
  })

  it('field_report: a new Schadenplatz, plain and taken over', () => {
    const plain = { type: 'field_report', params: { place: 'Hauptstrasse 41', by: 'Fabio Wyss', direct: false } }
    expect(parts(plain)).toEqual({ what: 'Neuer Schadenplatz', where: 'Hauptstrasse 41', who: 'Fabio Wyss', source: 'feld' })
    expect(parts({ ...plain, params: { ...plain.params, direct: true } }, fr).what).toBe(
      'Nouvelle place de sinistre – le groupe s’y rend directement',
    )
  })

  it('field_arrived / field_complete: the move is part of what happened, the actor is «who»', () => {
    const arrived = {
      type: 'field_arrived',
      params: { place: 'Mühlemattstrasse 18', moved_to: 'active', actor_kind: 'field', actor_name: 'Bendik Dimitri' },
    }
    expect(parts(arrived)).toEqual({
      what: 'Angekommen – Karte in «Im Einsatz» verschoben', where: 'Mühlemattstrasse 18', who: 'Bendik Dimitri', source: 'feld',
    })
    expect(parts(arrived, fr).what).toBe('Arrivée – carte déplacée dans « En intervention »')

    const complete = { type: 'field_complete', params: { place: 'Mühlemattstrasse 18', moved_to: null, actor_kind: 'gps', actor_name: null } }
    expect(parts(complete)).toMatchObject({ what: 'Einsatz beendet gemeldet', who: 'automatisch (GPS)' })
    expect(parts(complete, fr)).toMatchObject({ what: 'Fin d’intervention annoncée', who: 'automatique (GPS)' })
  })

  it('field_pickup: the note belongs to what is asked', () => {
    const needed = {
      type: 'field_pickup',
      params: { place: 'Bahnhofstrasse 1', needed: true, note: '2 Personen hinten', actor_kind: 'field', actor_name: 'Bendik Dimitri' },
    }
    expect(parts(needed)).toEqual({
      what: 'Abholung nötig – 2 Personen hinten', where: 'Bahnhofstrasse 1', who: 'Bendik Dimitri', source: 'feld',
    })
    expect(parts(needed, fr).what).toBe('Récupération nécessaire – 2 Personen hinten')
    expect(parts({ ...needed, params: { ...needed.params, needed: false, note: null } }, fr).what).toBe('Récupération effectuée')
  })

  it('rapport_submitted: a field actor without a name is «vom Feld»', () => {
    const row = { type: 'rapport_submitted', params: { place: 'Bahnhofstrasse 1', actor_kind: 'field', actor_name: null } }
    expect(parts(row)).toEqual({ what: 'Rapport erfasst', where: 'Bahnhofstrasse 1', who: 'vom Feld', source: 'feld' })
    expect(parts(row, fr)).toMatchObject({ what: 'Rapport saisi', who: 'du terrain' })
  })
})

describe('notificationParts — Reko, vehicles, time', () => {
  it('reko_arrived: with and without the name', () => {
    expect(parts({ type: 'reko_arrived', params: { place: 'Mühlemattstrasse 18', by: 'Lisa Hoffmann' } })).toEqual({
      what: 'Reko vor Ort', where: 'Mühlemattstrasse 18', who: 'Lisa Hoffmann', source: 'reko',
    })
    expect(parts({ type: 'reko_arrived', params: { place: 'Mühlemattstrasse 18', by: null } }, fr)).toEqual({
      what: 'Reconnaissance sur place', where: 'Mühlemattstrasse 18', source: 'reko',
    })
  })

  it('reko_submitted: the verdict and the estimate, the dangers by their key', () => {
    const row = {
      type: 'reko_submitted',
      params: {
        place: 'Hauptstrasse 41', by: 'Lisa Hoffmann', relevant: true,
        personnel_count: 3, duration_hours: 2, dangers: ['fire', 'chemical'],
      },
    }
    expect(parts(row)).toEqual({
      what: 'Reko abgeschlossen – Einsatz relevant (3 Pers., ~2 h, Gefahren: Feuer, Gefahrstoffe)',
      where: 'Hauptstrasse 41', who: 'Lisa Hoffmann', source: 'reko',
    })
    expect(parts(row, fr).what).toMatch(/^Reconnaissance terminée – intervention nécessaire \(3 pers\., ~2 h, Dangers : /)
    expect(
      parts({ type: 'reko_submitted', params: { place: 'Hauptstrasse 41', by: null, relevant: false, dangers: [] } }).what,
    ).toBe('Reko abgeschlossen – Kein Einsatz nötig')
  })

  it('vehicle_arrived: on site (with the place) and back at the Magazin', () => {
    expect(parts({ type: 'vehicle_arrived', params: { variant: 'on_site', vehicle: 'TLF', place: 'Mühlemattstrasse 18' } })).toEqual({
      what: 'TLF vor Ort', where: 'Mühlemattstrasse 18', source: 'vehicle',
    })
    expect(parts({ type: 'vehicle_arrived', params: { variant: 'returned', vehicle: 'TLF' } }, fr)).toEqual({
      what: 'TLF de retour à la caserne', source: 'vehicle',
    })
  })

  it('time_overdue: the board’s column title and the board’s duration notation', () => {
    const row = { type: 'time_overdue', params: { variant: 'status', place: 'Mühlemattstrasse 18', minutes: 56, status: 'enroute' } }
    expect(parts(row)).toEqual({ what: '56m im Status «Disponiert / Anfahrt»', where: 'Mühlemattstrasse 18', source: 'time' })
    expect(parts(row, fr).what).toBe('56m dans l’état « Engagé / en route »')
    expect(parts({ type: 'time_overdue', params: { variant: 'not_archived', place: 'Hauptstrasse 41', minutes: 65 } }).what).toBe(
      'Seit 1h 05m abgeschlossen, nicht archiviert',
    )
  })
})

describe('notificationParts — Übung', () => {
  it('new exercise, escalation, reinforcement, breakdown — the Einsatz is «where»', () => {
    expect(parts({ type: 'training_emergency', params: { variant: 'new', title: 'Kellerbrand', address: 'Bahnhofstrasse 1' } })).toEqual({
      what: 'Neuer Übungs-Einsatz', where: 'Kellerbrand (Bahnhofstrasse 1)', source: 'alarm',
    })
    expect(parts({ type: 'training_emergency', params: { variant: 'escalation', title: 'Wasser im Keller', text: 'Wasser steigt' } }, fr)).toEqual({
      what: 'Situation aggravée – Wasser steigt', where: 'Wasser im Keller', source: 'alarm',
    })
    expect(parts({ type: 'training_emergency', params: { variant: 'reinforcement', title: 'Wasser im Keller', text: '2 Pumpen' } }).what).toBe(
      'Feld fordert Verstärkung – 2 Pumpen',
    )
    expect(parts({ type: 'training_emergency', params: { variant: 'vehicle_down', title: 'Wasser im Keller', vehicle: 'TLF' } }, fr).what).toBe(
      'Véhicule TLF en panne – engager un remplacement',
    )
  })
})

describe('notificationParts — system notifications stay one line', () => {
  it('fatigue (#161): one row for the crew, the names as «who», in both languages', () => {
    const row = {
      type: 'personnel_fatigue',
      params: { hours: 4, count: 7, people: [{ name: 'Müller Hans', hours: 6 }, { name: 'Meier Anna', hours: 5 }], more: 5 },
    }
    expect(parts(row)).toEqual({
      what: '7 Personen seit über 4 h im Einsatz', who: 'Müller Hans (6 h), Meier Anna (5 h) und 5 weitere', source: 'system',
    })
    expect(parts(row, fr)).toEqual({
      what: '7 personnes en service depuis plus de 4 h', who: 'Müller Hans (6 h), Meier Anna (5 h) et 5 autres', source: 'system',
    })
    const one = { type: 'personnel_fatigue', params: { hours: 4, count: 1, people: [{ name: 'Müller Hans', hours: 5 }], more: 0 } }
    expect(parts(one, fr)).toMatchObject({ what: 'En service depuis plus de 4 h', who: 'Müller Hans (5 h)' })
  })

  it('resources, data quality, storage, the door', () => {
    expect(parts({ type: 'no_personnel', params: {} }, fr).what).toBe(
      'Plus de personnel disponible – toutes les personnes enregistrées sont attribuées',
    )
    expect(parts({ type: 'no_materials', params: { location: 'Depot', available: 0 } }).what).toBe('Keine Einheiten von «Depot» mehr verfügbar')
    expect(parts({ type: 'no_materials', params: { location: 'TLF', available: 1 } }).what).toBe('Nur noch 1 Einheit von «TLF» verfügbar')
    expect(parts({ type: 'no_materials', params: { location: 'TLF', available: 2 } }, fr).what).toBe(
      'Plus que 2 unités disponibles à « TLF »',
    )
    expect(parts({ type: 'missing_location', params: { title: 'Kellerbrand' } }, fr).what).toBe(
      'L’intervention « Kellerbrand » n’a pas de position géocodée',
    )
    // Numbers in the locale's own notation.
    expect(parts({ type: 'event_size_limit', params: { store: 'database', used_gb: 4.7, limit_gb: 4 } }).what).toBe(
      'Datenbank: 4,7 GB belegt – Limit von 4 GB überschritten',
    )
    expect(parts({ type: 'event_size_limit', params: { store: 'photos', used_gb: 5.2, limit_gb: 5 } }, fr).what).toBe(
      'Stockage photos : 5,2 Go occupés – limite de 5 Go dépassée',
    )
    expect(parts({ type: 'feld_code_rotated', params: { event: 'Sturm' } }, fr)).toEqual({
      what: 'Nouveau code terrain pour Sturm après trop de tentatives erronées', source: 'system',
    })
    for (const row of [
      { type: 'no_personnel', params: {} },
      { type: 'feld_code_rotated', params: { event: 'Sturm' } },
    ]) {
      expect(notificationDetail(parts(row))).toBeUndefined()
    }
  })
})

describe('notificationParts — the German sentence is the fallback', () => {
  it('a legacy row (no params) shows its sentence whole, in every locale', () => {
    const legacy = {
      type: 'field_message',
      params: null,
      message: 'Meldung vom Feld (Bendik Dimitri) – Bahnhofstrasse 1: Verstärkung nötig',
    }
    expect(parts(legacy, fr)).toEqual({ what: legacy.message, source: 'feld' })
    expect(parts({ type: 'personnel_fatigue', message: 'Müller Hans ist seit 5 Stunden im Einsatz' })).toEqual({
      what: 'Müller Hans ist seit 5 Stunden im Einsatz', source: 'system',
    })
  })

  it('an unknown type or variant, or params missing a fact the sentence needs, also falls back', () => {
    expect(parts({ type: 'something_new', params: { place: 'X' }, message: 'Etwas Neues' }, fr)).toEqual({
      what: 'Etwas Neues', source: 'system',
    })
    expect(parts({ type: 'training_emergency', params: { variant: 'meteor', title: 'X' }, message: 'Meteor' }, fr).what).toBe('Meteor')
    expect(parts({ type: 'field_arrived', params: { actor_kind: 'field' }, message: 'Angekommen: ?' }, fr).what).toBe('Angekommen: ?')
    expect(parts({ type: 'time_overdue', params: { variant: 'status', place: 'X' }, message: 'X: 5m' }, fr).what).toBe('X: 5m')
  })

  it('a status or danger this build does not know reads as its raw value, never as a key path', () => {
    // What the app's translator does with an unknown key: report it, answer with the key path.
    const lenient = createTranslator({ locale: 'de', messages: loadMessages('de'), onError: () => {} }) as unknown as NotificationTranslator
    expect(
      parts({ type: 'time_overdue', params: { variant: 'status', place: 'X', minutes: 5, status: 'parked' } }, lenient).what,
    ).toBe('5m im Status «parked»')
    expect(
      parts({ type: 'reko_submitted', params: { place: 'X', relevant: true, dangers: ['lava'] } }, lenient).what,
    ).toBe('Reko abgeschlossen – Einsatz relevant (Gefahren: lava)')
  })
})

describe('the dynamic keys the formatter reaches exist in every shipped locale', () => {
  // `kanban.columns.${status}` and `reko.reportSection.dangerBadges.${key}` are built at
  // runtime, so lib/i18n-keys-used.test.ts cannot see them — this is their coverage.
  const STATUSES = ['incoming', 'reko', 'reko_done', 'enroute', 'active', 'returning', 'complete']
  const DANGERS = ['fire', 'explosion', 'collapse', 'chemical', 'electrical', 'fire_danger'] // notification_params.DANGER_LABELS_DE

  it.each(['de', 'fr'] as const)('%s', (locale) => {
    const t = translator(locale)
    for (const status of STATUSES) expect(t(`kanban.columns.${status}`)).not.toContain('kanban.columns')
    for (const danger of DANGERS) expect(t(`reko.reportSection.dangerBadges.${danger}`)).not.toContain('dangerBadges')
  })

  it('Italian (an empty overlay) renders German rather than breaking', () => {
    const it_ = translator('it')
    expect(parts({ type: 'reko_arrived', params: { place: 'Mühlemattstrasse 18', by: null } }, it_).what).toBe('Reko vor Ort')
  })
})
