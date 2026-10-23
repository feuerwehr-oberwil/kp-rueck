'use client'

import { useMediaQuery } from '@/lib/hooks/use-media-query'

/**
 * «Is there room for the filter chips?» — a phone, or a window too SHORT for
 * them (a 13" laptop at 1280×640 with the browser chrome).
 *
 * The resource dialog is 80dvh tall. With every chip row wrapped (Grad,
 * Standort, Typ, «Nur zugewiesene»), a short window had more filter rows than
 * resource rows; on a phone the chips ate the screen. Below this, the dialog
 * folds them into ONE «Filtern» menu with an active-filter count and a summary
 * line (#24). Width AND height, because the height is what ran out first on
 * the laptops at the KP.
 */
export const COMPACT_FILTERS_QUERY = '(max-width: 639px), (max-height: 719px)'

/** Server and jsdom (no matchMedia): the desktop chips. */
export function useCompactFilters(): boolean {
  return useMediaQuery(COMPACT_FILTERS_QUERY, false)
}
