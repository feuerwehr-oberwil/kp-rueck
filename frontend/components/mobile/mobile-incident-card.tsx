"use client"

import { memo } from "react"
import { useTranslations } from "next-intl"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Clock, Truck, Users, ChevronUp, ChevronDown, Minus, FileCheck, AlertTriangle } from "lucide-react"
import { type Operation } from "@/lib/contexts/operations-context"
import { getTimeSince, columns } from "@/lib/kanban-utils"
import { getIncidentTypeLabel } from "@/lib/incident-types"
import { cn } from "@/lib/utils"
import { getOperationStatusLabel } from "@/lib/status-labels"
import { type Priority, PRIORITY_DOT_CLASSES, PRIORITY_TEXT_CLASSES } from "@/lib/priority"

interface MobileIncidentCardProps {
  operation: Operation
  onClick: () => void
  formatLocation: (address: string) => string
}

function MobileIncidentCardBase({ operation, onClick, formatLocation }: MobileIncidentCardProps) {
  const t = useTranslations("incidents.card")
  const tCard = useTranslations("kanban.card")
  const tDetail = useTranslations("incidents.mobileDetail")
  const priority = (operation.priority || "low") as Priority
  const priorityConfig = { dot: PRIORITY_DOT_CLASSES[priority], chevron: PRIORITY_TEXT_CLASSES[priority] }

  // Get column color for the card
  const column = columns.find(col => col.status.includes(operation.status))
  const columnColor = column?.color || "bg-muted"

  // Calculate time since status change
  const timeReference = operation.statusChangedAt || operation.dispatchTime

  return (
    <Card
      className={cn(
        "p-3 transition-all active:scale-[0.98] cursor-pointer touch-manipulation",
        columnColor,
        priority === "high" ? "border-red-500/40 border-2 bg-red-500/[0.04] dark:bg-red-500/[0.06]" : "border-border"
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
            <ChevronUp className={cn("h-4 w-4", priorityConfig?.chevron)} aria-label={tCard("priorityHighAria")} />
          ) : priority === "medium" ? (
            <Minus className={cn("h-4 w-4", priorityConfig?.chevron)} aria-label={tCard("priorityMediumAria")} />
          ) : (
            <ChevronDown className={cn("h-4 w-4", priorityConfig?.chevron)} aria-label={tCard("priorityLowAria")} />
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Location — hidden when it is only the home city (redundant) */}
          {formatLocation(operation.location) && (
            <h3 className="font-semibold text-base truncate leading-tight">
              {formatLocation(operation.location)}
            </h3>
          )}

          {/* Type + Status */}
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <Badge variant="outline" className="text-xs px-1.5 py-0">
              {getIncidentTypeLabel(operation.incidentType)}
            </Badge>
            <Badge variant="secondary" className="text-xs px-1.5 py-0 max-w-full">
              {getOperationStatusLabel(operation.status)}
            </Badge>
            {operation.hasCompletedReko && (
              <span title={t("rekoCompleted")}>
                <FileCheck className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
              </span>
            )}
            {operation.rekoSummary?.hasDangers && (
              <span title={tDetail("dangers")}>
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
