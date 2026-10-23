'use client'

import { useMediaQuery } from '@/lib/hooks/use-media-query'

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

/**
 * True when the primary pointer is fine (mouse, trackpad, pen). The server and
 * jsdom (no matchMedia) answer with today's mouse behaviour; the client corrects
 * it after hydration.
 */
export function usePointerFine(): boolean {
  return useMediaQuery(POINTER_FINE_QUERY, true)
}
