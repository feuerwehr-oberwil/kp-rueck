/**
 * A synthetic, deterministic «fat» Ereignis for measuring how KP Rück holds up as an operation
 * grows: larger (more Einsätze at once, more people and devices) and longer (more cards
 * piling up in «Abgeschlossen», more assignments, more audit rows). MEASUREMENT TOOLING ONLY:
 * the app never imports this. The browser measurement does (`tests/perf/fat-event.perf.ts`).
 *
 * ⚠️ Calibrated against what real users did, not guessed. This comes from a read-only look at
 * prod's audit_log on 2026-10-05, which logs every API request with its path and duration.
 * The busiest real session on record was 29.06.2026, 16–18 h:
 *   - 63 Einsätze in play in 2 h, 431 user actions on them, about 5 devices logged in
 *   - action mix: 121 incident updates, 33 status changes, 85/41 personnel assign/unassign,
 *     40/24 vehicle, 30/7 material, 33 Spezialfunktionen
 *   - write peak 113 requests in 10 min
 *   - every device polled the board at about 108 requests per minute
 *   - the roster was 67 people, 5 vehicles, 39 materials; at most 8 assignments on one Einsatz
 * So «×4» below means four times the busiest session we have seen, not four times a toy.
 *
 * Two knobs, because they grow different things:
 *   - `scale` grows what stands at once: roster, devices, writing desks and Einsätze per hour.
 *     This is neighbouring Feuerwehren joining an Unwetter day.
 *   - `hours` grows what piles up: the board keeps every completed card, so a long Ereignis
 *     loads more on every reload, and so does every device on every change.
 *
 * The action log is partitioned by writer (`writer`): each desk owns its own Einsätze and its
 * own share of the roster. That lets the desks write concurrently, as they do in a real KP,
 * without one desk's assign racing another's into a 409 that a real crew would never cause.
 */

export interface FatOptions {
  /** × the busiest real session's standing content (default 1) */
  scale?: number
  /** Ereignis duration in hours (default 2) */
  hours?: number
  /** RNG seed: same seed, same Ereignis (default 1) */
  seed?: number
}

/** The sizes worth measuring. `real` is the record to beat. The others are what a long night,
 *  an Unwetter day with neighbours, or a whole region's storm would plausibly add up to. */
export const FAT_PRESETS = {
  real: { scale: 1, hours: 2 },
  long: { scale: 1, hours: 12 },
  large: { scale: 4, hours: 4 },
  extreme: { scale: 10, hours: 8 },
} as const satisfies Record<string, FatOptions>
export type FatPreset = keyof typeof FAT_PRESETS

export type FatStatus = 'incoming' | 'reko' | 'reko_done' | 'enroute' | 'active' | 'returning' | 'complete'
export type FatResource = 'personnel' | 'vehicle' | 'material'

/** One user action, as the board sends it. Indices are logical; the player maps them to ids. */
export type FatAction = { at: number; writer: number } & (
  | { kind: 'checkIn'; person: number }
  | { kind: 'create'; incident: number; title: string; type: string; priority: 'low' | 'medium' | 'high'; lat: number; lng: number }
  | { kind: 'status'; incident: number; from: FatStatus; to: FatStatus }
  | { kind: 'update'; incident: number; patch: Record<string, string> }
  /** `slot` names this assignment so a later `unassign` can find the id the server gave it */
  | { kind: 'assign'; incident: number; resource: FatResource; index: number; slot: number }
  | { kind: 'unassign'; incident: number; slot: number }
  | { kind: 'specialFunction'; person: number; fn: 'reko' | 'magazin' }
)

export interface FatEvent {
  options: Required<FatOptions>
  roster: { personnel: number; vehicles: number; materials: number }
  /** devices with the board open (they poll and reload, most of them never write) */
  devices: number
  /** desks that write concurrently */
  writers: number
  incidents: number
  /** by `at`, then by writer: what the crew did, in order */
  actions: FatAction[]
  /** Einsätze not yet complete when the Ereignis ends: what is standing on the board */
  open: number
}

// --- calibration (per ×1 unless noted) -----------------------------------------------------------

const ROSTER = { personnel: 67, vehicles: 5, materials: 39 }
/** distinct users in the busiest session; four of them wrote */
const DEVICES = 5
const WRITERS = 4
/** checked in at the start: the biggest Anwesenheit on record was 30 */
const PRESENT = 30
/** 63 Einsätze in 2 h */
const INCIDENTS_PER_HOUR = 31.5
/** per Einsatz, from the 29.06. mix (÷ 63) */
const PER_INCIDENT = {
  personnelAssign: 85 / 63,
  personnelUnassign: 41 / 63,
  vehicleAssign: 40 / 63,
  vehicleUnassign: 24 / 63,
  materialAssign: 30 / 63,
  materialUnassign: 7 / 63,
  /** 121 updates + 33 status changes: most «updates» on record were status moves too */
  statusAndUpdates: 154 / 63,
  specialFunctions: 33 / 63,
}
/** share of the cards left unfinished whose crew the KP takes back by hand (tuned to the unassigns) */
const STALLED_RELEASE = 0.45
/** at most 8 assignments on one Einsatz */
const MAX_ASSIGNMENTS = 8

const TYPES = ['brandbekaempfung', 'elementarereignis', 'strassenrettung', 'technische_hilfeleistung', 'oelwehr', 'diverse_einsaetze']
/** Oberwil BL, the seed's home; an Unwetter spreads over the Leimental */
const CENTER: [number, number] = [7.5567, 47.4989]
const STREETS = ['Hauptstrasse', 'Mühlemattstrasse', 'Bahnhofstrasse', 'Langegasse', 'Bielstrasse', 'Therwilerstrasse', 'Allschwilerweg', 'Bruderholzstrasse', 'Mühlegasse', 'Lindenstrasse']

/** mulberry32: small, fast, deterministic */
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Draw a count with mean `m`: floor plus a Bernoulli on the fraction, so totals track the mean. */
const count = (r: () => number, m: number) => Math.floor(m) + (r() < m - Math.floor(m) ? 1 : 0)

export function fatEvent(opts: FatOptions = {}): FatEvent {
  const options = { scale: 1, hours: 2, seed: 1, ...opts }
  const { scale, hours, seed } = options
  const r = rng(seed)
  const roster = {
    personnel: Math.round(ROSTER.personnel * scale),
    vehicles: Math.round(ROSTER.vehicles * scale),
    materials: Math.round(ROSTER.materials * scale),
  }
  const writers = Math.max(1, Math.round(WRITERS * scale))
  const devices = Math.max(writers, Math.round(DEVICES * scale))
  const durationMs = hours * 3_600_000
  const incidents = Math.round(INCIDENTS_PER_HOUR * scale * hours)

  // A desk owns every resource whose index is ≡ writer (mod writers) and every Einsatz likewise.
  const owned = (n: number, w: number) => Array.from({ length: n }, (_, i) => i).filter((i) => i % writers === w)
  const actions: FatAction[] = []
  let open = 0

  // The Anwesenheit fills in the first minutes, before anything is assigned.
  const present = Math.min(roster.personnel, Math.round(PRESENT * scale))
  for (let p = 0; p < present; p++) actions.push({ at: Math.floor(r() * 10 * 60_000), writer: p % writers, kind: 'checkIn', person: p })

  for (let w = 0; w < writers; w++) {
    // 1. Plan every Einsatz on its own: what happens to it and when, with no resources picked.
    type Step =
      | { t: number; i: number; op: 'create'; a: Extract<FatAction, { kind: 'create' }> }
      | { t: number; i: number; op: 'status'; from: FatStatus; to: FatStatus }
      | { t: number; i: number; op: 'update'; patch: Record<string, string> }
      | { t: number; i: number; op: 'assign' | 'unassign'; res: FatResource }
      | { t: number; i: number; op: 'specialFunction'; fn: 'reko' | 'magazin' }
    const plan: Step[] = []
    for (const i of owned(incidents, w)) {
      // arrivals cluster early, as a storm cell does: the power bends the uniform toward 0
      let t = Math.floor(Math.pow(r(), 1.4) * durationMs * 0.95)
      // 1–6 min between one card's actions: on record, people came back to the pool within the hour
      const step = () => (t += Math.floor((1 + r() * 5) * 60_000))
      const street = STREETS[Math.floor(r() * STREETS.length)]
      plan.push({
        t, i, op: 'create',
        a: {
          at: 0, writer: w, kind: 'create', incident: i,
          title: `${street} ${1 + Math.floor(r() * 120)}`,
          type: TYPES[Math.floor(r() * TYPES.length)],
          priority: r() < 0.15 ? 'high' : r() < 0.5 ? 'medium' : 'low',
          lng: CENTER[0] + (r() - 0.5) * 0.08 * Math.sqrt(scale),
          lat: CENTER[1] + (r() - 0.5) * 0.05 * Math.sqrt(scale),
        },
      })
      // dispatch: crew, maybe a vehicle, maybe material, maybe a Reko/Magazin function
      for (let k = count(r, PER_INCIDENT.personnelAssign); k > 0; k--) plan.push({ t: step(), i, op: 'assign', res: 'personnel' })
      // a vehicle drops its crew and comes back for the next job: on record it was the most
      // cycled resource (40 assigns, 24 releases on 5 vehicles in 2 h)
      if (r() < PER_INCIDENT.vehicleAssign) {
        plan.push({ t: step(), i, op: 'assign', res: 'vehicle' })
        if (r() < PER_INCIDENT.vehicleUnassign / PER_INCIDENT.vehicleAssign) plan.push({ t: step(), i, op: 'unassign', res: 'vehicle' })
      }
      if (r() < PER_INCIDENT.materialAssign) plan.push({ t: step(), i, op: 'assign', res: 'material' })
      if (r() < PER_INCIDENT.specialFunctions) plan.push({ t: step(), i, op: 'specialFunction', fn: r() < 0.8 ? 'reko' : 'magazin' })

      // the card's path through the columns; one not finished when the Ereignis ends just
      // stays where it got to, the way a real exercise leaves its board
      const path: FatStatus[] = r() < 0.3 ? ['incoming', 'reko', 'reko_done', 'enroute', 'active', 'returning', 'complete'] : ['incoming', 'enroute', 'active', 'returning', 'complete']
      let at = 0
      for (let m = count(r, PER_INCIDENT.statusAndUpdates); m > 0; m--) {
        // a few of the moves are edits to the card, not to its column
        if (r() < 0.2 || at >= path.length - 2) {
          plan.push({ t: step(), i, op: 'update', patch: r() < 0.5 ? { description: `Lage: ${street}, Wasser im Keller (${m})` } : { internal_notes: `Rückmeldung ${m}` } })
          continue
        }
        plan.push({ t: step(), i, op: 'status', from: path[at], to: path[at + 1] })
        at++
        // once it is running, the KP takes back the people and material no longer needed
        if (path[at] === 'active') {
          if (r() < PER_INCIDENT.personnelUnassign) plan.push({ t: step(), i, op: 'unassign', res: 'personnel' })
          if (r() < PER_INCIDENT.materialUnassign / PER_INCIDENT.materialAssign) plan.push({ t: step(), i, op: 'unassign', res: 'material' })
        }
      }
      // a card that reached «returning» gets closed; the backend then releases its crew itself
      if (path[at] === 'returning') plan.push({ t: step(), i, op: 'status', from: 'returning', to: 'complete' })
      // most cards on record never got that far (33 status changes for 63 Einsätze) and the KP
      // took the crew back by hand instead: that is where most of the 72 unassigns came from
      else if (r() < STALLED_RELEASE) for (const res of ['personnel', 'personnel', 'personnel', 'vehicle', 'material'] as const) plan.push({ t: step(), i, op: 'unassign', res })
    }

    // 2. Play the plan in time order, so a person freed by one Einsatz is only picked up by the
    //    next one AFTER the release: the log never asks the server for a double assignment.
    plan.sort((a, b) => a.t - b.t || a.i - b.i)
    const free: Record<FatResource, Set<number>> = {
      // anyone on the roster, not only the checked-in: the board assigns without a check-in
      personnel: new Set(owned(roster.personnel, w)),
      vehicle: new Set(owned(roster.vehicles, w)),
      material: new Set(owned(roster.materials, w)),
    }
    const held = new Map<number, { slot: number; res: FatResource; index: number }[]>()
    const done = new Set<number>()
    // a person carries each Spezialfunktion once per Ereignis
    const functions = new Set<string>()
    let slot = 0
    for (const s of plan) {
      if (s.t >= durationMs) break
      const mine = held.get(s.i) ?? []
      held.set(s.i, mine)
      const at = s.t
      if (s.op === 'create') actions.push({ ...s.a, at })
      else if (s.op === 'status') {
        actions.push({ at, writer: w, kind: 'status', incident: s.i, from: s.from, to: s.to })
        if (s.to === 'complete') { for (const a of mine) free[a.res].add(a.index); mine.length = 0; done.add(s.i) }
      } else if (s.op === 'update') actions.push({ at, writer: w, kind: 'update', incident: s.i, patch: s.patch })
      else if (s.op === 'assign') {
        const pool = [...free[s.res]]
        if (!pool.length || mine.length >= MAX_ASSIGNMENTS) continue
        const index = pool[Math.floor(r() * pool.length)]
        free[s.res].delete(index)
        mine.push({ slot, res: s.res, index })
        actions.push({ at, writer: w, kind: 'assign', incident: s.i, resource: s.res, index, slot: slot++ })
      } else if (s.op === 'unassign') {
        const k = mine.findIndex((a) => a.res === s.res)
        if (k < 0) continue
        const [a] = mine.splice(k, 1)
        free[a.res].add(a.index)
        actions.push({ at, writer: w, kind: 'unassign', incident: s.i, slot: a.slot })
      } else if (s.op === 'specialFunction') {
        const fn = s.fn
        const person = mine.find((a) => a.res === 'personnel' && !functions.has(`${a.index}:${fn}`))
        if (!person) continue
        functions.add(`${person.index}:${fn}`)
        actions.push({ at, writer: w, kind: 'specialFunction', person: person.index, fn })
      }
    }
    open += owned(incidents, w).filter((i) => held.has(i) && !done.has(i)).length
  }

  actions.sort((a, b) => a.at - b.at || a.writer - b.writer)
  return { options, roster, devices, writers, incidents, actions, open }
}

/** Action counts by kind (and resource), for the report and the calibration test. */
export function actionMix(actions: FatAction[]) {
  const mix: Record<string, number> = {}
  for (const a of actions) {
    const k = a.kind === 'assign' ? `assign ${a.resource}` : a.kind
    mix[k] = (mix[k] ?? 0) + 1
  }
  return mix
}
