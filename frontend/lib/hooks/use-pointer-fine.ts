'use client'

import { useSyncExternalStore } from 'react'

/**
 * The media query that means «there is a mouse (or pen) to hover with».
 *
 * The SAME string Tailwind's `pointer-fine:` variant compiles to — the chip's
 * CSS hides its ✕ with that variant and its JS decides with this query whether
 * a tap opens the chip menu instead. If the two ever disagreed, one device class
 * would get neither (no ✕ and no menu) or both.
 *
 * It replaces the `sm:` breakpoint the chips used as «has a mouse»: a 1180 px
 * command-post tablet is well past `sm`, so it got the desktop hover-reveal ✕ —
 * invisible, and still live under a finger (decision 27 B, 2026-09-23).
 */
export const POINTER_FINE_QUERY = '(pointer: fine)'

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}
  const mql = window.matchMedia(POINTER_FINE_QUERY)
  mql.addEventListener('change', onChange)
  return () => mql.removeEventListener('change', onChange)
}

function getSnapshot(): boolean {
  // No matchMedia (jsdom, very old browsers): today's mouse behaviour.
  if (typeof window.matchMedia !== 'function') return true
  return window.matchMedia(POINTER_FINE_QUERY).matches
}

// The server has no pointer; render the mouse variant and let the client
// correct it after hydration (useSyncExternalStore re-renders on mismatch).
const getServerSnapshot = () => true

/** True when the primary pointer is fine (mouse, trackpad, pen). */
export function usePointerFine(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
