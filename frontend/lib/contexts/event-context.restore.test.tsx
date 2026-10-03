import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getEvent: vi.fn() }))
vi.mock('@/lib/api-client', () => ({ apiClient: { getEvent: mocks.getEvent, getEvents: vi.fn() } }))
vi.mock('./auth-context', () => ({ useAuth: () => ({ isAuthenticated: true, loading: false }) }))

import { EventProvider, useEvent } from './event-context'

const ID = '7920dc15-1f39-45f0-924a-ac144dafa878'
const wrapper = ({ children }: { children: ReactNode }) => <EventProvider>{children}</EventProvider>

const storage = new Map<string, string>()
beforeEach(() => {
  storage.clear()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => void storage.set(k, v),
      removeItem: (k: string) => void storage.delete(k),
    },
  })
  mocks.getEvent.mockReset()
})

describe('EventProvider restoring the last Ereignis on launch', () => {
  it('never reports «loaded, no Ereignis» on the way to the restored one', async () => {
    storage.set('kp-rueck-selected-event', ID)
    mocks.getEvent.mockResolvedValue({
      id: ID, name: 'Unwetter Oberwil', training_flag: false, created_at: '2026-10-02T00:00:00Z',
      updated_at: '2026-10-02T00:00:00Z', archived_at: null, last_activity_at: '2026-10-02T00:00:00Z', incident_count: 21,
    })
    const seen: Array<[boolean, string | null]> = []
    const { result } = renderHook(() => {
      const ctx = useEvent()
      seen.push([ctx.isEventLoaded, ctx.selectedEvent?.id ?? null])
      return ctx
    }, { wrapper })
    await waitFor(() => expect(result.current.isEventLoaded).toBe(true))
    expect(result.current.selectedEvent?.id).toBe(ID)
    // The launch cover keys off this pair: «loaded» must arrive WITH the Ereignis.
    expect(seen.some(([loaded, id]) => loaded && id === null)).toBe(false)
  })

  it('reports «loaded, no Ereignis» once when the stored one no longer exists', async () => {
    storage.set('kp-rueck-selected-event', ID)
    mocks.getEvent.mockRejectedValue(new Error('404'))
    const { result } = renderHook(() => useEvent(), { wrapper })
    await waitFor(() => expect(result.current.isEventLoaded).toBe(true))
    expect(result.current.selectedEvent).toBeNull()
    expect(storage.has('kp-rueck-selected-event')).toBe(false)
  })
})
