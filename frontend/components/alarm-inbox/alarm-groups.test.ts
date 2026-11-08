import { describe, expect, it } from 'vitest'

import type { ApiDiveraEmergency } from '@/lib/api-client'
import { countNewAlarms, groupAlarms } from './alarm-groups'

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
  it('splits new, attached in the last 24 hours and the rest, keeping the order', () => {
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

  it('reads the receipt time for an attached row without an attach time', () => {
    const row = alarm('legacy', { attached_to_event_id: 'ev', received_at: ago(30) })
    expect(groupAlarms([row], NOW).today).toEqual([row])
  })

  it('still counts an alarm stamped a little in the future (clock skew) as new', () => {
    expect(countNewAlarms([alarm('skew', { received_at: new Date(NOW + 30_000).toISOString() })], NOW)).toBe(1)
  })
})
