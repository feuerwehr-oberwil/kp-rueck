'use client'

import { useEffect } from 'react'

/** The class on `<html>` while a /feld route is mounted (globals.css). */
export const FELD_NO_ZOOM_CLASS = 'feld-no-zoom'

/**
 * The zoom guard of the /feld routes (see app/feld/layout.tsx), for as long as one is mounted:
 *
 * - `html.feld-no-zoom` → `touch-action: pan-x pan-y` (no pinch, no double-tap zoom; scrolling
 *   and a map's own JS gestures are untouched) and every field at ≥ 16px (no focus zoom).
 * - iOS Safari's proprietary `gesturestart` is cancelled: the one pinch path touch-action does
 *   not close on older iOS.
 *
 * Removed on unmount, so the board behind a client navigation keeps its zoom.
 */
export function FeldNoZoom() {
  useEffect(() => {
    const root = document.documentElement
    root.classList.add(FELD_NO_ZOOM_CLASS)
    const block = (event: Event) => event.preventDefault()
    document.addEventListener('gesturestart', block, { passive: false })
    return () => {
      root.classList.remove(FELD_NO_ZOOM_CLASS)
      document.removeEventListener('gesturestart', block)
    }
  }, [])
  return null
}
