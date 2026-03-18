"use client"

import { useState, useMemo, useEffect } from "react"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useOperations, type Operation } from "@/lib/contexts/operations-context"
import { useAuth } from "@/lib/contexts/auth-context"
import { useCrossWindowSync } from "@/lib/hooks/use-cross-window-sync"
import { columns, getTimeSince } from "@/lib/kanban-utils"
import { getIncidentTypeLabel } from "@/lib/incident-types"
import { Clock, Truck, Users, Siren, Package } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * /display/board — Read-only kanban display for command post monitors.
 * Large text, no edit controls, highlights synced from editor windows.
 */
export default function DisplayBoardPage() {
  const { isAuthenticated } = useAuth()

  if (!isAuthenticated) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Bitte melden Sie sich an für die Board-Anzeige.
      </div>
    )
  }

  return <BoardDisplay />
}

function BoardDisplay() {
  const { operations } = useOperations()
  const [highlightedId, setHighlightedId] = useState<string | null>(null)

  // Cross-window sync
  useCrossWindowSync({
    onMessage: (msg) => {
      if (msg.type === "incident:selected") {
        setHighlightedId(msg.incidentId)
      }
    },
  })

  // Group operations by column
  const operationsByColumn = useMemo(() => {
    const grouped: Record<string, Operation[]> = {}
    columns.forEach((col) => {
      grouped[col.id] = []
    })
    operations.forEach((op) => {
      const column = columns.find((col) => col.status.includes(op.status))
      if (column) {
        grouped[column.id].push(op)
      }
    })
    return grouped
  }, [operations])

  return (
    <div className="grid h-full grid-cols-6 gap-2 p-3">
      {columns.map((column) => {
        const ops = operationsByColumn[column.id] || []
        return (
          <div key={column.id} className="flex flex-col min-w-0 overflow-hidden">
            {/* Column header */}
            <div className={cn("mb-2 rounded-lg border border-border px-3 py-2", column.color)}>
              <h2 className="text-sm font-semibold text-foreground">{column.title}</h2>
              <p className="text-xs text-muted-foreground">{ops.length} Einsätze</p>
            </div>

            {/* Cards */}
            <div className="flex-1 space-y-2 overflow-y-auto rounded-lg p-1">
              {ops.map((op) => (
                <DisplayOperationCard
                  key={op.id}
                  operation={op}
                  isHighlighted={highlightedId === op.id}
                />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function DisplayOperationCard({
  operation,
  isHighlighted,
}: {
  operation: Operation
  isHighlighted: boolean
}) {
  const [currentTime, setCurrentTime] = useState(new Date())

  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date()), 60000)
    return () => clearInterval(interval)
  }, [])

  const priorityColor =
    operation.priority === "high"
      ? "bg-red-500"
      : operation.priority === "medium"
        ? "bg-yellow-500"
        : "bg-green-500"

  return (
    <Card
      className={cn(
        "p-3 transition-all border border-border/50 bg-card/80",
        isHighlighted && "ring-2 ring-primary border-primary scale-[1.02]"
      )}
    >
      <div className="space-y-2">
        {/* Title row */}
        <div className="flex items-start gap-2">
          <div className={cn("h-2.5 w-2.5 rounded-full flex-shrink-0 mt-1", priorityColor)} />
          <div className="min-w-0 flex-1">
            <h3 className="font-bold text-sm leading-tight break-words">
              {operation.location}
            </h3>
          </div>
        </div>

        {/* Type */}
        <div className="flex items-center gap-1.5">
          <Siren className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
          <span className="text-xs text-muted-foreground">{getIncidentTypeLabel(operation.incidentType)}</span>
        </div>

        {/* Time */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
            <span className="font-mono text-xs text-muted-foreground">
              {operation.dispatchTime.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}
            </span>
          </div>
          <span className="font-mono text-xs text-muted-foreground">
            {getTimeSince(operation.statusChangedAt || operation.dispatchTime)}
          </span>
        </div>

        {/* Description */}
        {operation.notes && (
          <p className="text-xs text-muted-foreground line-clamp-2 border-t pt-2">
            {operation.notes}
          </p>
        )}

        {/* Vehicles */}
        {operation.vehicles.length > 0 && (
          <div className="flex items-start gap-1.5 border-t pt-2">
            <Truck className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0 mt-0.5" />
            <div className="flex flex-wrap gap-1">
              {operation.vehicles.map((v, i) => (
                <Badge key={i} variant="secondary" className="text-xs px-1.5 py-0">
                  {v}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Crew */}
        {operation.crew.length > 0 && (
          <div className="flex items-start gap-1.5">
            <Users className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0 mt-0.5" />
            <span className="text-xs text-muted-foreground">{operation.crew.length} Person(en)</span>
          </div>
        )}

        {/* Materials */}
        {operation.materials.length > 0 && (
          <div className="flex items-start gap-1.5">
            <Package className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0 mt-0.5" />
            <span className="text-xs text-muted-foreground">{operation.materials.length} Material(ien)</span>
          </div>
        )}
      </div>
    </Card>
  )
}
