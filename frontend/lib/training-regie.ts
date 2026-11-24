import type { ApiAutogenState, ApiRegieIncident, ApiRegieState, ApiRegieStep } from '@/lib/api/types'
import type { Operation } from '@/lib/contexts/operations-context'

// ── Übungs-Steuerung «Regie»: what the page derives from the server's state ──────────────
// The server owns the field lifecycle and every due time (GET /api/training/events/{id}/regie).
// This module only orders, counts down and picks – pure functions, so the page stays a view.

/** One row of «Als Nächstes» / «Danach»: a field step or the Automatik's next alarm. */
export type RegieTimelineEntry =
  | { kind: 'step'; dueAt: number; step: ApiRegieStep; incident: ApiRegieIncident }
  | { kind: 'automatik'; dueAt: number }

/**
 * The timeline: every step that has a due time, and the Automatik's next alarm, earliest
 * first. Only an incident's primary step is scheduled; the others, a held or Mitspieler
 * incident, a rolling drive and a return without Magazin have no due time and are not on it.
 */
export function regieTimeline(state: Pick<ApiRegieState, 'incidents' | 'automatik_next_at'>): RegieTimelineEntry[] {
  const entries: RegieTimelineEntry[] = state.incidents.flatMap((incident) =>
    incident.steps.flatMap((step) =>
      step.due_at ? [{ kind: 'step' as const, dueAt: Date.parse(step.due_at), step, incident }] : [],
    ),
  )
  if (state.automatik_next_at) entries.push({ kind: 'automatik', dueAt: Date.parse(state.automatik_next_at) })
  return entries.sort((a, b) => a.dueAt - b.dueAt)
}

/**
 * The instant the countdowns read. While paused the server answers every `due_at` as «due if
 * ▶ were pressed now», so the countdown stands at `due_at − receivedAt` (when that answer came)
 * until the next answer – it does not run down.
 */
export function regieClock(state: Pick<ApiRegieState, 'paused_at'>, now: number, receivedAt: number): number {
  return state.paused_at ? receivedAt : now
}

/** «0:42», «12:05», «1:02:10» – a running clock, not a duration (those go through lib/duration). */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = String(total % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

export type CountdownTranslator = (key: 'in' | 'due', values?: { time: string }) => string

/** «in 0:40» until the step is due, then «fällig» (the Autopilot runs it within seconds). */
export function countdownText(dueAt: number, clock: number, t: CountdownTranslator): string {
  const left = dueAt - clock
  return left >= 1000 ? t('in', { time: formatClock(left) }) : t('due')
}

/** Where the Automatik stands for THIS Übung. A run-less switch (from before runs were
 *  recorded) feeds the newest Übung – shown as on. */
export function automatikStatus(automatik: ApiAutogenState, eventId: string): 'on' | 'elsewhere' | 'stoppedAtMax' | 'off' {
  const here = automatik.run === null || automatik.run.event_id === eventId
  if (automatik.enabled) return here ? 'on' : 'elsewhere'
  return automatik.run?.event_id === eventId && automatik.run.stopped === 'max' ? 'stoppedAtMax' : 'off'
}

/** «Vorbereiten» is open for a fresh Übung and folded once Autopilot or Automatik runs. */
export function prepareOpenByDefault(state: Pick<ApiRegieState, 'autopilot' | 'automatik' | 'event_id'>): boolean {
  return !state.autopilot && automatikStatus(state.automatik, state.event_id) !== 'on'
}

/** The injects of «Störung einspielen» that hit one incident. */
export type RegieInject = 'escalate' | 'reinforcement' | 'breakdown' | 'pickup' | 'fieldMessage' | 'fieldReport'

/** What an inject's fit is decided on – an `Operation` has it all. */
type InjectFacts = Pick<Operation, 'status' | 'priority' | 'crew' | 'vehicles' | 'pickupNeeded'>

const open = (op: InjectFacts) => op.status !== 'complete'
const crewed = (op: InjectFacts) => open(op) && op.crew.length > 0

/** Which incidents an inject fits: the one a real Lage could produce it on. */
const FITS: Record<RegieInject, (op: InjectFacts) => boolean> = {
  escalate: (op) => open(op) && op.priority !== 'high',
  reinforcement: crewed,
  breakdown: (op) => open(op) && op.vehicles.length > 0,
  pickup: (op) => crewed(op) && !op.pickupNeeded && (op.status === 'active' || op.status === 'returning'),
  fieldMessage: crewed,
  fieldReport: crewed,
}

/** The incidents an inject can hit, in board order. */
export function injectCandidates<T extends InjectFacts>(inject: RegieInject, operations: readonly T[]): T[] {
  return operations.filter((op) => FITS[inject](op))
}

/** Target «zufällig»: one fitting open incident, or null when none fits. */
export function pickInjectTarget<T extends InjectFacts>(
  inject: RegieInject,
  operations: readonly T[],
  random: () => number = Math.random,
): T | null {
  const candidates = injectCandidates(inject, operations)
  return candidates.length === 0 ? null : candidates[Math.floor(random() * candidates.length)]
}
