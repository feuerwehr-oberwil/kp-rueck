import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { requestCompletion, useCompletionRequests } from './use-completion-request'

const board = (eventId: string, ...ids: string[]) => ({ eventId, operations: ids.map((id) => ({ id })) })

describe('useCompletionRequests', () => {
  it('runs a request for an Einsatz on the board, and stops on unmount', () => {
    const run = vi.fn()
    const { unmount } = renderHook(() => useCompletionRequests(run, board('e1', 'i1', 'i2')))

    expect(requestCompletion({ incidentId: 'i1', eventId: 'e1' })).toBe(true)
    unmount()
    expect(requestCompletion({ incidentId: 'i2', eventId: 'e1' })).toBe(false)

    expect(run.mock.calls).toEqual([['i1']])
  })

  it('keeps a request of the Ereignis being switched to until the board has the Einsatz', () => {
    const run = vi.fn()
    const { rerender } = renderHook((props) => useCompletionRequests(run, props), { initialProps: board('e2') })

    expect(requestCompletion({ incidentId: 'i1', eventId: 'e1' })).toBe(true)
    rerender(board('e1'))
    expect(run).not.toHaveBeenCalled()
    rerender(board('e1', 'i1'))

    expect(run.mock.calls).toEqual([['i1']])
  })

  it('drops a waiting request once another Ereignis is selected', () => {
    const run = vi.fn()
    const { rerender } = renderHook((props) => useCompletionRequests(run, props), { initialProps: board('e1') })

    requestCompletion({ incidentId: 'i1', eventId: 'e1' })
    rerender(board('e2'))
    rerender(board('e1', 'i1'))

    expect(run).not.toHaveBeenCalled()
  })

  it('does not take a request it cannot place, nor any without a handler (a viewer)', () => {
    const run = vi.fn()
    const { rerender } = renderHook(({ on }) => useCompletionRequests(on ? run : null, board('e1', 'i1')), {
      initialProps: { on: true },
    })

    expect(requestCompletion({ incidentId: 'i9' })).toBe(false)
    rerender({ on: false })
    expect(requestCompletion({ incidentId: 'i1', eventId: 'e1' })).toBe(false)

    expect(run).not.toHaveBeenCalled()
  })
})
