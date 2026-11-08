import { describe, expect, it } from 'vitest'
import { sortForMapList, type ListOrderIncident } from './map-list-order'

const at = (hhmm: string) => new Date(`2026-11-08T${hhmm}:00Z`)

function incident(id: string, priority: string | null, created: string, statusChanged?: string): ListOrderIncident {
  return { id, priority, created_at: at(created), status_changed_at: statusChanged ? at(statusChanged) : null }
}

describe('sortForMapList', () => {
  it('reads Hoch → Mittel → Niedrig, then the oldest first', () => {
    const rows = [
      incident('low-old', 'low', '17:00'),
      incident('med-new', 'medium', '19:00'),
      incident('high', 'high', '19:10'),
      incident('med-old', 'medium', '18:00'),
    ]
    expect(sortForMapList(rows, 'total').map((r) => r.id)).toEqual(['high', 'med-old', 'med-new', 'low-old'])
  })

  it('measures «oldest» by the age the row shows – Spalte counts from the last status change', () => {
    // a came in first but changed column last: under «Spalte» it has the smaller age.
    const rows = [incident('a', 'low', '17:00', '19:00'), incident('b', 'low', '18:00', '18:30')]
    expect(sortForMapList(rows, 'column').map((r) => r.id)).toEqual(['b', 'a'])
    expect(sortForMapList(rows, 'total').map((r) => r.id)).toEqual(['a', 'b'])
    expect(sortForMapList(rows, 'start').map((r) => r.id)).toEqual(['a', 'b'])
  })

  it('places an incident without priority with Niedrig, as its glyph draws it', () => {
    const rows = [incident('none-new', null, '19:00'), incident('low-old', 'low', '18:00'), incident('med', 'medium', '19:30')]
    expect(sortForMapList(rows, 'total').map((r) => r.id)).toEqual(['med', 'low-old', 'none-new'])
  })

  it('leaves the input untouched', () => {
    const rows = [incident('b', 'low', '18:00'), incident('a', 'high', '19:00')]
    sortForMapList(rows, 'total')
    expect(rows.map((r) => r.id)).toEqual(['b', 'a'])
  })
})
