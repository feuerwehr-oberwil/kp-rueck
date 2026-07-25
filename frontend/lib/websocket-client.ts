/**
 * WebSocket client for real-time updates
 */

import { io, Socket } from 'socket.io-client'
import { getWsUrl } from './env'

export type WebSocketStatus = 'connecting' | 'connected' | 'disconnected' | 'error'

export interface WebSocketUpdate<T = any> {
  // 'driver_stay' is a targeted assignment toggle that clients apply surgically
  // (no full reload), unlike structural create/update/delete events.
  action: 'create' | 'update' | 'delete' | 'driver_stay'
  data: T
}

export interface SystemMessage {
  message: string
  level: 'info' | 'warning' | 'error'
  timestamp: number
}

class WebSocketClient {
  private socket: Socket | null = null
  private status: WebSocketStatus = 'disconnected'
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  private listeners: Map<string, Set<Function>> = new Map()
  private statusListeners: Set<(status: WebSocketStatus) => void> = new Set()
  private reconnectAttempts = 0
  private maxReconnectAttempts = 10
  private reconnectDelay = 1000
  private pingIntervalId: ReturnType<typeof setInterval> | null = null
  // How many mounted consumers currently want this socket alive. The socket is
  // a module singleton shared by OperationsProvider (root layout, effectively
  // permanent) and several page-level consumers (/check-in, /reko-dashboard).
  // Without refcounting, the FIRST page to unmount tore the socket down for
  // everyone — navigating board → Check-in → board silently killed realtime
  // for the rest of the session, because the provider's connect() lives in a
  // root-layout effect that never re-runs. Polling covered the data, so
  // nothing on screen ever revealed it.
  private consumers = 0

  /**
   * Connect to the WebSocket server.
   *
   * Registers one consumer; pair every call with `disconnect()`.
   */
  connect() {
    this.consumers++
    this.dial()
  }

  /** Open a socket if one isn't already alive. Does not touch the refcount. */
  private dial() {
    if (this.socket) {
      if (this.socket.connected) {
        console.log('WebSocket already connected')
        return
      }
      // A socket exists and its io manager is still actively connecting or
      // auto-reconnecting — let it finish. Anything else (gave up after max
      // attempts, or a server-initiated disconnect that socket.io does NOT
      // retry) is dead weight: replace it. The old guard (`status !== 'error'`)
      // kept permanently-dead sockets around forever, so no later connect()
      // call could ever restore realtime updates.
      if (this.socket.active) {
        return
      }
      this.socket.disconnect()
      this.socket = null
    }

    const wsUrl = getWsUrl()

    this.socket = io(wsUrl, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: this.reconnectDelay,
      reconnectionDelayMax: 10000,
      reconnectionAttempts: this.maxReconnectAttempts,
      withCredentials: true,
      path: '/socket.io/',
    })

    this.setupEventHandlers()

    // Attach all buffered app listeners ONCE per socket. Socket.io keeps
    // handlers across disconnect/reconnect cycles, so re-attaching on every
    // 'connect' (the old behaviour) duplicated every listener per reconnect —
    // after N reconnects each update triggered N redundant full reloads on a
    // multi-hour wall-display session.
    this.listeners.forEach((callbacks, event) => {
      callbacks.forEach(callback => {
        this.socket!.on(event, callback as any)
      })
    })

    this.updateStatus('connecting')
  }

  /**
   * Release one consumer's claim on the socket. The connection is only really
   * torn down once the last consumer has released it.
   */
  disconnect() {
    this.consumers = Math.max(0, this.consumers - 1)
    if (this.consumers > 0) return
    this.forceDisconnect()
  }

  /**
   * Tear the socket down regardless of refcount. For teardown paths that must
   * not depend on consumers having balanced their calls (tests, sign-out).
   */
  forceDisconnect() {
    this.consumers = 0
    if (this.pingIntervalId) {
      clearInterval(this.pingIntervalId)
      this.pingIntervalId = null
    }
    if (this.socket) {
      this.socket.disconnect()
      this.socket = null
      this.updateStatus('disconnected')
    }
  }

  /**
   * Drop a dead socket and dial again, keeping the current consumer count.
   *
   * socket.io stops retrying after `maxReconnectAttempts`, which latches the
   * status at 'error' with no way back. Used by the stale-data banner's
   * "Neu verbinden" action so operators aren't left reloading the page.
   */
  reconnect() {
    if (this.socket) {
      this.socket.disconnect()
      this.socket = null
    }
    this.reconnectAttempts = 0
    // dial(), not connect(): this is an existing consumer re-dialling, so the
    // refcount must not move.
    this.dial()
  }

  /**
   * Join a room for targeted updates
   */
  joinRoom(room: string) {
    if (this.socket?.connected) {
      this.socket.emit('join', { room })
      console.log(`Joining room: ${room}`)
    }
  }

  /**
   * Leave a room
   */
  leaveRoom(room: string) {
    if (this.socket?.connected) {
      this.socket.emit('leave', { room })
      console.log(`Leaving room: ${room}`)
    }
  }

  /**
   * Subscribe to WebSocket events
   */
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  on(event: string, callback: Function) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    this.listeners.get(event)!.add(callback)

    // Attach to the live socket immediately (connected or not — socket.io
    // keeps handlers across reconnects). If no socket exists yet, connect()
    // attaches everything buffered in `listeners` when it creates one.
    if (this.socket) {
      this.socket.on(event, callback as any)
    }

    // Return unsubscribe function
    return () => {
      this.off(event, callback)
    }
  }

  /**
   * Unsubscribe from WebSocket events
   */
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  off(event: string, callback: Function) {
    const callbacks = this.listeners.get(event)
    if (callbacks) {
      callbacks.delete(callback)
      if (callbacks.size === 0) {
        this.listeners.delete(event)
      }
    }

    if (this.socket) {
      this.socket.off(event, callback as any)
    }
  }

  /**
   * Subscribe to connection status changes
   */
  onStatusChange(callback: (status: WebSocketStatus) => void) {
    this.statusListeners.add(callback)
    // Immediately call with current status
    callback(this.status)

    // Return unsubscribe function
    return () => {
      this.statusListeners.delete(callback)
    }
  }

  /**
   * Get current connection status
   */
  getStatus(): WebSocketStatus {
    return this.status
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.status === 'connected'
  }

  /**
   * Send a ping to keep the connection alive
   */
  ping() {
    if (this.socket?.connected) {
      this.socket.emit('ping')
    }
  }

  private setupEventHandlers() {
    if (!this.socket) return

    // Connection events. NOTE: no listener re-attach here — 'connect' fires
    // on every reconnect and socket.io already keeps handlers across
    // reconnects; re-attaching would duplicate them (see connect()).
    this.socket.on('connect', () => {
      console.log('WebSocket connected')
      this.reconnectAttempts = 0
      this.updateStatus('connected')

      // Join operations room automatically (rooms ARE reset per connection)
      this.joinRoom('operations')
    })

    this.socket.on('disconnect', (reason) => {
      console.log('WebSocket disconnected:', reason)
      this.updateStatus('disconnected')
      // The server closed the connection deliberately (e.g. the idle-session
      // reaper kicking a background tab whose 30s ping was throttled).
      // socket.io does NOT auto-reconnect on 'io server disconnect' — without
      // this, a wall display that slept >5 min silently loses realtime
      // updates for the rest of the session.
      if (reason === 'io server disconnect') {
        this.socket?.connect()
      }
    })

    this.socket.on('connect_error', (error) => {
      console.error('WebSocket connection error:', error.message)
      this.reconnectAttempts++

      if (this.reconnectAttempts >= this.maxReconnectAttempts) {
        this.updateStatus('error')
      }
    })

    // Custom events
    this.socket.on('connected', (data) => {
      console.log('Server acknowledged connection:', data)
    })

    this.socket.on('joined', (data) => {
      console.log('Joined room:', data.room)
    })

    this.socket.on('left', (data) => {
      console.log('Left room:', data.room)
    })

    this.socket.on('pong', (data) => {
      console.log('Pong received:', data)
    })

    this.socket.on('error', (data) => {
      console.error('WebSocket error:', data)
    })

    // Keep-alive ping every 30 seconds (clear previous to prevent leaks)
    if (this.pingIntervalId) {
      clearInterval(this.pingIntervalId)
    }
    this.pingIntervalId = setInterval(() => {
      this.ping()
    }, 30000)
  }

  private updateStatus(status: WebSocketStatus) {
    if (this.status !== status) {
      this.status = status
      this.statusListeners.forEach(listener => listener(status))
    }
  }
}

// Export singleton instance
export const wsClient = new WebSocketClient()

// Export types for use in components
export type { WebSocketClient }
