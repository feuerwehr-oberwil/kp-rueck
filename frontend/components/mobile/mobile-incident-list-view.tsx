"use client"

import { useState, useMemo } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Search } from "lucide-react"
import { type Operation, type Material } from "@/lib/contexts/operations-context"
import { getIncidentTypeLabel } from "@/lib/incident-types"
import { MobileIncidentCard } from "./mobile-incident-card"
import { MobileIncidentDetailSheet } from "./mobile-incident-detail-sheet"
import { columns } from "@/lib/kanban-utils"

interface MobileIncidentListViewProps {
  operations: Operation[]
  materials: Material[]
  formatLocation: (address: string) => string
  onRefresh: () => void
  onCheckIn: () => void
  onVehicleStatus: () => void
  onUpdateOperation?: (id: string, updates: Partial<Operation>) => void
  isEditor?: boolean
  isTraining?: boolean
  isLoading?: boolean
}

// Status order for sorting (active incidents first)
const statusOrder: Record<string, number> = {
  active: 0,
  enroute: 1,
  incoming: 2,
  ready: 3,
  rekoDone: 4,
  returning: 5,
  complete: 6,
}

// Status groups for filtering
const statusGroups = [
  { id: "active", label: "Aktiv", statuses: ["active", "enroute"] },
  { id: "incoming", label: "Neu", statuses: ["incoming", "ready", "rekoDone"] },
  { id: "returning", label: "Beendet", statuses: ["returning"] },
  { id: "complete", label: "Abgeschlossen", statuses: ["complete"] },
]

export function MobileIncidentListView({
  operations,
  materials,
  formatLocation,
  onRefresh,
  onCheckIn,
  onVehicleStatus,
  onUpdateOperation,
  isEditor = false,
  isTraining = false,
  isLoading = false,
}: MobileIncidentListViewProps) {
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedOperation, setSelectedOperation] = useState<Operation | null>(null)
  const [detailSheetOpen, setDetailSheetOpen] = useState(false)
  const [activeFilter, setActiveFilter] = useState<string | null>(null)

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
      const query = searchQuery.toLowerCase()
      filtered = filtered.filter(op =>
        op.location.toLowerCase().includes(query) ||
        op.incidentType.toLowerCase().includes(query) ||
        getIncidentTypeLabel(op.incidentType).toLowerCase().includes(query) ||
        op.vehicles.some(v => v.toLowerCase().includes(query)) ||
        op.crew.some(c => c.toLowerCase().includes(query)) ||
        op.id.toLowerCase().includes(query)
      )
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

  const handleCardClick = (operation: Operation) => {
    setSelectedOperation(operation)
    setDetailSheetOpen(true)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Fixed Header with Search */}
      <div className="flex-shrink-0 px-4 pt-4 pb-2 bg-background/95 backdrop-blur-sm sticky top-0 z-10 border-b border-border/50">
        {/* Search Bar */}
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Einsatz suchen..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-10"
          />
        </div>

        {/* Status Filter Pills - 44px min height for touch targets (WCAG 2.5.5) */}
        <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1">
          <Button
            variant={activeFilter === null ? "default" : "outline"}
            size="sm"
            onClick={() => setActiveFilter(null)}
            className="flex-shrink-0 min-h-[44px] px-4"
          >
            Alle ({operations.length})
          </Button>
          {statusGroups.map(group => (
            <Button
              key={group.id}
              variant={activeFilter === group.id ? "default" : "outline"}
              size="sm"
              onClick={() => setActiveFilter(activeFilter === group.id ? null : group.id)}
              className="flex-shrink-0 min-h-[44px] px-4"
            >
              {group.label} ({statusCounts[group.id]})
            </Button>
          ))}
        </div>
      </div>

      {/* Scrollable Incident List */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {isLoading ? (
          <div className="space-y-3 mt-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-24 rounded-lg bg-muted/50 animate-pulse" />
            ))}
          </div>
        ) : filteredOperations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <p className="text-muted-foreground">
              {searchQuery || activeFilter
                ? "Keine Einsätze gefunden"
                : "Keine aktiven Einsätze"}
            </p>
          </div>
        ) : (
          <div className="space-y-3 mt-4">
            {filteredOperations.map(operation => (
              <MobileIncidentCard
                key={operation.id}
                operation={operation}
                onClick={() => handleCardClick(operation)}
                formatLocation={formatLocation}
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
