import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, type ApiViewerData } from '@/lib/api-client'
import { useViewerFeed } from './use-viewer-situation'

const getViewerData = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api-client', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/api-client')>(),
  apiClient: { getViewerData },
}))

const payload = { event: { name: 'Talbach' } } as ApiViewerData
async function poll(ms = 5000) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
}

describe('the shared wall feed', () => {
  beforeEach(() => { vi.useFakeTimers(); getViewerData.mockReset() })
  afterEach(() => vi.useRealTimers())

  it('retries an unanswered first read, retains the last good picture through a 503 and recovers', async () => {
    getViewerData.mockResolvedValueOnce(undefined).mockResolvedValueOnce(payload)
      .mockRejectedValueOnce(new ApiError('unavailable', 503)).mockResolvedValue(payload)
    const { result } = renderHook(() => useViewerFeed('wall'))
    await poll(0)
    expect(result.current).toMatchObject({ snapshot: null, status: 'retrying' })
    await poll()
    const snapshot = result.current.snapshot
    expect(snapshot?.payload).toEqual(payload)
    await poll()
    expect(result.current.status).toBe('retrying')
    expect(result.current.snapshot).toBe(snapshot)
    await poll()
    expect(result.current.status).toBe('ready')
    expect(result.current.snapshot!.received.getTime()).toBeGreaterThan(snapshot!.received.getTime())
  })

  it('clears the last event and stops polling once the credential expires', async () => {
    getViewerData.mockResolvedValueOnce(payload).mockRejectedValue(new ApiError('expired', 401))
    const { result } = renderHook(() => useViewerFeed('wall'))
    await poll(0)
    expect(result.current.status).toBe('ready')
    await poll()
    expect(result.current).toEqual({ snapshot: null, status: 'invalid' })
    await poll(15000)
    expect(getViewerData).toHaveBeenCalledTimes(2)
  })
})
