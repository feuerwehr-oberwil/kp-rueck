"use client"

import { useState, useMemo, useRef } from "react"
import { useTranslations } from "next-intl"
import Link from "next/link"
import { SearchInput } from "@/components/ui/search-input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Plus, Sparkles, X } from "lucide-react"
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

// Status groups for filtering — labels render via t(`filters.${id}`)
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
  const [activeFilter, setActiveFilter] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  // Filter and sort operations
  const filteredOperations = useMemo(() => {
    let filtered = operations

    // Apply status filter
    if (activeFilter) {
      const group = statusGroups.find(g => g.id === activeFilter)
      if (group) {
        filtered = filtered.filter(op => group.statuses.includes(op.status))
      }
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
  }, [operations, searchQuery, activeFilter])

  // Count operations by status group
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    statusGroups.forEach(group => {
      counts[group.id] = operations.filter(op => group.statuses.includes(op.status)).length
    })
    return counts
  }, [operations])

  const selectedOperation = useMemo(
    () => operations.find((op) => op.id === selectedOperationId) ?? null,
    [operations, selectedOperationId],
  )

  const handleCardClick = (operation: Operation) => {
    setSelectedOperationId(operation.id)
    setDetailSheetOpen(true)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Fixed Header with Search */}
      <div className="flex-shrink-0 px-4 pt-4 pb-2 bg-background/95 backdrop-blur-sm sticky top-0 z-10 border-b border-border/50">
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
            the "Mehr" sheet → Übungs-Steuerung. Editor-only (spawning needs edit rights). */}
        {isTraining && isEditor && (
          <Link href="/training" className="mb-2 block">
            <Button variant="outline" className="w-full min-h-[48px] gap-2">
              <Sparkles className="h-4 w-4" />
              {t('createTrainingIncident')}
            </Button>
          </Link>
        )}

        {/* The phone's way into «Neuer Einsatz» — before this it was reachable only through
            the board's N shortcut, i.e. not at all on a touch screen. Full width, the default
            Button, editors only (the caller passes the handler only to them). In an Übung it
            stands BELOW the training CTA: spawning a scenario stays the Übung's main task and
            keeps its place under the thumb; typing a card by hand is the second way in. */}
        {onNewIncident && (
          <Button onClick={onNewIncident} className="mb-3 w-full min-h-[48px] gap-2">
            <Plus className="h-4 w-4" />
            {t('newIncident')}
          </Button>
        )}

        {/* Search Bar */}
        <SearchInput
          ref={searchRef}
          containerClassName="mb-3"
          placeholder={t('searchPlaceholder')}
          value={searchQuery}
          onValueChange={setSearchQuery}
        />

        {/* Status Filter Pills - 44px min height for touch targets (WCAG 2.5.5) */}
        <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1">
          <Button
            variant={activeFilter === null ? "selected" : "outline"}
            aria-pressed={activeFilter === null}
            size="sm"
            onClick={() => setActiveFilter(null)}
            className="flex-shrink-0 min-h-[44px] px-4"
          >
            {t('all', { count: operations.length })}
          </Button>
          {statusGroups.map(group => (
            <Button
              key={group.id}
              variant={activeFilter === group.id ? "selected" : "outline"}
              aria-pressed={activeFilter === group.id}
              size="sm"
              onClick={() => setActiveFilter(activeFilter === group.id ? null : group.id)}
              className="flex-shrink-0 min-h-[44px] px-4"
            >
              {t(`filters.${group.id}`)} ({statusCounts[group.id]})
            </Button>
          ))}
        </div>
      </div>

      {/* Scrollable Incident List. Pad past the fixed bottom navbar by its MEASURED
          height (`pb-nav-reserve`, globals.css) so the last card ends just above it. */}
      <div className="flex-1 overflow-y-auto px-4 pb-nav-reserve">
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
          ) : activeFilter ? (
            <EmptyState
              title={t('noneInFilter', { filter: t(`filters.${activeFilter}`) })}
              action={{ label: t('showAll'), onClick: () => setActiveFilter(null) }}
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
