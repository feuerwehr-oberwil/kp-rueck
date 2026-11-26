"use client"

import type { ReactNode } from "react"
import { useTranslations } from "next-intl"
import { Truck } from "lucide-react"
import { IncidentNumber } from "@/components/ui/incident-number"
import { PriorityGlyph } from "@/components/ui/priority-glyph"
import { SearchInput } from "@/components/ui/search-input"
import type { Operation } from "@/lib/contexts/operations/types"
import { getIncidentRefLabel } from "@/lib/incident-types"
import type { MapIncident } from "@/lib/map-incident"
import { isIncidentStatus } from "@/lib/types/incidents"

/**
 * The phone Lagekarte's search row (owner pick 3A, 24.11.2026; MapView `floating.top`): the field
 * on the floating family's card surface, «Ansicht» beside it, and the hits hanging under both.
 * A picked hit closes the hits, empties the field and goes to `onPick`.
 */
export function PhoneMapSearch({
  query,
  onQueryChange,
  hitsOpen,
  onHitsOpenChange,
  hits,
  onPick,
  viewMenu,
  formatLocation,
}: {
  query: string
  onQueryChange: (query: string) => void
  hitsOpen: boolean
  onHitsOpenChange: (open: boolean) => void
  hits: MapIncident[]
  onPick: (incidentId: string) => void
  viewMenu: ReactNode
  formatLocation: (fullAddress: string) => string
}) {
  const t = useTranslations('map')
  const tKanban = useTranslations('kanban')
  const pick = (incidentId: string) => {
    onHitsOpenChange(false)
    onQueryChange("")
    ;(document.activeElement as HTMLElement | null)?.blur()
    onPick(incidentId)
  }
  return (
    <div className="relative min-w-0 flex-1">
      <div className="flex items-center gap-2">
        <SearchInput
          id="map-search-input"
          // The surface on the wrapper: on the field it would cover the magnifier drawn under it.
          containerClassName="min-w-0 flex-1 rounded-md bg-card/95 shadow-md backdrop-blur-sm"
          className="border-border"
          placeholder={t('page.searchPlaceholderPhone')}
          value={query}
          onValueChange={(value) => {
            onQueryChange(value)
            onHitsOpenChange(true)
          }}
          onFocus={() => onHitsOpenChange(true)}
          // Escape closes the hits with the keyboard (the page's handler blurs the field).
          onKeyDown={(event) => { if (event.key === 'Escape') onHitsOpenChange(false) }}
          aria-controls="map-search-hits"
        />
        {viewMenu}
      </div>
      {hitsOpen && query && (
        <ul
          id="map-search-hits"
          aria-label={t('page.searchHits')}
          // Ends inside the visible band (`--vv-*`, lib/viewport-insets.ts): iOS never shrinks the
          // layout for the keyboard, so a `dvh` cap left the last hits under the keys. Its own top
          // (layout px) is measured as it opens – a banner above the map moves it down.
          ref={(list) => {
            if (list) list.style.setProperty('--hits-top', `${list.getBoundingClientRect().top + window.scrollY}px`)
          }}
          className="absolute inset-x-0 top-full mt-2 max-h-[min(20rem,calc(var(--vv-top,0px)+var(--vv-height,100dvh)-var(--hits-top,9.5rem)-0.5rem))] overflow-y-auto overscroll-contain rounded-md border border-border bg-card p-1 shadow-lg"
        >
          {hits.map((incident) => (
            <li key={incident.id}>
              <button
                type="button"
                onClick={() => pick(incident.id)}
                className="flex min-h-11 w-full items-center gap-2 rounded-sm px-2 text-left hover:bg-muted"
              >
                <PriorityGlyph priority={incident.priority ?? 'low'} size="wall" />
                <span
                  className="min-w-0 flex-1 truncate text-sm font-medium"
                  title={incident.location_address ? formatLocation(incident.location_address) : incident.title}
                >
                  <IncidentNumber number={incident.number} className="mr-1.5 text-xs" />
                  {incident.location_address ? formatLocation(incident.location_address) : incident.title}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {isIncidentStatus(incident.status) ? tKanban(`columns.${incident.status}`) : null}
                </span>
              </button>
            </li>
          ))}
          {hits.length === 0 && (
            <li className="px-2 py-3 text-center text-sm text-muted-foreground">{t('page.noSearchHits')}</li>
          )}
        </ul>
      )}
    </div>
  )
}

/**
 * The phone's count chip (MapView `topRightControls`): the Einsätze the map shows, and the open
 * Abholungen – a tap on those goes to `nextPickup` (`nextPickupId`), its peek and its chip.
 */
export function PhoneMapCountChip({
  shownCount,
  pickupCount,
  nextPickup,
  onFocusIncident,
}: {
  shownCount: number
  pickupCount: number
  nextPickup: Operation | undefined
  onFocusIncident: (incidentId: string) => void
}) {
  const t = useTranslations('map')
  return (
    <div
      data-testid="map-count-chip"
      className="flex h-9 items-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-card/95 pl-3 pr-1 text-xs font-medium text-foreground shadow-md backdrop-blur-sm"
    >
      <span className={`tabular-nums ${nextPickup ? '' : 'pr-2'}`}>
        {t('page.activeBadge', { count: shownCount })}
      </span>
      {nextPickup && (
        <>
          <span aria-hidden="true" className="text-muted-foreground">·</span>
          <button
            type="button"
            onClick={() => onFocusIncident(nextPickup.id)}
            // The visible words first, so voice control finds the button by what it says.
            aria-label={`${t('page.pickupCount', { count: pickupCount })} – ${t('page.nextPickup', { incident: getIncidentRefLabel(nextPickup, 40) })}`}
            className="flex h-7 items-center gap-1 rounded-full px-2 font-semibold text-warning-foreground hover:bg-muted"
          >
            <Truck className="size-3.5" aria-hidden="true" />
            <span className="tabular-nums">{t('page.pickupCount', { count: pickupCount })}</span>
          </button>
        </>
      )}
    </div>
  )
}
