'use client'

/**
 * The /feld detail's short line «6  Goldenthalweg 21 · Elementarereignis» that
 * sticks under the top bar once the Schadenplatz's own header has scrolled away
 * (owner pick 2A «Own line under the top bar», 24.11.2026). Four screens into
 * the Rapport, a crew still sees which Schadenplatz they are filing for.
 *
 * Usage: render it as the FIRST child of the detail's content column and pass a
 * ref to the header block it stands in for (the address heading):
 *
 *   <FeldPlaceLine number={6} address="Goldenthalweg 21" type="Elementarereignis" headerRef={ref} />
 *
 * How it sits: a zero-height `position: sticky` box (`BELOW_LINK_PAGE_HEADER_CLASS`)
 * that spans the whole column, with the line hung from it absolutely. Zero
 * height, so it never pushes content down; sticky, so it stays directly under
 * the top bar (z-order and opaque background from the shared class – nothing
 * shows through, and it never overlaps the bar). The line itself renders only
 * once the header has gone under the top bar (`useScrolledUnder`).
 */

import type { RefObject } from 'react'

import { IncidentNumber } from '@/components/ui/incident-number'
import { BELOW_LINK_PAGE_HEADER_CLASS } from '@/components/link-page/link-page'
import { useScrolledUnder } from '@/lib/hooks/use-scrolled-under'
import { cn } from '@/lib/utils'

/** The top bar's height: its 60px row plus the 1px border (`BELOW_LINK_PAGE_HEADER_CLASS`). */
const TOP_BAR_PX = 61

export function FeldPlaceLine({
  number,
  address,
  type,
  headerRef,
}: {
  number?: number | null
  address: string
  /** The Einsatzart; empty when the Schadenplatz has none. */
  type?: string | null
  headerRef: RefObject<HTMLElement | null>
}) {
  const headerGone = useScrolledUnder(headerRef, TOP_BAR_PX)

  return (
    <div className={cn(BELOW_LINK_PAGE_HEADER_CLASS, 'h-0')}>
      {headerGone && (
        <p
          data-testid="feld-place-line"
          className="absolute -inset-x-4 top-0 flex min-w-0 items-baseline gap-2 border-b border-border bg-background px-4 py-2 text-sm"
        >
          <IncidentNumber number={number} className="shrink-0 text-xs" />
          {/* One line: the Einsatzart gives way first, then the address. */}
          <span className="min-w-0 truncate font-semibold" title={address}>
            {address}
          </span>
          {type && (
            <span className="min-w-0 shrink-[4] truncate text-muted-foreground" title={type}>
              · {type}
            </span>
          )}
        </p>
      )}
    </div>
  )
}
