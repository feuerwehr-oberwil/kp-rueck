import { describe, expect, it } from 'vitest'

import type { ApiAutogenState, ApiRegieIncident, ApiRegieStep } from '@/lib/api/types'
import { assignedVehicle, crewMember } from '@/test-utils/operation-fixtures'
import {
  countdownText,
  formatClock,
  pickInjectTarget,
  prepareOpenByDefault,
  regieClock,
  regieTimeline,
} from './training-regie'

const step = (incident_id: string, key: ApiRegieStep['key'], due_at: string | null): ApiRegieStep => ({
  incident_id,
  key,
  due_at,
  rolling: false,
  progress: null,
  eta_seconds: null,
})
const incident = (id: string, steps: ApiRegieStep[], held = false): ApiRegieIncident => ({
  incident_id: id,
  held,
  mitspieler: false,
  steps,
})

describe('regieTimeline', () => {
  it('orders every due step and the Automatik by due time, and leaves out steps without one', () => {
    const entries = regieTimeline({
      incidents: [
        incident('a', [step('a', 'field_complete', '2026-11-24T20:04:50Z'), step('a', 'drive_to_magazin', '2026-11-24T20:01:30Z')]),
        incident('b', [step('b', 'reko_arrived', null)], true),
        incident('c', [step('c', 'reko_arrived', '2026-11-24T20:00:40Z')]),
      ],
      automatik_next_at: '2026-11-24T20:02:10Z',
    })
    expect(entries.map((e) => (e.kind === 'step' ? `${e.incident.incident_id}:${e.step.key}` : 'automatik'))).toEqual([
      'c:reko_arrived',
      'a:drive_to_magazin',
      'automatik',
      'a:field_complete',
    ])
  })

  it('has no Automatik row while it raises no alarm', () => {
    expect(regieTimeline({ incidents: [], automatik_next_at: null })).toEqual([])
  })
})

describe('the countdown', () => {
  const t = (key: 'in' | 'due', values?: { time: string }) => (key === 'in' ? `in ${values?.time}` : 'fällig')
  const due = Date.parse('2026-11-24T20:01:00Z')

  it('counts m:ss down to the due time, then says «fällig»', () => {
    expect(countdownText(due, due - 40_000, t)).toBe('in 0:40')
    expect(countdownText(due, due - 61_500, t)).toBe('in 1:01')
    expect(countdownText(due, due - 400, t)).toBe('fällig')
    expect(countdownText(due, due + 5_000, t)).toBe('fällig')
  })

  it('stands still while paused, at what the server answered', () => {
    // Paused: `due_at` = due if ▶ were pressed when the answer came (20:00:20).
    const receivedAt = Date.parse('2026-11-24T20:00:20Z')
    const later = Date.parse('2026-11-24T20:30:00Z')
    expect(countdownText(due, regieClock({ paused_at: '2026-11-24T19:58:00Z' }, later, receivedAt), t)).toBe('in 0:40')
    expect(countdownText(due, regieClock({ paused_at: null }, due - 10_000, receivedAt), t)).toBe('in 0:10')
  })

  it('formats hours once a drill runs past one', () => {
    expect(formatClock(42_000)).toBe('0:42')
    expect(formatClock(3_730_000)).toBe('1:02:10')
  })
})

describe('«Vorbereiten» folding', () => {
  const automatik = (enabled: boolean, event_id = 'e1'): ApiAutogenState => ({
    enabled,
    run: { event_id, started_at: '2026-11-24T19:00:00Z', stopped: null },
  })

  it('is open for a fresh Übung', () => {
    expect(prepareOpenByDefault({ event_id: 'e1', autopilot: false, automatik: { enabled: false, run: null } })).toBe(true)
  })

  it('folds once the Autopilot or the Automatik runs for this Übung', () => {
    expect(prepareOpenByDefault({ event_id: 'e1', autopilot: true, automatik: automatik(false) })).toBe(false)
    expect(prepareOpenByDefault({ event_id: 'e1', autopilot: false, automatik: automatik(true) })).toBe(false)
  })

  it('stays open while the Automatik feeds another Übung', () => {
    expect(prepareOpenByDefault({ event_id: 'e1', autopilot: false, automatik: automatik(true, 'e2') })).toBe(true)
  })
})

describe('Störung target «zufällig»', () => {
  const op = (id: string, facts: Partial<Parameters<typeof pickInjectTarget>[1][number]> = {}) => ({
    id,
    status: 'active' as const,
    priority: 'medium' as const,
    crew: [crewMember(`Muster ${id}`)],
    vehicles: [assignedVehicle(`TLF ${id}`)],
    pickupNeeded: false,
    ...facts,
  })

  it('picks only an open incident the inject fits', () => {
    const board = [
      op('closed', { status: 'complete' }),
      op('high', { priority: 'high' }),
      op('fits'),
    ]
    expect(pickInjectTarget('escalate', board, () => 0)?.id).toBe('fits')
    expect(pickInjectTarget('escalate', board, () => 0.99)?.id).toBe('fits')
  })

  it('needs a crew for a Meldung, a vehicle for a Fahrzeugausfall', () => {
    const board = [op('bare', { crew: [], vehicles: [] }), op('crew', { vehicles: [] })]
    expect(pickInjectTarget('fieldReport', board, () => 0)?.id).toBe('crew')
    expect(pickInjectTarget('breakdown', board, () => 0)).toBeNull()
  })

  it('strands only a crew on scene that is not stranded already', () => {
    const board = [op('enroute', { status: 'enroute' }), op('waiting', { pickupNeeded: true }), op('scene')]
    expect(pickInjectTarget('pickup', board, () => 0)?.id).toBe('scene')
  })

  it('spreads over every fitting incident', () => {
    const board = [op('a'), op('b'), op('c')]
    expect(pickInjectTarget('reinforcement', board, () => 0.5)?.id).toBe('b')
  })
})
