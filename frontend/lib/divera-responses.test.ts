import { describe, expect, it } from 'vitest'
import type { ApiDiveraResponsePerson, ApiDiveraResponsesSummary } from '@/lib/api/types'
import { arrivalKey, formatClock, groupIncoming, showsIncoming } from '@/lib/divera-responses'

function answer(overrides: Partial<ApiDiveraResponsePerson> & { ucr_id: number }): ApiDiveraResponsePerson {
  return {
    personnel_id: `p-${overrides.ucr_id}`,
    name: `Person ${overrides.ucr_id}`,
    role: null,
    tags: [],
    attended: false,
    status_id: 11,
    status_name: 'Komme',
    kind: 'coming',
    answered_at: '2026-10-08T19:41:00Z',
    eta: null,
    note: null,
    ...overrides,
  }
}

// The shared X1 fixture as the backend summarises it (counts 4 · 2 · 1; 999 is not on the
// roster, so the backend only counts it in `unmapped` and never lists it).
const summary: ApiDiveraResponsesSummary = {
  available: true,
  reason: null,
  alarm_count: 1,
  counts: { coming: 4, not_coming: 2, other: 1 },
  statuses: [],
  people: [
    answer({ ucr_id: 101, answered_at: '2026-10-08T19:41:00Z' }),
    answer({ ucr_id: 102, answered_at: '2026-10-08T19:41:15Z', note: 'bin im Magazin' }),
    answer({ ucr_id: 103, status_id: 12, answered_at: '2026-10-08T19:41:30Z', eta: '2026-10-08T19:51:30Z' }),
    answer({ ucr_id: 104, kind: 'not_coming', status_id: 13, name: 'Huber Lea', note: 'Ferien' }),
    answer({ ucr_id: 105, kind: 'not_coming', status_id: 13, name: 'Abt Marco' }),
    answer({ ucr_id: 106, kind: 'other', status_id: 17, status_name: 'Rückruf erbeten' }),
  ],
  addressed: 10,
  read: 8,
  answered: 7,
  unanswered: 3,
  unmapped: 1,
  updated_at: '2026-10-08T19:42:00Z',
}

describe('groupIncoming', () => {
  it('splits coming, other and «kommt nicht» and only counts the unmapped', () => {
    const groups = groupIncoming(summary, new Set())
    expect(groups.coming.map((p) => p.ucr_id)).toEqual([101, 102, 103])
    expect(groups.other.map((p) => p.ucr_id)).toEqual([106])
    expect(groups.notComing.map((p) => p.name)).toEqual(['Abt Marco', 'Huber Lea'])
    expect(groups.unmapped).toBe(1)
  })

  it('drops whoever is already checked in, «kommt nicht» included', () => {
    const groups = groupIncoming(summary, new Set(['p-101', 'p-104']))
    expect(groups.coming.map((p) => p.ucr_id)).toEqual([102, 103])
    expect(groups.notComing.map((p) => p.ucr_id)).toEqual([105])
  })

  it('drops whoever the backend flags as attended — somebody who checked in and went home again', () => {
    const wentHome = {
      ...summary,
      people: summary.people.map((p) => (p.ucr_id === 102 ? { ...p, attended: true } : p)),
    }
    expect(groupIncoming(wentHome, new Set()).coming.map((p) => p.ucr_id)).toEqual([101, 103])
  })

  it('orders the coming by expected arrival: the estimate if there is one, else the answer', () => {
    const late = answer({ ucr_id: 1, answered_at: '2026-10-08T19:40:00Z', eta: '2026-10-08T20:00:00Z' })
    const now = answer({ ucr_id: 2, answered_at: '2026-10-08T19:45:00Z' })
    const groups = groupIncoming({ ...summary, people: [late, now] }, new Set())
    expect(groups.coming.map((p) => p.ucr_id)).toEqual([2, 1])
    expect(arrivalKey(late)).toBe(Date.parse('2026-10-08T20:00:00Z'))
  })

  it('is empty when the block is absent', () => {
    const absent = { ...summary, available: false, reason: 'not_linked' as const }
    expect(groupIncoming(absent, new Set())).toEqual({ coming: [], other: [], notComing: [], unmapped: 0 })
    expect(groupIncoming(null, new Set()).coming).toEqual([])
    expect(showsIncoming(absent)).toBe(false)
    expect(showsIncoming(null)).toBe(false)
    expect(showsIncoming(summary)).toBe(true)
  })
})

describe('formatClock', () => {
  it('formats HH:MM and survives nonsense', () => {
    expect(formatClock('2026-10-08T19:51:30Z', 'de-CH')).toMatch(/^\d{2}:\d{2}$/)
    expect(formatClock(null, 'de-CH')).toBeNull()
    expect(formatClock('not a date', 'de-CH')).toBeNull()
  })
})
