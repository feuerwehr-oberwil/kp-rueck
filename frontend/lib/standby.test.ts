import { describe, expect, it } from 'vitest'
import { standbyLists } from './standby'
import type { Operation } from './contexts/operations-context'

const NOW = new Date('2026-07-11T17:30:00Z').getTime()

function op(id: string, status: Operation['status'], priority: Operation['priority'], minutesInStatus: number): Operation {
  const since = new Date(NOW - minutesInStatus * 60_000)
  return { id, status, priority, dispatchTime: since, statusChangedAt: since } as Operation
}

describe('standbyLists', () => {
  it('splits by status and leaves Abgeschlossen out', () => {
    const lists = standbyLists(
      [
        op('in', 'incoming', 'low', 5),
        op('reko', 'reko', 'low', 5),
        op('done', 'reko_done', 'low', 5),
        op('way', 'enroute', 'low', 5),
        op('act', 'active', 'low', 5),
        op('back', 'returning', 'low', 5),
        op('closed', 'complete', 'low', 5),
      ],
      'column',
    )
    expect(lists.ready.map((o) => o.id)).toEqual(['done'])
    expect(lists.waiting.map((o) => o.id)).toEqual(['in', 'reko'])
    expect(lists.out.map((o) => o.id)).toEqual(['act', 'way', 'back'])
  })

  it('orders by priority, then the longest wait', () => {
    const lists = standbyLists(
      [op('low-old', 'incoming', 'low', 90), op('high-new', 'reko', 'high', 2), op('mid', 'incoming', 'medium', 10), op('low-new', 'incoming', 'low', 3)],
      'column',
    )
    expect(lists.waiting.map((o) => o.id)).toEqual(['high-new', 'mid', 'low-old', 'low-new'])
  })
})
