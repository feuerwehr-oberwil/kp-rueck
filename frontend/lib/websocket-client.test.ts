import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Fake socket.io socket: records handler registrations and lets tests fire events.
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
const handlers = new Map<string, Function[]>()
const fakeSocket = {
  connected: false,
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  on: vi.fn((event: string, cb: Function) => {
    if (!handlers.has(event)) handlers.set(event, [])
    handlers.get(event)!.push(cb)
  }),
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  off: vi.fn((event: string, cb: Function) => {
    const list = handlers.get(event)
    if (list) handlers.set(event, list.filter(h => h !== cb))
  }),
  emit: vi.fn(),
  disconnect: vi.fn(() => {
    fakeSocket.connected = false
  }),
}

vi.mock('socket.io-client', () => ({ io: vi.fn(() => fakeSocket) }))
vi.mock('@/lib/env', () => ({ getWsUrl: () => 'http://test-ws' }))

import { wsClient } from './websocket-client'

function fire(event: string, ...args: unknown[]) {
  // Copy first: socket.io fires all handlers registered at emit time.
  handlers.get(event)?.slice().forEach(cb => cb(...args))
}

describe('wsClient reconnect behaviour', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    handlers.clear()
    fakeSocket.connected = false
    fakeSocket.on.mockClear()
    fakeSocket.emit.mockClear()
  })

  afterEach(() => {
    wsClient.disconnect()
    vi.useRealTimers()
  })

  it('does not duplicate listeners across reconnects', () => {
    // Regression (audit point 12): listeners were re-attached (not replaced)
    // on every 'connect', so after N reconnects each update fired N times —
    // degrading a multi-hour wall-display session with redundant reloads.
    wsClient.connect()

    const callback = vi.fn()
    const unsubscribe = wsClient.on('incident_update', callback)

    // Initial connect + two reconnects (socket.io reuses the same socket).
    fakeSocket.connected = true
    fire('connect')
    fire('connect')
    fire('connect')

    fire('incident_update', { action: 'update', data: {} })
    expect(callback).toHaveBeenCalledTimes(1)

    unsubscribe()
  })

  it('attaches listeners registered before connect() exactly once', () => {
    const callback = vi.fn()
    const unsubscribe = wsClient.on('driver_update', callback)

    wsClient.connect()
    fakeSocket.connected = true
    fire('connect')

    fire('driver_update', { action: 'update', data: {} })
    expect(callback).toHaveBeenCalledTimes(1)

    unsubscribe()
  })

  it('rejoins the operations room on every reconnect', () => {
    // Rooms ARE per-connection state (unlike handlers), so the join must
    // still happen in the 'connect' handler each time.
    wsClient.connect()
    fakeSocket.connected = true
    fire('connect')
    fire('connect')

    const joinCalls = fakeSocket.emit.mock.calls.filter(([event]) => event === 'join')
    expect(joinCalls).toHaveLength(2)
    expect(joinCalls[0]).toEqual(['join', { room: 'operations' }])
  })
})
