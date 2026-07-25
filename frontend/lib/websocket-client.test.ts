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
    fakeSocket.disconnect.mockClear()
  })

  afterEach(() => {
    // forceDisconnect, not disconnect: wsClient is a refcounted module
    // singleton, so a balanced release would leave state leaking between tests
    // whenever a case connects more than once.
    wsClient.forceDisconnect()
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

  it('keeps the socket alive until the last consumer disconnects', () => {
    // Regression: wsClient is a singleton shared by OperationsProvider (root
    // layout) and page-level consumers like /check-in. An unbalanced
    // disconnect() from the page killed realtime for the whole app until a
    // reload — polling masked it, so nothing surfaced on screen.
    wsClient.connect() // OperationsProvider
    fakeSocket.connected = true
    fire('connect')

    wsClient.connect() // /check-in mounts onto the live socket

    wsClient.disconnect() // /check-in unmounts
    expect(fakeSocket.disconnect).not.toHaveBeenCalled()
    expect(wsClient.getStatus()).toBe('connected')

    wsClient.disconnect() // provider tears down
    expect(fakeSocket.disconnect).toHaveBeenCalled()
    expect(wsClient.getStatus()).toBe('disconnected')
  })

  it('re-dials a socket that gave up, without moving the refcount', () => {
    // socket.io stops retrying after maxReconnectAttempts and latches at
    // 'error'. reconnect() backs the "Neu verbinden" banner action.
    wsClient.connect()
    fakeSocket.connected = true
    fire('connect')

    fakeSocket.connected = false
    wsClient.reconnect()
    fakeSocket.connected = true
    fire('connect')
    expect(wsClient.getStatus()).toBe('connected')

    // Still exactly one consumer, so a single disconnect must close it.
    wsClient.disconnect()
    expect(wsClient.getStatus()).toBe('disconnected')
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
