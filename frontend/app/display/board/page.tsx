"use client"

import { useState, useMemo, useEffect, useRef } from "react"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useOperations, type Operation } from "@/lib/contexts/operations-context"
import { useAuth } from "@/lib/contexts/auth-context"
import { useCrossWindowSync } from "@/lib/hooks/use-cross-window-sync"
import { columns, getTimeSince } from "@/lib/kanban-utils"
import { getIncidentTypeLabel } from "@/lib/incident-types"
import { Clock, Truck, Users, Siren, Package } from "lucide-react"
import { cn } from "@/lib/utils"

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

  // Track status changes for flash animation
  const [flashIds, setFlashIds] = useState<Set<string>>(new Set())
  const prevStatusRef = useRef<Map<string, string>>(new Map())

  useEffect(() => {
    const newFlashes = new Set<string>()
    const prevMap = prevStatusRef.current

    for (const op of operations) {
      const prevStatus = prevMap.get(op.id)
      // Flash if status changed (but not on initial load)
      if (prevStatus !== undefined && prevStatus !== op.status) {
        newFlashes.add(op.id)
      }
    }

    // Update prev map
    const nextMap = new Map<string, string>()
    for (const op of operations) nextMap.set(op.id, op.status)
    prevStatusRef.current = nextMap

    if (newFlashes.size > 0) {
      setFlashIds(newFlashes)
      // Clear flash after animation completes
      const timer = setTimeout(() => setFlashIds(new Set()), 2000)
      return () => clearTimeout(timer)
    }
  }, [operations])

  useCrossWindowSync({
    onMessage: (msg) => {
      if (msg.type === "incident:selected") setHighlightedId(msg.incidentId)
    },
  })

  const operationsByColumn = useMemo(() => {
    const grouped: Record<string, Operation[]> = {}
    columns.forEach((col) => { grouped[col.id] = [] })
    operations.forEach((op) => {
      const column = columns.find((col) => col.status.includes(op.status))
      if (column) grouped[column.id].push(op)
    })
    return grouped
  }, [operations])

  return (
    <div className="grid h-full grid-cols-6 gap-2 p-3">
      {columns.map((column) => {
        const ops = operationsByColumn[column.id] || []
        return (
          <div key={column.id} className="flex flex-col min-w-0 overflow-hidden">
            <div className={cn("mb-2 rounded-lg border border-border px-3 py-2", column.color)}>
              <h2 className="text-sm font-semibold text-foreground">{column.title}</h2>
              <p className="text-xs text-muted-foreground">{ops.length} Einsätze</p>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto rounded-lg p-1">
              {ops.map((op) => (
                <DisplayOperationCard
                  key={op.id}
                  operation={op}
                  isHighlighted={highlightedId === op.id}
                  isFlashing={flashIds.has(op.id)}
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
  isFlashing,
}: {
  operation: Operation
  isHighlighted: boolean
  isFlashing: boolean
}) {
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
        isHighlighted && "ring-2 ring-primary border-primary scale-[1.02]",
        isFlashing && "animate-flash"
      )}
    >
      <style>{`
        @keyframes flash {
          0%, 100% { box-shadow: none; }
          25% { box-shadow: 0 0 0 3px hsl(var(--primary) / 0.4); }
          50% { box-shadow: none; }
          75% { box-shadow: 0 0 0 3px hsl(var(--primary) / 0.4); }
        }
        .animate-flash { animation: flash 1.5s ease-out; }
      `}</style>
      <div className="space-y-2">
        <div className="flex items-start gap-2">
          <div className={cn("h-2.5 w-2.5 rounded-full flex-shrink-0 mt-1", priorityColor)} />
          <div className="min-w-0 flex-1">
            <h3 className="font-bold text-sm leading-tight break-words">{operation.location}</h3>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <Siren className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
          <span className="text-xs text-muted-foreground">{getIncidentTypeLabel(operation.incidentType)}</span>
        </div>

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

        {operation.notes && (
          <p className="text-xs text-muted-foreground line-clamp-2 border-t pt-2">{operation.notes}</p>
        )}

        {operation.vehicles.length > 0 && (
          <div className="flex items-start gap-1.5 border-t pt-2">
            <Truck className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0 mt-0.5" />
            <div className="flex flex-wrap gap-1">
              {operation.vehicles.map((v, i) => (
                <Badge key={i} variant="secondary" className="text-xs px-1.5 py-0">{v}</Badge>
              ))}
            </div>
          </div>
        )}

        {operation.crew.length > 0 && (
          <div className="flex items-start gap-1.5">
            <Users className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0 mt-0.5" />
            <span className="text-xs text-muted-foreground">{operation.crew.length} Person(en)</span>
          </div>
        )}

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
