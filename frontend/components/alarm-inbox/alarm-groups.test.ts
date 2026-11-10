import { describe, expect, it } from 'vitest'

import type { ApiDiveraEmergency } from '@/lib/api-client'
import { countNewAlarms, groupAlarms, NEW_WINDOW_MS, nextNewExpiry } from './alarm-groups'

const NOW = Date.parse('2026-11-08T19:30:00Z')
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString()

const alarm = (id: string, overrides: Partial<ApiDiveraEmergency> = {}): ApiDiveraEmergency => ({
  id,
  source: 'elz',
  source_id: null,
  divera_id: null,
  divera_number: null,
  title: id,
  text: null,
  address: null,
  latitude: null,
  longitude: null,
  received_at: ago(5),
  attached_to_event_id: null,
  attached_at: null,
  created_incident_id: null,
  is_archived: false,
  ...overrides,
})

describe('groupAlarms', () => {
  it('splits new, attached today and the rest, keeping the order', () => {
    const list = [
      alarm('new-1'),
      alarm('attached', { attached_to_event_id: 'ev', attached_at: ago(3) }),
      alarm('new-2', { received_at: ago(60 * 23) }),
      alarm('attached-yesterday', { attached_to_event_id: 'ev', attached_at: ago(60 * 25), received_at: ago(60 * 26) }),
      alarm('archived', { is_archived: true }),
      alarm('never-attached', { received_at: ago(60 * 24 * 17) }),
    ]
    const groups = groupAlarms(list, NOW)
    expect(groups.fresh.map((e) => e.id)).toEqual(['new-1', 'new-2'])
    expect(groups.today.map((e) => e.id)).toEqual(['attached'])
    expect(groups.earlier.map((e) => e.id)).toEqual(['attached-yesterday', 'archived', 'never-attached'])
    expect(countNewAlarms(list, NOW)).toBe(2)
  })

  it('«Heute zugewiesen» starts at local midnight, not 24 hours back', () => {
    const now = new Date(2026, 10, 9, 0, 30).getTime()
    const list = [
      alarm('after-midnight', { attached_to_event_id: 'ev', attached_at: new Date(2026, 10, 9, 0, 1).toISOString() }),
      alarm('before-midnight', { attached_to_event_id: 'ev', attached_at: new Date(2026, 10, 8, 23, 59).toISOString() }),
      // still waiting from before midnight: «Neu» is a rolling 24 hours
      alarm('waiting', { received_at: new Date(2026, 10, 8, 23, 50).toISOString() }),
    ]
    const groups = groupAlarms(list, now)
    expect(groups.today.map((e) => e.id)).toEqual(['after-midnight'])
    expect(groups.earlier.map((e) => e.id)).toEqual(['before-midnight'])
    expect(groups.fresh.map((e) => e.id)).toEqual(['waiting'])
  })

  it('reads the receipt time for an attached row without an attach time', () => {
    const row = alarm('legacy', { attached_to_event_id: 'ev', received_at: ago(30) })
    expect(groupAlarms([row], NOW).today).toEqual([row])
  })

  it('still counts an alarm stamped a little in the future (clock skew) as new', () => {
    expect(countNewAlarms([alarm('skew', { received_at: new Date(NOW + 30_000).toISOString() })], NOW)).toBe(1)
  })
})

describe('nextNewExpiry', () => {
  it('is when the oldest new alarm turns 24 hours old', () => {
    const list = [
      alarm('newer', { received_at: ago(10) }),
      alarm('older', { received_at: ago(60) }),
      alarm('attached', { received_at: ago(600), attached_to_event_id: 'ev' }),
    ]
    expect(nextNewExpiry(list, NOW)).toBe(NOW - 60 * 60_000 + NEW_WINDOW_MS)
    expect(nextNewExpiry([list[2]], NOW)).toBeNull()
  })
})
