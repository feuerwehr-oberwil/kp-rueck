"use client"

import { useSyncExternalStore } from "react"
import { wsClient } from "@/lib/websocket-client"

const subscribeSocket = (onChange: () => void) => wsClient.onStatusChange(onChange)
const socketConnected = () => wsClient.getStatus() === "connected"

/**
 * The polling part of a query's options, with `usePolling`'s rules (`lib/hooks/use-polling.ts`).
 * Spread it into `useQuery`: `useQuery({ ...options, ...usePollOptions(10_000) })`.
 *
 * - `pauseWhenHidden` (default true): no tick while the tab is hidden, one read the moment it
 *   is visible again. Pass false on the unattended walls (`/display/*`).
 * - `skipWhileWsConnected`: no tick while the socket is up – its events refetch the read
 *   (`socket-bridge.ts`, which also refetches once when the socket comes back).
 *
 * A tick never starts a second read while one is out; the next tick waits for the interval.
 */
export function usePollOptions(
  intervalMs: number,
  { pauseWhenHidden = true, skipWhileWsConnected = false }: { pauseWhenHidden?: boolean; skipWhileWsConnected?: boolean } = {},
) {
  const connected = useSyncExternalStore(subscribeSocket, socketConnected, () => false)
  return {
    refetchInterval: skipWhileWsConnected && connected ? false : intervalMs,
    refetchIntervalInBackground: !pauseWhenHidden,
    refetchOnWindowFocus: pauseWhenHidden,
  } as const
}
