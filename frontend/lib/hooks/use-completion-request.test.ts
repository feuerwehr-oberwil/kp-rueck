import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { requestCompletion, useCompletionRequests } from './use-completion-request'

describe('useCompletionRequests', () => {
  it('hands each request to the mounted handler, and stops on unmount', () => {
    const handler = vi.fn()
    const { unmount } = renderHook(() => useCompletionRequests(handler))

    requestCompletion('i1')
    unmount()
    requestCompletion('i2')

    expect(handler.mock.calls).toEqual([['i1']])
  })

  it('listens to nothing without a handler (a viewer)', () => {
    const handler = vi.fn()
    const { rerender } = renderHook(({ on }) => useCompletionRequests(on ? handler : null), { initialProps: { on: false } })

    requestCompletion('i1')
    rerender({ on: true })
    requestCompletion('i2')

    expect(handler.mock.calls).toEqual([['i2']])
  })
})
