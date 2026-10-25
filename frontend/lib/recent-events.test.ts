import { describe, expect, it } from 'vitest'
import type { Event } from '@/lib/types/incidents'
import { recentOpenEvents } from './recent-events'

const NOW = new Date('2026-10-24T03:00:00Z')
const h = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000)

function ev(id: string, openedHoursAgo: number, activeHoursAgo: number, archived = false): Event {
  return {
    id,
    name: id,
    training_flag: false,
    created_at: h(openedHoursAgo),
    updated_at: h(activeHoursAgo),
    archived_at: archived ? h(1) : null,
    last_activity_at: h(activeHoursAgo),
    incident_count: 0,
  }
}

describe('recentOpenEvents', () => {
  it('keeps open Ereignisse opened under 24 h ago, most recently active first', () => {
    const events = [ev('uebung', 2, 1.5), ev('sturm', 20, 0.1), ev('archiviert', 3, 0.05, true), ev('gestern', 25, 0.01)]
    expect(recentOpenEvents(events, NOW).map((e) => e.id)).toEqual(['sturm', 'uebung'])
  })

  it('is empty when nothing was opened in the last 24 h – the fallback card', () => {
    expect(recentOpenEvents([ev('alt', 24, 0)], NOW)).toEqual([])
  })
})
