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
 * The backend sends every notification as `type` + `params` — the facts it is
 * made of (place, person, minutes, …), one shape per type, listed in
 * backend/app/services/notification_params.py — and this file says them in the
 * operator's language (`notifications.messages.*` in messages/<locale>.json).
 * The German `message` beside them is the fallback: a row from before `params`
 * existed, a type or variant this client does not know, or params missing a
 * fact the sentence needs all come back as that sentence, whole, on one line.
 * Worst case is the German sentence as it always was — never a lost word, and
 * never a sentence guessed back out of prose.
 */
import { formatDuration } from '@/lib/duration'
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

/**
 * A translator for the ROOT namespace (`useTranslations()` / next-intl's
 * `createTranslator`). Root, because besides `notifications.messages` the
 * sentences borrow the board's column titles (`kanban.columns`) and the Reko
 * danger labels (`reko.reportSection.dangerBadges`).
 */
export type NotificationTranslator = (key: string, values?: Record<string, string | number>) => string

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
  training_emergency: 'alarm',
}

function sourceOf(type: string): NotificationSource {
  return SOURCE_BY_TYPE[type as NotificationType] ?? 'system'
}

/** Thrown inside the builders when a fact the sentence needs is absent — caught as «use the German sentence». */
class MissingParam extends Error {}

type Params = Record<string, unknown>

/** A required string fact. */
function str(params: Params, key: string): string {
  const value = params[key]
  if (typeof value !== 'string' || value === '') throw new MissingParam(key)
  return value
}

/** An optional string fact. */
function optStr(params: Params, key: string): string | undefined {
  const value = params[key]
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** A required number fact. */
function num(params: Params, key: string): number {
  const value = params[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new MissingParam(key)
  return value
}

const M = 'notifications.messages'

/** The person behind a /feld notification: their name, or how it was recorded. */
function actorLabel(params: Params, t: NotificationTranslator): string | undefined {
  const name = optStr(params, 'actor_name')
  switch (params.actor_kind) {
    case 'field':
      return name ?? t(`${M}.actorField`)
    case 'kp':
      return t(`${M}.actorKp`)
    case 'gps':
      return t(`${M}.actorGps`)
    default:
      return name
  }
}

/**
 * A label looked up by a key that came over the wire (a status, a danger flag).
 * next-intl answers an unknown key with the key path itself; a status this client
 * does not know yet reads better as its raw value than as «kanban.columns.x».
 */
function label(t: NotificationTranslator, key: string, raw: string): string {
  const out = t(key)
  return out === key || out.endsWith(`.${raw}`) ? raw : out
}

/** «Angekommen» / «Angekommen – Karte in «Im Einsatz» verschoben». */
function withMove(what: string, params: Params, t: NotificationTranslator): string {
  const movedTo = optStr(params, 'moved_to')
  if (!movedTo) return what
  return t(`${M}.movedTo`, { what, column: label(t, `kanban.columns.${movedTo}`, movedTo) })
}

type Built = Omit<NotificationParts, 'source'>

/** One builder per type. `undefined` = this type/variant is not known here → the German sentence. */
function build(type: string, p: Params, t: NotificationTranslator): Built | undefined {
  switch (type) {
    case 'field_message':
      // The crew's own words are the point.
      return { what: str(p, 'text'), where: optStr(p, 'place'), who: actorLabel(p, t) }

    case 'field_report':
      return {
        what: t(p.direct === true ? `${M}.fieldReportDirect` : `${M}.fieldReport`),
        where: str(p, 'place'),
        who: optStr(p, 'by'),
      }

    case 'field_arrived':
      return { what: withMove(t(`${M}.fieldArrived`), p, t), where: str(p, 'place'), who: actorLabel(p, t) }

    case 'field_complete':
      return { what: withMove(t(`${M}.fieldComplete`), p, t), where: str(p, 'place'), who: actorLabel(p, t) }

    case 'field_pickup': {
      const note = optStr(p, 'note')
      const what =
        p.needed === false
          ? t(`${M}.pickupDone`)
          : note
            ? t(`${M}.pickupNeededNote`, { note })
            : t(`${M}.pickupNeeded`)
      return { what, where: str(p, 'place'), who: actorLabel(p, t) }
    }

    case 'rapport_submitted':
      return { what: t(`${M}.rapportSubmitted`), where: str(p, 'place'), who: actorLabel(p, t) }

    case 'reko_arrived':
      return { what: t(`${M}.rekoArrived`), where: str(p, 'place'), who: optStr(p, 'by') }

    case 'reko_submitted': {
      const verdict = t(p.relevant === false ? `${M}.rekoNotRelevant` : `${M}.rekoRelevant`)
      const details: string[] = []
      if (typeof p.personnel_count === 'number' && p.personnel_count > 0) {
        details.push(t(`${M}.rekoPersonnel`, { count: p.personnel_count }))
      }
      if (typeof p.duration_hours === 'number' && p.duration_hours > 0) {
        details.push(t(`${M}.rekoDuration`, { hours: p.duration_hours }))
      }
      const dangers = Array.isArray(p.dangers) ? p.dangers.filter((d): d is string => typeof d === 'string') : []
      if (dangers.length > 0) {
        details.push(
          t(`${M}.rekoDangers`, { list: dangers.map((d) => label(t, `reko.reportSection.dangerBadges.${d}`, d)).join(', ') }),
        )
      }
      return {
        what: details.length > 0 ? `${verdict} (${details.join(', ')})` : verdict,
        where: str(p, 'place'),
        who: optStr(p, 'by'),
      }
    }

    case 'vehicle_arrived':
    case 'vehicle_returned':
      if (p.variant === 'on_site') {
        return { what: t(`${M}.vehicleOnSite`, { vehicle: str(p, 'vehicle') }), where: str(p, 'place') }
      }
      if (p.variant === 'returned') return { what: t(`${M}.vehicleReturned`, { vehicle: str(p, 'vehicle') }) }
      return undefined

    case 'time_overdue': {
      const duration = formatDuration(num(p, 'minutes') * 60_000, 'clock')
      if (p.variant === 'status') {
        return {
          what: t(`${M}.timeInStatus`, { duration, status: label(t, `kanban.columns.${str(p, 'status')}`, str(p, 'status')) }),
          where: str(p, 'place'),
        }
      }
      if (p.variant === 'not_archived') return { what: t(`${M}.timeNotArchived`, { duration }), where: str(p, 'place') }
      return undefined
    }

    case 'training_emergency': {
      const title = str(p, 'title')
      switch (p.variant) {
        case 'new': {
          const address = optStr(p, 'address')
          return { what: t(`${M}.trainingNew`), where: address ? `${title} (${address})` : title }
        }
        case 'escalation':
          return { what: t(`${M}.trainingEscalation`, { text: str(p, 'text') }), where: title }
        case 'reinforcement':
          return { what: t(`${M}.trainingReinforcement`, { text: str(p, 'text') }), where: title }
        case 'vehicle_down':
          return { what: t(`${M}.trainingVehicleDown`, { vehicle: str(p, 'vehicle') }), where: title }
        default:
          return undefined
      }
    }

    // Crew past the time-on-duty threshold: one row for everybody, the names as «who».
    case 'personnel_fatigue': {
      const hours = num(p, 'hours')
      const count = num(p, 'count')
      const people = Array.isArray(p.people) ? p.people : []
      const names = people
        .map((person) => {
          const entry = (person ?? {}) as Params
          return t(`${M}.fatiguePerson`, { name: str(entry, 'name'), hours: num(entry, 'hours') })
        })
        .join(', ')
      const more = typeof p.more === 'number' ? p.more : 0
      return {
        what: count === 1 ? t(`${M}.fatigueOne`, { hours }) : t(`${M}.fatigueMany`, { count, hours }),
        who: more > 0 ? t(`${M}.fatigueMore`, { names, count: more }) : names || undefined,
      }
    }

    // The rest is one sentence about no Schadenplatz — it stays one line.
    case 'no_personnel':
      return { what: t(`${M}.noPersonnel`) }

    case 'no_materials': {
      const location = str(p, 'location')
      const available = num(p, 'available')
      return {
        what: available === 0 ? t(`${M}.materialsNone`, { location }) : t(`${M}.materialsLow`, { location, count: available }),
      }
    }

    case 'missing_location':
      return { what: t(`${M}.missingLocation`, { title: str(p, 'title') }) }

    case 'event_size_limit': {
      const values = { used: num(p, 'used_gb'), limit: num(p, 'limit_gb') }
      if (p.store === 'database') return { what: t(`${M}.storageDatabase`, values) }
      if (p.store === 'photos') return { what: t(`${M}.storagePhotos`, values) }
      return undefined
    }

    case 'feld_code_rotated':
      return { what: t(`${M}.feldCodeRotated`, { event: str(p, 'event') }) }

    default:
      return undefined
  }
}

const clean = (parts: NotificationParts): NotificationParts => ({
  ...parts,
  what: parts.what.trim(),
  where: parts.where?.trim() || undefined,
  who: parts.who?.trim() || undefined,
})

export function notificationParts(
  notification: Pick<Notification, 'type' | 'message' | 'params'>,
  t: NotificationTranslator,
): NotificationParts {
  const type = notification.type as string
  const source = sourceOf(type)
  const whole: NotificationParts = { what: notification.message, source }
  const { params } = notification
  if (!params || typeof params !== 'object') return whole
  try {
    const built = build(type, params, t)
    return built ? clean({ ...built, source }) : whole
  } catch (error) {
    if (error instanceof MissingParam) return whole
    throw error
  }
}

/** Line 2: «where · who», or nothing. */
export function notificationDetail(parts: NotificationParts): string | undefined {
  const line = [parts.where, parts.who].filter(Boolean).join(' · ')
  return line || undefined
}
