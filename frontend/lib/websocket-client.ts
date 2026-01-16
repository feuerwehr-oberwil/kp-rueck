/**
 * WebSocket client for real-time updates
 */

import { io, Socket } from 'socket.io-client'
import { getApiUrl } from './env'

export type WebSocketStatus = 'connecting' | 'connected' | 'disconnected' | 'error'

export interface WebSocketUpdate<T = any> {
  action: 'create' | 'update' | 'delete'
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

  /**
   * Connect to the WebSocket server
   */
  connect() {
    if (this.socket?.connected) {
      console.log('WebSocket already connected')
      return
    }

    const wsUrl = getApiUrl().replace(/^http/, 'ws')

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
    this.updateStatus('connecting')
  }

  /**
   * Disconnect from the WebSocket server
   */
  disconnect() {
    if (this.socket) {
      this.socket.disconnect()
      this.socket = null
      this.updateStatus('disconnected')
    }
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

    // If socket is already connected, attach listener immediately
    if (this.socket?.connected) {
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

    // Connection events
    this.socket.on('connect', () => {
      console.log('WebSocket connected')
      this.reconnectAttempts = 0
      this.updateStatus('connected')

      // Join operations room automatically
      this.joinRoom('operations')

      // Re-attach all listeners
      this.listeners.forEach((callbacks, event) => {
        callbacks.forEach(callback => {
          this.socket!.on(event, callback as any)
        })
      })
    })

    this.socket.on('disconnect', (reason) => {
      console.log('WebSocket disconnected:', reason)
      this.updateStatus('disconnected')
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

    // Keep-alive ping every 30 seconds
    setInterval(() => {
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