import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { type CompletionBoard, completionReadiness, requestCompletion, useCompletionBoard } from './use-completion-request'

const board = (eventId: string, loaded: boolean, ...ids: string[]): CompletionBoard => ({
  eventId,
  loaded,
  failed: false,
  has: (incidentId) => ids.includes(incidentId),
  run: vi.fn(),
  retry: vi.fn(),
})
const failedBoard = (eventId: string, ...ids: string[]): CompletionBoard => ({ ...board(eventId, true, ...ids), failed: true })

describe('completionReadiness', () => {
  it.each([
    ['ready: the board has the Einsatz', board('e1', true, 'i1'), 'e1', 'ready'],
    ['ready, whatever the looked-up Ereignis', board('e1', true, 'i1'), undefined, 'ready'],
    ['otherEvent: another Ereignis is on screen', board('e2', true), 'e1', 'otherEvent'],
    ['loading: its Ereignis is on screen, still loading', board('e1', false), 'e1', 'loading'],
    ['missing: its Ereignis is loaded without it', board('e1', true), 'e1', 'missing'],
    ['missing: unknown Ereignis, not on the loaded board', board('e2', true), undefined, 'missing'],
    ['failed: its Ereignis is on screen, its load failed', failedBoard('e1'), 'e1', 'failed'],
    ['ready, after a failed load that had it', failedBoard('e1', 'i1'), 'e1', 'ready'],
  ] as const)('%s', (_name, offered, eventId, expected) => {
    expect(completionReadiness(offered, 'i1', eventId)).toBe(expected)
  })

  it('is missing without a board', () => {
    expect(completionReadiness(null, 'i1', 'e1')).toBe('missing')
  })
})

describe('requestCompletion', () => {
  it('runs on the offered board when it has the Einsatz, and stops on unmount', () => {
    const offered = board('e1', true, 'i1')
    const { unmount } = renderHook(() => useCompletionBoard(offered))

    expect(requestCompletion('i2')).toBe(false)
    expect(requestCompletion('i1')).toBe(true)
    unmount()
    expect(requestCompletion('i1')).toBe(false)

    expect(vi.mocked(offered.run).mock.calls).toEqual([['i1']])
  })

  it('offers nothing for a viewer (null)', () => {
    renderHook(() => useCompletionBoard(null))
    expect(requestCompletion('i1')).toBe(false)
  })
})
