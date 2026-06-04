"use client"

import { useEffect, useRef, useSyncExternalStore } from "react"
import { usePathname } from "next/navigation"

// ── Module-level controller ────────────────────────────────────────────────
// A tiny external store so any code (route changes, data fetches) can drive the
// bar imperatively via topLoading.start()/done() — no context plumbing needed.
// Ref-counted, so concurrent loads keep the bar alive until the last one ends.

interface BarState {
  progress: number
  active: boolean
}

const IDLE: BarState = { progress: 0, active: false }

let state: BarState = IDLE
let count = 0
let trickle: ReturnType<typeof setInterval> | null = null
let finishTimer: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((l) => l())
}

function setProgress(p: number) {
  state = { progress: p, active: true }
  emit()
}

function stopTrickle() {
  if (trickle) {
    clearInterval(trickle)
    trickle = null
  }
}

export const topLoading = {
  /** Begin (or join) a load. The bar jumps in, then creeps toward 90%. */
  start() {
    count += 1
    if (count > 1) return
    if (finishTimer) {
      clearTimeout(finishTimer)
      finishTimer = null
    }
    setProgress(8)
    stopTrickle()
    trickle = setInterval(() => {
      // Ease toward 90% with shrinking steps — never quite arrives until done().
      const remaining = 90 - state.progress
      if (remaining <= 0.5) return
      setProgress(state.progress + Math.max(0.4, remaining * 0.12))
    }, 280)
  },

  /** Finish one load. When the last finishes, snap to 100% and fade out. */
  done() {
    if (count === 0) return
    count -= 1
    if (count > 0) return
    stopTrickle()
    setProgress(100)
    finishTimer = setTimeout(() => {
      state = IDLE
      emit()
    }, 260)
  },

  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },

  snapshot() {
    return state
  },
}

// ── Visual ─────────────────────────────────────────────────────────────────

/**
 * Thin progress bar pinned to the top of the viewport. Fires automatically on
 * route changes and can be driven by data fetches via `topLoading`. Calm and
 * minimal: a 2px primary line, no spinner chrome.
 */
export function TopLoadingBar() {
  const state = useSyncExternalStore(
    topLoading.subscribe,
    topLoading.snapshot,
    () => IDLE,
  )
  const pathname = usePathname()
  const prevPath = useRef(pathname)

  // Route change → run the bar. A real data load on the new page (which also
  // calls start/done) keeps it alive; otherwise this fallback finishes it.
  useEffect(() => {
    if (prevPath.current === pathname) return
    prevPath.current = pathname
    topLoading.start()
    const t = setTimeout(() => topLoading.done(), 500)
    return () => clearTimeout(t)
  }, [pathname])

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-0.5"
    >
      <div
        className="h-full bg-primary transition-[width,opacity] duration-200 ease-out"
        style={{
          width: `${state.progress}%`,
          opacity: state.active ? 1 : 0,
          boxShadow: "0 0 8px var(--primary)",
        }}
      />
    </div>
  )
}
