import { describe, expect, it } from 'vitest'

import de from '@/messages/de.json'
import {
  MOBILE_INCIDENT_SORTS,
  isMobileIncidentSort,
  sortMobileIncidents,
  type SortableIncident,
} from '@/lib/mobile-incident-sort'

const at = (hhmm: string) => new Date(`2026-11-14T${hhmm}:00Z`)

type Row = SortableIncident & { id: string }
const row = (id: string, status: string, alarm: string, changed: string | null, priority = 'low'): Row => ({
  id,
  status,
  priority,
  dispatchTime: at(alarm),
  statusChangedAt: changed ? at(changed) : null,
})

// a: alarmed first, but only just moved to Im Einsatz · b: newest alarm, never moved
// c: Eingegangen since 18:10 · d: Hoch, alarmed last but one, moved at 18:20
const ROWS = [
  row('a', 'active', '18:00', '18:50'),
  row('b', 'incoming', '18:40', null),
  row('c', 'incoming', '18:10', null),
  row('d', 'incoming', '18:30', '18:20', 'high'),
]
const ids = (rows: Row[]) => rows.map((r) => r.id)

describe('sortMobileIncidents', () => {
  it('«Status» keeps the list as it was: board flow, then Hoch first, then the latest alarm', () => {
    expect(ids(sortMobileIncidents(ROWS, 'status'))).toEqual(['a', 'd', 'b', 'c'])
  })

  it('«Neueste zuerst»: the latest alarm on top, whatever the status', () => {
    expect(ids(sortMobileIncidents(ROWS, 'newest'))).toEqual(['b', 'd', 'c', 'a'])
  })

  it('«Längste Wartezeit»: longest in its current column first – the last status change, else the alarm', () => {
    // c waits since 18:10, d since its move at 18:20, b since 18:40, a only since 18:50
    expect(ids(sortMobileIncidents(ROWS, 'longestWait'))).toEqual(['c', 'd', 'b', 'a'])
  })

  it('returns a copy and leaves the board’s array alone', () => {
    const before = ids(ROWS)
    sortMobileIncidents(ROWS, 'newest')
    expect(ids(ROWS)).toEqual(before)
  })
})

describe('isMobileIncidentSort – what a stored value may be', () => {
  it('accepts the three sorts and nothing else', () => {
    expect(['status', 'newest', 'longestWait'].every(isMobileIncidentSort)).toBe(true)
    expect(isMobileIncidentSort('oldest')).toBe(false)
    expect(isMobileIncidentSort(null)).toBe(false)
  })
})

// The funnel names a sort through a dynamic key (`t(`sort.${sort}`)`), which neither tsc nor the
// literal-key check can follow: a sort without a label would print its raw key.
it('has a German label for exactly the three sorts', () => {
  expect(Object.keys(de.incidents.mobileList.sort).sort()).toEqual([...MOBILE_INCIDENT_SORTS].sort())
})
