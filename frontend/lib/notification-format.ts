/**
 * How a notification reads: line 1 = what happened / what is asked, line 2 =
 * where · who. The source («vom Feld», «Reko», …) is not text — the glyph says
 * it, and screen readers get it as a prefix.
 *
 * «Meldung vom Feld (Bendik Dimitri) – Bahnhofstrasse 1, Coop Center:
 * Verstärkung nötig» was one bold block (owner, 02.10.2026): the one thing the
 * KP has to act on came last, behind the channel, the person and the address.
 * Now it reads «Verstärkung nötig» / «Bahnhofstrasse 1, Coop Center · Bendik
 * Dimitri».
 *
 * The backend sends one German sentence per notification (no structured
 * fields), written by a handful of known templates per type
 * (backend/app/crud/feld/reports.py, crud/feld/melden.py, crud/feld/rapport.py,
 * services/notification_service.py, api/training.py, services/training.py).
 * This takes those sentences apart again by type. Anything that does not match
 * its template — an older wording, a new one — comes back whole as `what`: the
 * worst case is the sentence as it was, never a lost word. The tests pin one
 * real sentence per template.
 */
import type { Notification, NotificationType } from '@/lib/types/notification'

/** Who or what the notification comes from — drawn as the leading glyph. */
export type NotificationSource = 'feld' | 'reko' | 'vehicle' | 'alarm' | 'time' | 'system'

export interface NotificationParts {
  /** Line 1: what happened / what is asked. */
  what: string
  /** Line 2, first half: the Schadenplatz. */
  where?: string
  /** Line 2, second half: the person (or «im KP erfasst», «automatisch (GPS)»). */
  who?: string
  source: NotificationSource
}

/** The two sentences the formatter has to write itself (everything else is the backend's own words). */
export interface NotificationFormatLabels {
  /** field_report: a new Schadenplatz from the field, e.g. «Neuer Schadenplatz». */
  fieldReport: string
  /** field_report when the crew took it on and is already driving there. */
  fieldReportDirect: string
}

const SOURCE_BY_TYPE: Partial<Record<NotificationType, NotificationSource>> = {
  field_message: 'feld',
  field_report: 'feld',
  field_arrived: 'feld',
  field_complete: 'feld',
  field_pickup: 'feld',
  rapport_submitted: 'feld',
  reko_arrived: 'reko',
  reko_submitted: 'reko',
  vehicle_arrived: 'vehicle',
  vehicle_returned: 'vehicle',
  time_overdue: 'time',
}

/** `training_emergency` is not in the frontend union, but the backend sends it. */
function sourceOf(type: string): NotificationSource {
  if (type === 'training_emergency') return 'alarm'
  return SOURCE_BY_TYPE[type as NotificationType] ?? 'system'
}

/** «Prefix: rest» at the first «: ». */
function splitPrefix(message: string): [string, string] | null {
  const at = message.indexOf(': ')
  if (at <= 0) return null
  return [message.slice(0, at), message.slice(at + 2)]
}

/** «rest · who» at the LAST « · » — the actor suffix every /feld notification ends with. */
function splitActor(rest: string): [string, string | undefined] {
  const at = rest.lastIndexOf(' · ')
  if (at <= 0) return [rest, undefined]
  return [rest.slice(0, at), rest.slice(at + 3)]
}

const clean = (parts: NotificationParts): NotificationParts => ({
  ...parts,
  what: parts.what.trim(),
  where: parts.where?.trim() || undefined,
  who: parts.who?.trim() || undefined,
})

export function notificationParts(
  notification: Pick<Notification, 'type' | 'message'>,
  labels: NotificationFormatLabels,
): NotificationParts {
  const { message } = notification
  const type = notification.type as string
  const source = sourceOf(type)
  const whole: NotificationParts = { what: message, source }

  switch (type) {
    // «Meldung vom Feld (Bendik Dimitri) – Bahnhofstrasse 1, Coop Center: Verstärkung nötig»
    // «Meldung vom Feld: Verstärkung nötig» (no person, no place)
    case 'field_message': {
      const full = /^Meldung vom Feld \((.+?)\) – (.+?): ([\s\S]+)$/.exec(message)
      if (full) return clean({ what: full[3], where: full[2], who: full[1], source })
      const bare = /^Meldung vom Feld: ([\s\S]+)$/.exec(message)
      if (bare) return clean({ what: bare[1], source })
      return whole
    }

    // «Meldung vom Feld: Hauptstrasse 41 (Fabio Wyss)»
    // «Meldung vom Feld – Trupp fährt direkt hin: Hauptstrasse 41 (Fabio Wyss)»
    case 'field_report': {
      const m = /^Meldung vom Feld( – Trupp fährt direkt hin)?: (.+) \(([^()]+)\)$/.exec(message)
      if (!m) return whole
      return clean({ what: m[1] ? labels.fieldReportDirect : labels.fieldReport, where: m[2], who: m[3], source })
    }

    // «Angekommen: Mühlemattstrasse 18 · Bendik Dimitri»
    // «Einsatz beendet gemeldet: …», «Abholung nötig: … (Notiz) · …», «Abholung erledigt: …»,
    // «Rapport erfasst: … · im KP erfasst»
    case 'field_arrived':
    case 'field_complete':
    case 'field_pickup':
    case 'rapport_submitted': {
      const split = splitPrefix(message)
      if (!split) return whole
      const [where, who] = splitActor(split[1])
      // the pickup's note («2 Personen beim Hintereingang») is part of what is asked
      const note = type === 'field_pickup' ? /^(.+) \(([^()]+)\)$/.exec(where) : null
      if (note) return clean({ what: `${split[0]} – ${note[2]}`, where: note[1], who, source })
      return clean({ what: split[0], where, who, source })
    }

    // «Reko vor Ort: Lisa Hoffmann bei Mühlemattstrasse 18» / «Reko vor Ort: Mühlemattstrasse 18»
    case 'reko_arrived': {
      const m = /^(Reko vor Ort): (?:(.+?) bei )?(.+)$/.exec(message)
      if (!m) return whole
      return clean({ what: m[1], where: m[3], who: m[2], source })
    }

    // «Reko abgeschlossen: Hauptstrasse 41 von Lisa Hoffmann – Einsatz relevant (3 Pers., ~2h)»
    case 'reko_submitted': {
      const m = /^(Reko abgeschlossen): (.+?)(?: von (.+?))? – (.+)$/.exec(message)
      if (!m) return whole
      return clean({ what: `${m[1]} – ${m[4]}`, where: m[2], who: m[3], source })
    }

    // «TLF vor Ort: Mühlemattstrasse 18»
    case 'vehicle_arrived': {
      const split = splitPrefix(message)
      if (!split) return whole
      return clean({ what: split[0], where: split[1], source })
    }

    // «Mühlemattstrasse 18: 56m im Status «Disponiert»» — the place comes FIRST here
    case 'time_overdue': {
      const split = splitPrefix(message)
      if (!split) return whole
      return clean({ what: split[1], where: split[0], source })
    }

    // «Lage verschärft: Wasser im Keller – Wasser steigt …»
    // «Fahrzeug TLF ausgefallen: Wasser im Keller – Ersatz disponieren»
    // «Neuer Übungs-Einsatz: Wasser im Keller (Bahnhofstrasse 1)»
    case 'training_emergency': {
      const split = splitPrefix(message)
      if (!split) return whole
      const [prefix, rest] = split
      const dash = rest.indexOf(' – ')
      if (dash > 0) return clean({ what: `${prefix} – ${rest.slice(dash + 3)}`, where: rest.slice(0, dash), source })
      return clean({ what: prefix, where: rest, source })
    }

    // «3 Personen seit über 4 h im Einsatz: Müller Hans (6 h), Meier Anna (5 h)» — one
    // notification for the whole crew; the names are the «who» line. Also the French
    // rebuild («… depuis plus de 4 h : …»), whose « : » splits the same way.
    case 'personnel_fatigue': {
      const split = splitPrefix(message)
      if (!split) return whole
      return clean({ what: split[0], who: split[1], source })
    }

    // vehicle_returned («TLF zurück im Magazin»), no_personnel, no_materials,
    // missing_location, event_size_limit, feld_code_rotated:
    // one sentence about no Schadenplatz — it stays one line.
    default:
      return whole
  }
}

/** Line 2: «where · who», or nothing. */
export function notificationDetail(parts: NotificationParts): string | undefined {
  const line = [parts.where, parts.who].filter(Boolean).join(' · ')
  return line || undefined
}

/** The backend's grouped time-on-duty sentence, taken apart (services/notification_service.py `fatigue_message`). */
export interface FatigueMessage {
  /** People past the threshold (all of them, not only the named ones). */
  count: number
  hours: number
  /** «Müller Hans (6 h)», longest on duty first. */
  names: string[]
  /** How many more the sentence did not name («und 2 weitere»). */
  more: number
}

const FATIGUE_RE = /^(?:(\d+) Personen seit|Seit) über (\d+) h im Einsatz: (.+?)(?: und (\d+) weitere)?$/

export function parseFatigueMessage(message: string): FatigueMessage | null {
  const m = FATIGUE_RE.exec(message)
  if (!m) return null
  return {
    count: m[1] ? Number(m[1]) : 1,
    hours: Number(m[2]),
    names: m[3].split(', '),
    more: m[4] ? Number(m[4]) : 0,
  }
}
