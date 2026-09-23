"use client"

import { useEffect } from "react"
import { wsClient, type WebSocketStatus } from "@/lib/websocket-client"

export interface UsePollingOptions {
  /** Pause between the end of one run and the start of the next. */
  intervalMs: number
  /** False stops polling entirely (and skips the immediate first run). */
  enabled?: boolean
  /**
   * Stop ticking while the tab is hidden and run once the moment it is
   * visible again. Default true.
   *
   * ⚠️ Pass false for the unattended wall screens (`/display/*`). Nobody is
   * there to bring the tab to the front: a kiosk browser that starts behind a
   * screensaver, or reports itself hidden for good, may never fire the
   * `visibilitychange` that would resume it — and a wall that silently stops
   * updating is read as fact by whoever glances at it.
   */
  pauseWhenHidden?: boolean
  /**
   * Don't tick while the WebSocket is connected — the socket pushes the change
   * and the caller refreshes on its event. Runs once when the socket comes
   * (back) up, to pick up whatever was broadcast while it was down, and resumes
   * ticking the moment it drops. Default false.
   */
  skipWhileWsConnected?: boolean
}

/**
 * The one polling loop for components that keep something fresh on a timer.
 *
 * Until 2026-09-23 every such component carried its own `setInterval`, and they
 * all shared the same two faults: they never paused (a board left open in a
 * background tab overnight kept firing ~10 requests every 5 s), and they kept
 * polling data the WebSocket already pushed.
 *
 * Runs `callback` once immediately, then `intervalMs` after each run SETTLES —
 * never two at once, however slow the backend is. It restarts (and runs
 * immediately) when `callback` changes identity, so wrap it in `useCallback`
 * keyed on what should trigger a fresh load. Errors are the caller's to
 * handle; a rejection is swallowed so the loop keeps going.
 */
export function usePolling(
  callback: () => unknown,
  { intervalMs, enabled = true, pauseWhenHidden = true, skipWhileWsConnected = false }: UsePollingOptions,
): void {
  useEffect(() => {
    if (!enabled) return

    let disposed = false
    let running = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const isHidden = () =>
      pauseWhenHidden && typeof document !== "undefined" && document.visibilityState === "hidden"
    const socketCarries = () => skipWhileWsConnected && wsClient.getStatus() === "connected"

    const clearTimer = () => {
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
    }

    const schedule = () => {
      clearTimer()
      if (disposed || running || isHidden() || socketCarries()) return
      timer = setTimeout(() => {
        timer = undefined
        void run()
      }, intervalMs)
    }

    const run = async () => {
      if (disposed || running) return
      running = true
      try {
        await callback()
      } catch {
        // The caller's concern; the loop must survive it.
      } finally {
        running = false
        schedule()
      }
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void run()
      else clearTimer()
    }
    if (pauseWhenHidden) document.addEventListener("visibilitychange", onVisibilityChange)

    let lastStatus: WebSocketStatus = wsClient.getStatus()
    const unsubscribeStatus = skipWhileWsConnected
      ? wsClient.onStatusChange((status) => {
          if (status === lastStatus) return // the subscription replays the current status
          lastStatus = status
          if (status === "connected") {
            clearTimer()
            void run()
          } else if (timer === undefined) {
            schedule()
          }
        })
      : () => {}

    void run()

    return () => {
      disposed = true
      clearTimer()
      if (pauseWhenHidden) document.removeEventListener("visibilitychange", onVisibilityChange)
      unsubscribeStatus()
    }
  }, [callback, intervalMs, enabled, pauseWhenHidden, skipWhileWsConnected])
}
