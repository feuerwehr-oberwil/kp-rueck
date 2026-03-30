"use client"

import { memo } from "react"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Clock, Truck, Users, ChevronUp, ChevronDown, Minus, FileCheck, AlertTriangle } from "lucide-react"
import { type Operation } from "@/lib/contexts/operations-context"
import { getTimeSince, columns } from "@/lib/kanban-utils"
import { getIncidentTypeLabel } from "@/lib/incident-types"
import { cn } from "@/lib/utils"

interface MobileIncidentCardProps {
  operation: Operation
  onClick: () => void
  formatLocation: (address: string) => string
}

// Priority visual configuration
const priorityStyles = {
  high: {
    dot: "bg-red-500",
    chevron: "text-red-600 dark:text-red-400",
  },
  medium: {
    dot: "bg-orange-500",
    chevron: "text-orange-600 dark:text-orange-400",
  },
  low: {
    dot: "bg-green-500",
    chevron: "text-green-600 dark:text-green-400",
  },
} as const

// Status label mapping
const statusLabels: Record<string, string> = {
  incoming: "Eingegangen",
  ready: "Reko",
  enroute: "Unterwegs",
  active: "Einsatz",
  returning: "Rückfahrt",
  complete: "Abgeschlossen",
}

function MobileIncidentCardBase({ operation, onClick, formatLocation }: MobileIncidentCardProps) {
  const priority = operation.priority || "low"
  const priorityConfig = priorityStyles[priority as keyof typeof priorityStyles]

  // Get column color for the card
  const column = columns.find(col => col.status.includes(operation.status))
  const columnColor = column?.color || "bg-slate-200/80 dark:bg-zinc-800/50"

  // Calculate time since status change
  const timeReference = operation.statusChangedAt || operation.dispatchTime

  return (
    <Card
      className={cn(
        "p-3 transition-all active:scale-[0.98] cursor-pointer touch-manipulation",
        columnColor,
        priority === "high" ? "border-red-500/40 border-2 bg-red-500/[0.04] dark:bg-red-500/[0.06]" : "border-border/50"
      )}
      onClick={onClick}
    >
      <div className="flex items-start gap-3">
        {/* Priority indicator */}
        <div className="flex items-center gap-0.5 flex-shrink-0 mt-0.5">
          <div
            className={cn("w-2.5 h-2.5 rounded-full flex-shrink-0", priorityConfig?.dot)}
            aria-hidden="true"
          />
          {priority === "high" ? (
            <ChevronUp className={cn("h-4 w-4", priorityConfig?.chevron)} aria-label="Hohe Prioritat" />
          ) : priority === "medium" ? (
            <Minus className={cn("h-4 w-4", priorityConfig?.chevron)} aria-label="Mittlere Prioritat" />
          ) : (
            <ChevronDown className={cn("h-4 w-4", priorityConfig?.chevron)} aria-label="Niedrige Prioritat" />
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Location */}
          <h3 className="font-semibold text-base truncate leading-tight">
            {formatLocation(operation.location)}
          </h3>

          {/* Type + Status */}
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <Badge variant="outline" className="text-xs px-1.5 py-0">
              {getIncidentTypeLabel(operation.incidentType)}
            </Badge>
            <Badge variant="secondary" className="text-xs px-1.5 py-0">
              {statusLabels[operation.status] || operation.status}
            </Badge>
            {operation.hasCompletedReko && (
              <span title="Reko ausgefullt">
                <FileCheck className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
              </span>
            )}
            {operation.rekoSummary?.hasDangers && (
              <span title="Gefahren">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
              </span>
            )}
          </div>

          {/* Time + Vehicles */}
          <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
            <div className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              <span className="font-mono">{getTimeSince(timeReference)}</span>
            </div>

            {operation.vehicles.length > 0 && (
              <div className="flex items-center gap-1">
                <Truck className="h-3 w-3" />
                <span className="truncate max-w-[120px]">
                  {operation.vehicles.join(", ")}
                </span>
              </div>
            )}

            {operation.crew.length > 0 && (
              <div className="flex items-center gap-1">
                <Users className="h-3 w-3" />
                <span>{operation.crew.length}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </Card>
  )
}

export const MobileIncidentCard = memo(MobileIncidentCardBase, (prevProps, nextProps) => {
  return (
    prevProps.operation.id === nextProps.operation.id &&
    prevProps.operation.status === nextProps.operation.status &&
    prevProps.operation.priority === nextProps.operation.priority &&
    prevProps.operation.location === nextProps.operation.location &&
    prevProps.operation.crew.length === nextProps.operation.crew.length &&
    prevProps.operation.vehicles.length === nextProps.operation.vehicles.length &&
    prevProps.operation.hasCompletedReko === nextProps.operation.hasCompletedReko &&
    prevProps.operation.rekoSummary?.hasDangers === nextProps.operation.rekoSummary?.hasDangers
  )
})
