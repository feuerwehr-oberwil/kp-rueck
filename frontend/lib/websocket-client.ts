/**
 * WebSocket client for real-time updates: one socket per tab (`wsClient`), refcounted by its
 * consumers, and `on(event, listener)` typed by `WsEvents`.
 */

import { io, Socket } from 'socket.io-client'
import { fetchWsToken } from './auth-client'
import { getWsUrl } from './env'
import type {
  ApiAssignment,
  ApiAutogenState,
  ApiDiveraEmergency,
  ApiGpsSimDrive,
  ApiRegieState,
  ApiVehiclePosition,
  ApiVehicleTrail,
} from './api/types'
import type { PrintJobEvent } from './print-job-tracker'

export type WebSocketStatus = 'connecting' | 'connected' | 'disconnected' | 'error'

// Connection-lifecycle tracing is opt-in via NEXT_PUBLIC_DEBUG_WS=1 so a station's
// production console stays quiet — this file used to narrate every room join and
// every 30s pong to every operator. Errors are always logged. The flag is inlined at
// build time, so it is a development convenience: published images are built without
// it and can never turn it on by accident.
// Same shape as the proxy route's PROXY_DEBUG (app/backend-api/[...path]/route.ts).
const WS_DEBUG = process.env.NEXT_PUBLIC_DEBUG_WS === '1'
const debug = (...args: unknown[]) => {
  // eslint-disable-next-line no-console -- opt-in diagnostic tracing only
  if (WS_DEBUG) console.log(...args)
}

/** A CRUD broadcast (`broadcast_*_update` in backend/app/websocket_manager.py): what
 *  happened and the row it happened to. Most listeners only reload; the row is `unknown`
 *  where nobody reads it. */
export interface WsUpdate<A extends string, T = unknown> {
  action: A
  data: T
}

/** The flat messages (`broadcast_message`) carry their own name as `type`. */
type WsMessage<K extends string, T> = { type: K } & T

/**
 * Every event the backend sends with what it carries – the same names as `WsEvent` in
 * backend/app/websocket_manager.py, and the actions its call sites pass. `on()` takes
 * only these names, so a typo or a renamed event is a tsc error, not a dead listener.
 */
export interface WsEvents {
  incident_update: WsUpdate<'create' | 'update' | 'delete' | 'refresh' | 'reorder'>
  group_update: WsUpdate<'create' | 'update' | 'delete' | 'refresh' | 'reorder' | 'stops_reorder'>
  personnel_update: WsUpdate<'create' | 'update' | 'delete' | 'refresh' | 'checkin' | 'sync'>
  vehicle_update: WsUpdate<'create' | 'update' | 'delete'>
  material_update: WsUpdate<'create' | 'update' | 'delete'>
  /** `driver_stay` is a targeted toggle a board applies surgically (no full reload);
   *  `leader` (an Einsatzleiter change) and the rest reload. */
  assignment_update:
    | WsUpdate<'driver_stay' | 'leader', ApiAssignment>
    | WsUpdate<'create' | 'delete' | 'refresh' | 'merge' | 'unmerge'>
  planned_assignment_update: { event_id: string }
  special_function_update: WsUpdate<'assign' | 'unassign'>
  reko_update: WsUpdate<'arrived' | 'submit' | 'update', { incident_id: string }>
  notification_update: WsUpdate<'create' | 'dismiss' | 'refresh'>
  print_job_update: WsUpdate<'update', PrintJobEvent>
  kp_message_update: WsUpdate<'created' | 'merged' | 'unmerged'>
  journal_update: WsUpdate<'created'>
  divera_responses_update: { event_ids: string[]; incident_ids: string[] }
  vehicle_positions_update: { data: ApiVehiclePosition[] }
  vehicle_trails_update: { data: ApiVehicleTrail[] }
  assignments_transferred: WsMessage<'assignments_transferred', {
    source_incident_id: string
    target_incident_id: string
    assignment_ids: string[]
    count: number
    event_id: string
  }>
  divera_emergency_received: WsMessage<'divera_emergency_received', {
    emergency: ApiDiveraEmergency
    auto_attached: boolean
    source?: string
  }>
  gps_release_prompt: WsMessage<'gps_release_prompt', {
    assignment_id: string
    incident_id: string
    vehicle_id: string
    vehicle_name: string
    incident_label: string
  }>
  gps_sim_status: WsMessage<'gps_sim_status', {
    drives: Pick<ApiGpsSimDrive, 'vehicle_id' | 'vehicle_name' | 'target_label' | 'kind'>[]
  }>
  training_regie: WsMessage<'training_regie', ApiRegieState>
  training_autogen: WsMessage<'training_autogen', ApiAutogenState>
  /** The demo sandbox was wiped and re-seeded (nightly or by hand). */
  demo_reset: WsMessage<'demo_reset', object>
}

export type WsEventName = keyof WsEvents

/** What the socket hands every handler: the payload, still unread. */
type SocketHandler = (payload: unknown) => void

class WebSocketClient {
  private socket: Socket | null = null
  private status: WebSocketStatus = 'disconnected'
  private listeners: Map<WsEventName, Set<SocketHandler>> = new Map()
  private statusListeners: Set<(status: WebSocketStatus) => void> = new Set()
  private reconnectAttempts = 0
  private maxReconnectAttempts = 10
  private reconnectDelay = 1000
  private pingIntervalId: ReturnType<typeof setInterval> | null = null
  // How many mounted consumers currently want this socket alive. The socket is
  // a module singleton shared by OperationsProvider (root layout, effectively
  // permanent) and several page-level consumers (/check-in, /feld).
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
        debug('WebSocket already connected')
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
      // The split-origin handshake (sweep 27 §P3.4). On Railway staging and
      // prod (kp.fwo.li → kp-api.fwo.li) the session cookie is first-party to
      // the FRONTEND origin and never reaches the backend socket, so every
      // connect was rejected under WS_REQUIRE_AUTH and clients silently lived
      // on the 5s polling fallback. The token is fetched same-origin (the
      // cookie rides along there) and passed in the auth payload; the backend
      // accepts either credential.
      //
      // A FUNCTION, not an object, and that is load-bearing: socket.io calls
      // it before every (re)connection attempt, so a reconnect after the
      // 60-second token expired gets a fresh one instead of replaying a dead
      // credential. Sessionless pages (display/viewer without login) get null
      // and connect without a token — unchanged behaviour.
      auth: (cb) => {
        void fetchWsToken().then(token => cb(token ? { token } : {}))
      },
    })

    this.setupEventHandlers()

    // Attach all buffered app listeners ONCE per socket. Socket.io keeps
    // handlers across disconnect/reconnect cycles, so re-attaching on every
    // 'connect' (the old behaviour) duplicated every listener per reconnect —
    // after N reconnects each update triggered N redundant full reloads on a
    // multi-hour wall-display session.
    const socket = this.socket
    this.listeners.forEach((handlers, event) => {
      handlers.forEach(handler => socket.on(event, handler))
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
      debug(`Joining room: ${room}`)
    }
  }

  /**
   * Leave a room
   */
  leaveRoom(room: string) {
    if (this.socket?.connected) {
      this.socket.emit('leave', { room })
      debug(`Leaving room: ${room}`)
    }
  }

  /**
   * Listen for `event`; returns the unsubscribe (an effect's cleanup). The listener gets
   * the payload `WsEvents` names for it.
   */
  on<K extends WsEventName>(event: K, listener: (payload: WsEvents[K]) => void): () => void {
    // The one place a socket payload meets its type: the backend sends WsEvents[K] for K.
    const handler: SocketHandler = (payload) => listener(payload as WsEvents[K])
    const name: WsEventName = event // socket.io's listener type cannot resolve a generic name
    let handlers = this.listeners.get(name)
    if (!handlers) {
      handlers = new Set()
      this.listeners.set(name, handlers)
    }
    handlers.add(handler)

    // Attach to the live socket immediately (connected or not — socket.io
    // keeps handlers across reconnects). If no socket exists yet, connect()
    // attaches everything buffered in `listeners` when it creates one.
    this.socket?.on(name, handler)

    return () => {
      const current = this.listeners.get(name)
      current?.delete(handler)
      if (current?.size === 0) this.listeners.delete(name)
      this.socket?.off(name, handler)
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
      debug('WebSocket connected')
      this.reconnectAttempts = 0
      this.updateStatus('connected')

      // Join operations room automatically (rooms ARE reset per connection)
      this.joinRoom('operations')
    })

    this.socket.on('disconnect', (reason) => {
      debug('WebSocket disconnected:', reason)
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
      debug('Server acknowledged connection:', data)
    })

    this.socket.on('joined', (data) => {
      debug('Joined room:', data.room)
    })

    this.socket.on('left', (data) => {
      debug('Left room:', data.room)
    })

    this.socket.on('pong', (data) => {
      debug('Pong received:', data)
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
