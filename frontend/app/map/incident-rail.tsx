"use client"

import type { ReactNode } from "react"
import { useTranslations } from "next-intl"
import { Binoculars, FileText, Milestone } from "lucide-react"
import { PickupBadge } from "@/components/kanban/pickup-badge"
import { statusGroupCaption } from "@/components/map-legend"
import { IncidentNumber } from "@/components/ui/incident-number"
import { IncidentTimeRow } from "@/components/ui/incident-time"
import { Kbd } from "@/components/ui/kbd"
import { PriorityGlyph } from "@/components/ui/priority-glyph"
import { Reveal } from "@/components/ui/reveal"
import { ScrollEndFade } from "@/components/ui/scroll-end-fade"
import { SearchInput } from "@/components/ui/search-input"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { Operation } from "@/lib/contexts/operations/types"
import { incidentTimeSource } from "@/lib/incident-time"
import type { MapIncident } from "@/lib/map-incident"
import type { StatusGroup } from "@/lib/types/incidents"
import { RAIL_TOOL } from "./view-menu"

/**
 * The desk rail's Einsätze list – what the rail shows while neither editor mode has it: a fixed
 * header (title, «Ansicht», the two editor modes, the search) outside the scroller, so it never
 * moves – no sticky, no overscroll spring – and the one-line rows in status sections below.
 * A section heading toggles its status group, for the list AND the map markers.
 */
export function MapIncidentRail({
  viewMenu,
  isEditor,
  onEnterPlanning,
  onEnterReko,
  searchQuery,
  onSearchQueryChange,
  sections,
  statusFilters,
  onToggleStatusGroup,
  statusGroupCounts,
  shownCount,
  selectedIncidentId,
  operationsById,
  formatLocation,
  onIncidentClick,
  onOpenDetail,
}: {
  viewMenu: ReactNode
  isEditor: boolean
  onEnterPlanning: () => void
  onEnterReko: () => void
  searchQuery: string
  onSearchQueryChange: (query: string) => void
  /** The searched Einsätze by status group, each in list order. */
  sections: Record<StatusGroup, MapIncident[]>
  statusFilters: Record<StatusGroup, boolean>
  onToggleStatusGroup: (group: StatusGroup) => void
  statusGroupCounts: Record<StatusGroup, number>
  /** Shown and searched – zero says «no active Einsätze». */
  shownCount: number
  selectedIncidentId: string | null
  operationsById: ReadonlyMap<string, Operation>
  formatLocation: (fullAddress: string) => string
  onIncidentClick: (incidentId: string) => void
  onOpenDetail: (incidentId: string) => void
}) {
  const t = useTranslations('map')
  return (
    <>
      {/* Fixed header: title through search live outside the scroll
          container below, so they simply never move. */}
      <div className="flex-shrink-0 p-4 pb-3 border-b border-border/50">
      <div className="mb-3 flex items-center justify-between gap-2">
        {/* No count: the header's «18 Einsätze» says it, and the heading
            repeating it read twice (hill climb r20). */}
        <h2 className="min-w-0 text-lg font-bold">{t('page.incidentsHeadingPlain')}</h2>
        {viewMenu}
      </div>

      {/* No pill row any more: the list's section headings ARE the
          status filter (they toggle the same `statusFilters`, list and
          map together). View options and modes keep their own buttons
          below so the control families read apart. The two editor modes
          are desktop-only (owner, 24.11.2026). */}
      {isEditor && (
      <div className="mb-3 flex flex-wrap gap-1.5">
        {/* The two editor modes, as direct buttons — a dropdown for
            exactly two entries was a click to see two words. Both swap
            the sidebar for their panel; the same squared tool shape as
            «Ansicht» so tools read apart from the list's filters. */}
        <button
          className={`${RAIL_TOOL} border-border bg-muted/50 text-muted-foreground hover:bg-muted`}
          onClick={() => onEnterPlanning()}
        >
          <Milestone className="h-3 w-3" />
          {t('page.routePlanning')}
        </button>
        <button
          className={`${RAIL_TOOL} border-border bg-muted/50 text-muted-foreground hover:bg-muted`}
          onClick={() => onEnterReko()}
        >
          <Binoculars className="h-3 w-3" />
          {t('rekoMode.title')}
        </button>
      </div>
      )}

      <SearchInput
        id="map-search-input"
        placeholder={t('page.searchPlaceholder')}
        value={searchQuery}
        onValueChange={onSearchQueryChange}
        hint={<Kbd>S</Kbd>}
      />
      </div>

      {/* No bottom padding of its own: the closing `ScrollEndFade` is the end (r21). */}
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-2 pt-3">
      {/* One-line rows in sections. The rail stopped repeating the
          board's cards: detail lives on the marker's hover card and
          behind «Details anzeigen» (double-click, or the icon that
          appears on hover). */}
      <div className="space-y-3">
        {(['open', 'active', 'completed'] as StatusGroup[]).map((group) => {
          const rows = sections[group]
          const enabled = statusFilters[group]
          const caption = statusGroupCaption(t(`statusGroups.${group}`), t(`statusGroups.${group}Members`))
          return (
            // ONE dimming: the muted text itself. A folded group used to
            // add opacity-60 on top of a `/70` line (1.8:1, sweep
            // 2026-10); the turned caret already says «folded». The fold
            // mark is a FILLED 8px caret (▸/▾) – the rows below lead with a
            // stroked priority chevron in the same column, and one glyph for
            // both read «OFFEN» as a Niedrig row (hill climb r23).
            <div key={group}>
              <button
                onClick={() => onToggleStatusGroup(group)}
                aria-expanded={enabled}
                className="relative hit-area flex w-full items-center gap-1 px-2 py-1 text-2xs font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
              >
                <svg
                  viewBox="0 0 8 8"
                  aria-hidden="true"
                  className={`mx-0.5 size-2 shrink-0 fill-current transition-transform ${enabled ? 'rotate-90' : ''}`}
                >
                  <path d="M2 0.5 L6.5 4 L2 7.5 Z" />
                </svg>
                {t(`statusGroups.${group}`)} · {statusGroupCounts[group]}
              </button>
              {/* Which board columns feed this section. A group name is
                  shorter than the statuses it stands for, and on its own
                  it left the operator guessing whether «Rückfahrt»
                  counted as finished — so the section says so, unless the
                  name already lists them (`statusGroupCaption`). */}
              {caption && (
                <p className="px-2 pb-1 text-2xs leading-tight text-muted-foreground">{caption}</p>
              )}
              <Reveal open={enabled && rows.length > 0}>
                <div className="space-y-0.5">
                  {rows.map((incident) => {
                    const isSelected = selectedIncidentId === incident.id
                    const priority = incident.priority ?? 'low'
                    const priorityLabel = priority === 'high' ? t('common.priorityHigh') : priority === 'medium' ? t('common.priorityMedium') : t('common.priorityLow')
                    // Pickup flags live on the Operation, one lookup away.
                    const operation = operationsById.get(incident.id)
                    return (
                      <div key={incident.id}>
                        <div
                          id={`map-incident-card-${incident.id}`}
                          onClick={() => onIncidentClick(incident.id)}
                          onDoubleClick={() => onOpenDetail(incident.id)}
                          // ONE selected state (A2): the selection wash, nothing else. It
                          // was a grey wash plus a 2px bar inset 4px top and
                          // bottom — two shapes that never lined up (owner, 02.10.).
                          className={`group relative flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 transition-colors ${
                            isSelected ? 'bg-sel-wash' : 'hover:bg-muted/50'
                          }`}
                          aria-current={isSelected ? 'true' : undefined}
                        >
                          {/* Priority as the shared `PriorityGlyph` (the marker's own
                              path) – never a colour dot alone – at the 14px / 2px
                              drawing in a 16px gutter: lucide's dash read as a list
                              hyphen, its chevron as the group's fold mark (r23). One
                              priority colour everywhere (COL-03), so the rail's tint is
                              the board's. The glyph names itself; the span only adds the
                              hover word. */}
                          <span className="flex-shrink-0" title={priorityLabel}>
                            <PriorityGlyph priority={priority} size="wall" />
                          </span>
                          <span
                            className="min-w-0 flex-1 truncate text-[13px] font-medium"
                            title={incident.location_address ? formatLocation(incident.location_address) : incident.title}
                          >
                            <IncidentNumber number={incident.number} className="mr-1.5 text-xs" />
                            {incident.location_address ? formatLocation(incident.location_address) : incident.title}
                          </span>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  onOpenDetail(incident.id)
                                }}
                                // Always shown on the selected row: hover-only, the row's one
                                // visible way in stayed hidden until the pointer found it.
                                className={`flex-shrink-0 rounded p-1 hover:bg-background/80 ${isSelected ? 'block' : 'hidden group-hover:block'}`}
                                aria-label={t('page.showDetails')}
                              >
                                <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent>{t('page.showDetails')}</TooltipContent>
                          </Tooltip>
                          <IncidentTimeRow
                            operation={incidentTimeSource(incident)}
                            colorByAge
                            className="flex-shrink-0"
                          />
                        </div>
                        {/* The pickup chip survives — it IS the
                            «Abholung disponiert» control (decision 24).
                            On the selected row only: everywhere else
                            the row stays one quiet line. */}
                        {isSelected && operation?.pickupNeeded && (
                          <PickupBadge
                            requestedAt={operation.pickupRequestedAt}
                            note={operation.pickupNote}
                            incidentId={incident.id}
                            canEdit={isEditor}
                            className="mb-1 ml-6 mt-0.5"
                          />
                        )}
                      </div>
                    )
                  })}
                </div>
              </Reveal>
            </div>
          )
        })}
        {shownCount === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {t('common.noActiveIncidents')}
          </p>
        )}
      </div>
      <ScrollEndFade surface="panel" />
      </div>
    </>
  )
}
