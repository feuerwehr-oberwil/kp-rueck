'use client'

import { useSyncExternalStore } from 'react'
import { COMPACT_MAP_QUERY } from '@/lib/map-labels'

/**
 * «Is this a phone-style map?» — phone width or a coarse pointer (a finger cannot hover, so a
 * label that only makes sense with hover-to-front is a heap). Drives the label rule in
 * `lib/map-labels.ts`. Same `useSyncExternalStore` pattern as `useCompactFilters`.
 */
function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}
  const mql = window.matchMedia(COMPACT_MAP_QUERY)
  mql.addEventListener('change', onChange)
  return () => mql.removeEventListener('change', onChange)
}

function getSnapshot(): boolean {
  // No matchMedia (jsdom): the desktop map.
  if (typeof window.matchMedia !== 'function') return false
  return window.matchMedia(COMPACT_MAP_QUERY).matches
}

const getServerSnapshot = () => false

export function useCompactMap(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
