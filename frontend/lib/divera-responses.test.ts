import { describe, expect, it } from 'vitest'
import type { ApiDiveraResponsePerson, ApiDiveraResponsesSummary } from '@/lib/api/types'
import { groupIncoming, showsIncoming } from '@/lib/divera-responses'

function answer(overrides: Partial<ApiDiveraResponsePerson> & { name: string }): ApiDiveraResponsePerson {
  return {
    personnel_id: `p-${overrides.name}`,
    role: null,
    tags: [],
    kind: 'coming',
    attended: false,
    ...overrides,
  }
}

// The shared X1 fixture as the backend summarises it, yes/no only: 4 kommen (one of them not on
// the roster, counted in `unmapped`), 2 kommen nicht; «Rückruf erbeten» is not kept at all.
const summary: ApiDiveraResponsesSummary = {
  available: true,
  reason: null,
  alarm_count: 1,
  counts: { coming: 4, not_coming: 2 },
  people: [
    answer({ name: 'Muster Hans' }),
    answer({ name: 'Keller Peter' }),
    answer({ name: 'Meier Anna' }),
    answer({ name: 'Weber Marco', kind: 'not_coming' }),
    answer({ name: 'Huber Lea', kind: 'not_coming' }),
  ],
  unmapped: 1,
  updated_at: '2026-10-08T19:42:00Z',
}

const names = (people: ApiDiveraResponsePerson[]) => people.map((p) => p.name)

describe('groupIncoming', () => {
  it('splits «kommt» and «kommt nicht», each by name, and only counts the unmapped', () => {
    const groups = groupIncoming(summary, new Set())
    expect(names(groups.coming)).toEqual(['Keller Peter', 'Meier Anna', 'Muster Hans'])
    expect(names(groups.notComing)).toEqual(['Huber Lea', 'Weber Marco'])
    expect(groups.unmapped).toBe(1)
  })

  it('drops whoever is already checked in, «kommt nicht» included', () => {
    const groups = groupIncoming(summary, new Set(['p-Muster Hans', 'p-Huber Lea']))
    expect(names(groups.coming)).toEqual(['Keller Peter', 'Meier Anna'])
    expect(names(groups.notComing)).toEqual(['Weber Marco'])
  })

  it('drops whoever the backend flags as attended — somebody who checked in and went home again', () => {
    const wentHome = {
      ...summary,
      people: summary.people.map((p) => (p.name === 'Meier Anna' ? { ...p, attended: true } : p)),
    }
    expect(names(groupIncoming(wentHome, new Set()).coming)).toEqual(['Keller Peter', 'Muster Hans'])
  })

  it('is empty when the block is absent', () => {
    const absent = { ...summary, available: false, reason: 'no_data' as const }
    expect(groupIncoming(absent, new Set())).toEqual({ coming: [], notComing: [], unmapped: 0 })
    expect(groupIncoming(null, new Set()).coming).toEqual([])
    expect(showsIncoming(absent)).toBe(false)
    expect(showsIncoming(null)).toBe(false)
    expect(showsIncoming(summary)).toBe(true)
  })
})
