import { describe, expect, it, vi } from 'vitest'
import { QueryObserver } from '@tanstack/react-query'
import type { WebSocketStatus } from '@/lib/websocket-client'

// A socket the test drives: `emit` delivers an event, `setStatus` moves the connection.
const socket = vi.hoisted(() => {
  const listeners = new Map<string, Set<(payload: unknown) => void>>()
  const statusListeners = new Set<(status: WebSocketStatus) => void>()
  let status: WebSocketStatus = 'connected'
  return {
    on: (event: string, listener: (payload: unknown) => void) => {
      const set = listeners.get(event) ?? new Set()
      set.add(listener)
      listeners.set(event, set)
      return () => set.delete(listener)
    },
    onStatusChange: (listener: (status: WebSocketStatus) => void) => {
      statusListeners.add(listener)
      listener(status)
      return () => statusListeners.delete(listener)
    },
    getStatus: () => status,
    emit: (event: string, payload: unknown) => listeners.get(event)?.forEach((listener) => listener(payload)),
    setStatus: (next: WebSocketStatus) => {
      status = next
      statusListeners.forEach((listener) => listener(next))
    },
  }
})
vi.mock('@/lib/websocket-client', () => ({ wsClient: socket }))

import { makeQueryClient } from './client'
import { queryKeys } from './keys'
import { bridgeSocketToQueries } from './socket-bridge'

/** A read of the Divera responses of `eventId` that something shows; counts its fetches. */
function shownDiveraRead(client: ReturnType<typeof makeQueryClient>, eventId: string) {
  const fetch = vi.fn(async () => ({ eventId }))
  const observer = new QueryObserver(client, { queryKey: queryKeys.eventDiveraResponses.of(eventId), queryFn: fetch })
  observer.subscribe(() => {})
  return fetch
}

describe('bridgeSocketToQueries', () => {
  it('refetches only the Ereignis an event names, and every socket-kept read on reconnect', async () => {
    const client = makeQueryClient()
    const stop = bridgeSocketToQueries(client)
    const a = shownDiveraRead(client, 'ev-a')
    const b = shownDiveraRead(client, 'ev-b')
    await vi.waitFor(() => expect(client.isFetching()).toBe(0))
    expect([a, b].map((read) => read.mock.calls.length)).toEqual([1, 1])

    socket.emit('divera_responses_update', { event_ids: ['ev-b'], incident_ids: [] })
    await vi.waitFor(() => expect(b).toHaveBeenCalledTimes(2))
    expect(a).toHaveBeenCalledTimes(1)

    socket.setStatus('disconnected')
    socket.setStatus('connected')
    await vi.waitFor(() => expect(a).toHaveBeenCalledTimes(2))
    expect(b).toHaveBeenCalledTimes(3)
    stop()
  })

  it('asks again when the event comes while the first read is still out', async () => {
    const client = makeQueryClient()
    const stop = bridgeSocketToQueries(client)
    const read = shownDiveraRead(client, 'ev-a')
    expect(read).toHaveBeenCalledTimes(1)

    socket.emit('personnel_update', { action: 'checkin', data: null })
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2))
    stop()
  })
})
