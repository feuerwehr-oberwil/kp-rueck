"use client"

import { useEffect, useCallback, useRef } from "react"
import { useEvent } from "@/lib/contexts/event-context"

// ── Message types ──────────────────────────────────────────────

export type SyncMessageType =
  | "incident:selected"
  | "incident:updated"
  | "incident:created"

export interface SyncMessage {
  type: SyncMessageType
  /** The incident ID this message refers to */
  incidentId: string | null
  /** Sender window ID so we can ignore our own messages */
  senderId: string
  /** Timestamp for ordering */
  timestamp: number
}

// ── Listener callback ──────────────────────────────────────────

export type SyncListener = (message: SyncMessage) => void

// ── Unique window ID (stable for the lifetime of the tab) ──────

const WINDOW_ID =
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2)

// ── Hook ───────────────────────────────────────────────────────

interface UseCrossWindowSyncOptions {
  /** Called when another window sends a message */
  onMessage?: SyncListener
  /** Whether to listen for messages (default true) */
  enabled?: boolean
}

/**
 * Cross-window synchronisation via BroadcastChannel.
 *
 * Channel is scoped per event ID so multiple events don't interfere.
 * Bidirectional: every window can both send and receive.
 *
 * Usage:
 * ```ts
 * const { broadcast } = useCrossWindowSync({
 *   onMessage: (msg) => {
 *     if (msg.type === "incident:selected") setSelectedId(msg.incidentId)
 *   },
 * })
 *
 * // When user selects an incident:
 * broadcast("incident:selected", incidentId)
 * ```
 */
export function useCrossWindowSync({
  onMessage,
  enabled = true,
}: UseCrossWindowSyncOptions = {}) {
  const { selectedEvent } = useEvent()
  const channelRef = useRef<BroadcastChannel | null>(null)
  const onMessageRef = useRef(onMessage)

  // Keep callback ref in sync without re-creating the channel
  useEffect(() => {
    onMessageRef.current = onMessage
  }, [onMessage])

  // Open / close channel when event changes
  useEffect(() => {
    if (!enabled || !selectedEvent?.id || typeof BroadcastChannel === "undefined") {
      return
    }

    const channelName = `kp-rueck-sync-${selectedEvent.id}`
    const channel = new BroadcastChannel(channelName)
    channelRef.current = channel

    channel.onmessage = (event: MessageEvent<SyncMessage>) => {
      const msg = event.data
      // Ignore own messages
      if (msg.senderId === WINDOW_ID) return
      onMessageRef.current?.(msg)
    }

    return () => {
      channel.close()
      channelRef.current = null
    }
  }, [selectedEvent?.id, enabled])

  const broadcast = useCallback(
    (type: SyncMessageType, incidentId: string | null) => {
      channelRef.current?.postMessage({
        type,
        incidentId,
        senderId: WINDOW_ID,
        timestamp: Date.now(),
      } satisfies SyncMessage)
    },
    [],
  )

  return { broadcast }
}
