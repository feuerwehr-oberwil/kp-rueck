'use client'

import { useMediaQuery } from '@/lib/hooks/use-media-query'
import { COMPACT_MAP_QUERY } from '@/lib/map-labels'

/**
 * «Is this a phone-style map?» — phone width or a coarse pointer (a finger cannot hover, so a
 * label that only makes sense with hover-to-front is a heap). Drives the label rule in
 * `lib/map-labels.ts`. Server and jsdom (no matchMedia): the desktop map.
 */
export function useCompactMap(): boolean {
  return useMediaQuery(COMPACT_MAP_QUERY, false)
}
