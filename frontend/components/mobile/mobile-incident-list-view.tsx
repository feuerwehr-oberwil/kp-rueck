"use client"

import { useState, useMemo, useRef, useEffect } from "react"
import { useTranslations } from "next-intl"
import Link from "next/link"
import { SearchInput } from "@/components/ui/search-input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Filter, Plus, Sparkles, X } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { EmptyState } from "@/components/ui/empty-state"
import { type Operation, type Material } from "@/lib/contexts/operations-context"
import { useEvent } from "@/lib/contexts/event-context"
import { useVehicleDrivers } from "@/lib/hooks/use-vehicle-drivers"
import { getIncidentTypeLabel } from "@/lib/incident-types"
import { MobileIncidentCard } from "./mobile-incident-card"
import { MobileIncidentDetailSheet } from "./mobile-incident-detail-sheet"

interface MobileIncidentListViewProps {
  operations: Operation[]
  materials: Material[]
  formatLocation: (address: string) => string
  onUpdateOperation?: (id: string, updates: Partial<Operation>) => void
  isEditor?: boolean
  isTraining?: boolean
  isLoading?: boolean
  /** Opens «Neuer Einsatz» (the keyboard-aware bottom sheet). Editors only — pass it only to them. */
  onNewIncident?: () => void
}

// Status order for sorting (active incidents first)
const statusOrder: Record<string, number> = {
  active: 0,
  enroute: 1,
  incoming: 2,
  reko: 3,
  reko_done: 4,
  returning: 5,
  complete: 6,
}

/** The list's search — also asked on its own, so an empty list can tell «the
 *  search found nothing» from «the status filter hides what it found». */
function matchesSearch(op: Operation, raw: string): boolean {
  const query = raw.trim().toLowerCase()
  if (!query) return true
  return (
    op.location.toLowerCase().includes(query) ||
    op.incidentType.toLowerCase().includes(query) ||
    getIncidentTypeLabel(op.incidentType).toLowerCase().includes(query) ||
    op.vehicles.some(v => v.toLowerCase().includes(query)) ||
    op.crew.some(c => c.toLowerCase().includes(query)) ||
    op.id.toLowerCase().includes(query)
  )
}

// Status groups for filtering — labels render via t(`filters.${id}`). One row each in the
// funnel menu; ticking several shows the union.
const statusGroups = [
  { id: "active", statuses: ["active", "enroute"] },
  { id: "incoming", statuses: ["incoming", "reko", "reko_done"] },
  { id: "returning", statuses: ["returning"] },
  { id: "complete", statuses: ["complete"] },
]

export function MobileIncidentListView({
  operations,
  materials,
  formatLocation,
  onUpdateOperation,
  isEditor = false,
  isTraining = false,
  isLoading = false,
  onNewIncident,
}: MobileIncidentListViewProps) {
  const t = useTranslations('incidents.mobileList')
  const tEmpty = useTranslations('common.emptyState')
  const { selectedEvent } = useEvent()
  // Fetched ONCE for the list and passed into every card — the rich card rows
  // (image #21) name each vehicle's driver.
  const vehicleDrivers = useVehicleDrivers(selectedEvent?.id ?? null)
  const [searchQuery, setSearchQuery] = useState("")
  // The id, not the object: the sheet used to hold a snapshot taken at tap
  // time, so anything that changed underneath it while it was open (a status
  // moved on the board, a pickup the KP cleared) stayed on screen until it was
  // closed and re-opened.
  const [selectedOperationId, setSelectedOperationId] = useState<string | null>(null)
  const [detailSheetOpen, setDetailSheetOpen] = useState(false)
  // The ticked status groups (ids from `statusGroups`); empty = everything.
  const [ticked, setTicked] = useState<ReadonlySet<string>>(() => new Set())
  const filtering = ticked.size > 0
  const searchRef = useRef<HTMLInputElement>(null)
  // The footer's measured height, published on the root as `--list-foot` so the list's scroll
  // reserve can account for it while the keyboard is up (see the scroller's padding).
  const rootRef = useRef<HTMLDivElement>(null)
  const footRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const root = rootRef.current
    const foot = footRef.current
    if (!root) return
    if (!foot) {
      root.style.setProperty('--list-foot', '0px')
      return
    }
    const measure = () => root.style.setProperty('--list-foot', `${foot.getBoundingClientRect().height}px`)
    measure()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    ro?.observe(foot)
    return () => ro?.disconnect()
  }, [onNewIncident])

  // Filter and sort operations
  const filteredOperations = useMemo(() => {
    let filtered = operations

    // Apply the status filter: any ticked group
    if (ticked.size > 0) {
      const statuses = new Set(statusGroups.filter(g => ticked.has(g.id)).flatMap(g => g.statuses))
      filtered = filtered.filter(op => statuses.has(op.status))
    }

    // Apply search filter
    if (searchQuery.trim()) {
      filtered = filtered.filter((op) => matchesSearch(op, searchQuery))
    }

    // Sort by status order, then by priority, then by time
    return [...filtered].sort((a, b) => {
      // First by status
      const statusDiff = (statusOrder[a.status] ?? 99) - (statusOrder[b.status] ?? 99)
      if (statusDiff !== 0) return statusDiff

      // Then by priority (high first)
      const priorityOrder = { high: 0, medium: 1, low: 2 }
      const priorityDiff = (priorityOrder[a.priority as keyof typeof priorityOrder] ?? 1) -
                          (priorityOrder[b.priority as keyof typeof priorityOrder] ?? 1)
      if (priorityDiff !== 0) return priorityDiff

      // Then by time (newest first)
      return b.dispatchTime.getTime() - a.dispatchTime.getTime()
    })
  }, [operations, searchQuery, ticked])

  // The menu's counts: over what the list would show WITHOUT the ticks (the search applies), so
  // a row's number is what ticking it adds — KP Front's Verlauf filter does the same.
  const searchHits = useMemo(
    () => operations.filter(op => matchesSearch(op, searchQuery)),
    [operations, searchQuery],
  )
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    statusGroups.forEach(group => {
      counts[group.id] = searchHits.filter(op => group.statuses.includes(op.status)).length
    })
    return counts
  }, [searchHits])
  const tickedLabels = statusGroups.filter(g => ticked.has(g.id)).map(g => t(`filters.${g.id}`)).join(' · ')
  const toggleGroup = (id: string, on: boolean) =>
    setTicked(prev => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  const showAll = () => setTicked(new Set())

  const selectedOperation = useMemo(
    () => operations.find((op) => op.id === selectedOperationId) ?? null,
    [operations, selectedOperationId],
  )

  const handleCardClick = (operation: Operation) => {
    setSelectedOperationId(operation.id)
    setDetailSheetOpen(true)
  }

  return (
    // Stands ABOVE the fixed bottom nav: its measured height is this column's bottom padding,
    // so the footer and the list's end sit on the nav's top edge, never behind it.
    <div ref={rootRef} className="flex flex-col h-full pb-[var(--nav-reserve,0px)]">
      {/* Fixed Header with Search */}
      <div className="flex-shrink-0 px-4 pt-4 pb-3 bg-background sticky top-0 z-10 border-b border-border/50">
        {/* Current event as context — the top navbar is hidden on mobile, so the
            event name lives here; switching happens via the bottom nav. */}
        {selectedEvent && (
          <div className="flex items-center gap-2 mb-3 min-w-0">
            <h1 className="text-lg font-bold tracking-tight truncate">{selectedEvent.name}</h1>
            {selectedEvent.training_flag && (
              <Badge variant="secondary" className="flex-shrink-0">{t('trainingBadge')}</Badge>
            )}
          </div>
        )}

        {/* Primary mobile task for training events: spawn a new training incident.
            Surfaced prominently here so it's one tap away instead of buried in
            the "Mehr" sheet → Übungs-Steuerung. Editor-only (spawning needs edit rights).
            It stays up here and does not join «Neuer Einsatz» in the footer: side by side at
            390px each half is ~175px, and «Übungs-Einsatz erstellen» needs ~230px — two
            truncated labels would be worse than one action per place. */}
        {isTraining && isEditor && (
          <Link href="/training" className="mb-3 block">
            <Button variant="outline" className="w-full min-h-[48px] gap-2">
              <Sparkles className="h-4 w-4" />
              {t('createTrainingIncident')}
            </Button>
          </Link>
        )}

        {/* Search + ONE funnel (owner, 02.10.2026 — like KP Front's Verlauf): the chip row it
            replaces ran off the right edge at 390px. The funnel is a square that never changes
            width; an active filter is the slate choice state, and WHAT is ticked is in its name
            and in the line below — never printed on the button. */}
        <div className="flex items-center gap-2">
          <SearchInput
            ref={searchRef}
            containerClassName="min-w-0 flex-1"
            placeholder={t('searchPlaceholder')}
            value={searchQuery}
            onValueChange={setSearchQuery}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant={filtering ? "selected" : "outline"}
                size="icon"
                className="size-11 shrink-0"
                aria-label={filtering ? t('filterOn', { filters: tickedLabels }) : t('filter')}
                title={filtering ? t('filterOn', { filters: tickedLabels }) : t('filter')}
              >
                <Filter aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              {/* «Alle zeigen» only while something is ticked; it is an action and closes the menu.
                  The rows are checkboxes and keep it open — a selection is several ticks. */}
              {filtering && (
                <>
                  <DropdownMenuItem onSelect={showAll} className="min-h-11">
                    <span className="flex-1">{t('showAll')}</span>
                    <span className="tabular-nums text-muted-foreground">{searchHits.length}</span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuLabel className="text-xs text-muted-foreground">{t('filterGroupStatus')}</DropdownMenuLabel>
              {statusGroups.map(group => (
                <DropdownMenuCheckboxItem
                  key={group.id}
                  checked={ticked.has(group.id)}
                  onCheckedChange={(on) => toggleGroup(group.id, on === true)}
                  onSelect={(event) => event.preventDefault()}
                  className="min-h-11 data-[state=checked]:sel-choice"
                >
                  <span className="flex-1">{t(`filters.${group.id}`)}</span>
                  <span className="tabular-nums text-muted-foreground">{statusCounts[group.id]}</span>
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* What is filtered, readable without opening the menu, and the one way back — not
            twice: an emptied list offers the same «Alle zeigen» as its one action. */}
        {filtering ? (
          <div className="mt-1 -mb-1 flex min-h-8 min-w-0 items-center gap-2 text-xs text-muted-foreground" data-testid="filter-summary">
            <span className="min-w-0 truncate">{t('filterSummary', { filters: tickedLabels })}</span>
            {filteredOperations.length > 0 && (
              <button
                type="button"
                onClick={showAll}
                className="inline-flex min-h-8 shrink-0 cursor-pointer items-center underline underline-offset-2 decoration-muted-foreground/50 hover:text-foreground"
              >
                {t('showAll')}
              </button>
            )}
          </div>
        ) : null}
      </div>

      {/* Scrollable Incident List. The root already stands above the fixed bottom nav (its
          `--nav-reserve` padding) and the footer is in flow, so the list ends at the footer by
          itself. What is left to reserve is the keyboard: it covers the nav AND the footer, so
          only what it covers beyond both — `--kb-inset − --nav-reserve − --list-foot` — plus the
          usual small gap. `relative` keeps the cards' `sr-only` texts inside this scroller: as
          absolute boxes with no positioned ancestor they escaped to the document and made the
          whole page scroll (2500px on a 21-card list). */}
      <div
        className="relative flex-1 overflow-y-auto px-4"
        style={{
          paddingBottom:
            'calc(max(var(--kb-inset, 0px) - var(--nav-reserve, 0px) - var(--list-foot, 0px), 0px) + 0.75rem)',
        }}
      >
        {isLoading ? (
          <div className="space-y-3 mt-4">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
        ) : filteredOperations.length === 0 ? (
          // Why it is empty, and the one way out (#3): the search found
          // nothing → «Suche leeren»; the status chip hides what it found →
          // «Alle zeigen»; there is nothing at all → one quiet line.
          searchQuery.trim() && !operations.some((op) => matchesSearch(op, searchQuery)) ? (
            <EmptyState
              title={t('noHitsFor', { query: searchQuery.trim() })}
              description={t('searchScope')}
              action={{
                label: tEmpty('clearSearch'),
                icon: X,
                onClick: () => {
                  setSearchQuery("")
                  searchRef.current?.focus()
                },
              }}
            />
          ) : filtering ? (
            <EmptyState
              title={t('noneInFilter', { filter: tickedLabels })}
              action={{ label: t('showAll'), onClick: showAll }}
            />
          ) : (
            <EmptyState title={t('noActive')} />
          )
        ) : (
          <div className="space-y-3 mt-4">
            {filteredOperations.map(operation => (
              <MobileIncidentCard
                key={operation.id}
                operation={operation}
                onClick={() => handleCardClick(operation)}
                formatLocation={formatLocation}
                vehicleDrivers={vehicleDrivers}
              />
            ))}
          </div>
        )}
      </div>

      {/* The list's ONE action, in a footer directly above the bottom nav (owner, 02.10.2026):
          under the thumb, and in flow — the list ends at its top edge instead of scrolling under a
          floating button. Editors only (the caller passes the handler only to them). */}
      {onNewIncident && (
        <div ref={footRef} className="flex-shrink-0 border-t border-border/50 bg-background px-4 py-3">
          <Button onClick={onNewIncident} className="w-full min-h-[48px] gap-2">
            <Plus className="h-4 w-4" />
            {t('newIncident')}
          </Button>
        </div>
      )}

      {/* Detail Sheet */}
      <MobileIncidentDetailSheet
        operation={selectedOperation}
        open={detailSheetOpen}
        onOpenChange={setDetailSheetOpen}
        materials={materials}
        formatLocation={formatLocation}
        onUpdateOperation={onUpdateOperation}
        isEditor={isEditor}
      />
    </div>
  )
}
