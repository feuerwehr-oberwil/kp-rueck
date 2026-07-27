"use client"

import { useState, useMemo, useEffect, useRef } from "react"
import { useTranslations } from "next-intl"
import { useSearchParams } from "next/navigation"
import { TokenBoard } from "./token-board"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useOperations, type Operation } from "@/lib/contexts/operations-context"
import { useGroups } from "@/lib/contexts/groups-context"
import { useAuth } from "@/lib/contexts/auth-context"
import { useCrossWindowSync } from "@/lib/hooks/use-cross-window-sync"
import { columns, getTimeSince, ageChipClass, ageLevel } from "@/lib/kanban-utils"
import { useCollapsedSections } from "@/lib/hooks/use-collapsed-sections"
import { getIncidentTypeLabel, getIncidentLocationLabel } from "@/lib/incident-types"
import { IncidentDetailModal, priorityVisuals } from "@/components/display/incident-detail-modal"
import { Clock, Truck, Users, Siren, Package, ChevronDown, ChevronRight, Waypoints } from "lucide-react"
import { cn } from "@/lib/utils"

/** Per-device fold state for the viewer board (see useCollapsedSections). */
const BOARD_COLLAPSE_KEY = "kp-display-board-collapsed"

export default function DisplayBoardPage() {
  const t = useTranslations('display')
  const searchParams = useSearchParams()
  const token = searchParams.get("token")
  const { isAuthenticated } = useAuth()

  // Public share link (no login): render the read-only token board.
  if (token) {
    return <TokenBoard token={token} />
  }
  if (!isAuthenticated) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        {t('board.loginRequired')}
      </div>
    )
  }
  return <BoardDisplay />
}

function BoardDisplay() {
  const t = useTranslations('display')
  const tk = useTranslations('kanban')
  const { operations } = useOperations()
  const [highlightedId, setHighlightedId] = useState<string | null>(null)
  const [selectedOperation, setSelectedOperation] = useState<Operation | null>(null)
  // EVERY column folds now — a larger Feuerwehr otherwise just scrolls. All of
  // them start open except ABGESCHLOSSEN, which is finished work by definition
  // and whose width the live columns can use. Remembered per device.
  const collapsedColumns = useCollapsedSections(
    BOARD_COLLAPSE_KEY,
    columns.filter((c) => c.collapsible).map((c) => c.id),
  )

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

  // Keep selected operation in sync with live data
  useEffect(() => {
    if (selectedOperation) {
      const updated = operations.find(op => op.id === selectedOperation.id)
      if (updated) setSelectedOperation(updated)
      else setSelectedOperation(null) // operation was deleted
    }
  }, [operations, selectedOperation?.id])

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
    <div className="flex h-full gap-2 p-3 overflow-x-auto">
      {columns.map((column) => {
        const ops = operationsByColumn[column.id] || []
        const isCollapsed = collapsedColumns.isCollapsed(column.id)
        // Something in here has sat past the board's own warning threshold. It
        // stays visible on the folded bar: a column that hides its overdue
        // incident behind a title is exactly what folding must not do.
        const hasAlarm = ops.some((op) => ageLevel(op.statusChangedAt || op.dispatchTime) !== "normal")

        // Collapsed: thin vertical toggle bar showing the count, reclaiming width.
        if (isCollapsed) {
          return (
            <button
              key={column.id}
              type="button"
              onClick={() => collapsedColumns.toggle(column.id)}
              className={cn(
                "flex w-12 flex-shrink-0 flex-col items-center gap-3 rounded-lg border border-border py-3 transition-colors hover:bg-foreground/5",
                column.color
              )}
              title={t('board.collapsedColumnTitle', { title: tk(`columns.${column.id}`), count: ops.length })}
            >
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
              <span className="relative inline-flex items-center justify-center h-6 min-w-6 px-1.5 rounded-md bg-foreground/10 text-foreground text-xs font-bold tabular-nums">
                {ops.length}
                {hasAlarm && <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-red-500" aria-hidden />}
              </span>
              <span className="text-xs font-bold uppercase tracking-tight text-foreground [writing-mode:vertical-rl]">
                {tk(`columns.${column.id}`)}
              </span>
            </button>
          )
        }

        return (
          <div key={column.id} className="flex flex-1 flex-col min-w-[280px] overflow-hidden">
            <button
              type="button"
              onClick={() => collapsedColumns.toggle(column.id)}
              aria-expanded
              className={cn(
                "mb-2 w-full cursor-pointer rounded-lg border border-border px-3 py-3 text-left transition-colors hover:bg-foreground/5",
                column.color,
              )}
            >
              <div className="flex items-center gap-2">
                <ChevronDown className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                <h2 className="flex-1 truncate text-sm font-bold tracking-tight text-foreground uppercase">{tk(`columns.${column.id}`)}</h2>
                {hasAlarm && <span className="h-2 w-2 flex-shrink-0 rounded-full bg-red-500" aria-hidden />}
                <span className="inline-flex items-center justify-center h-6 min-w-6 px-1.5 rounded-md bg-foreground/10 text-foreground text-xs font-bold tabular-nums">
                  {ops.length}
                </span>
              </div>
            </button>
            <div className="flex-1 space-y-2 overflow-y-auto rounded-lg p-1">
              {ops.map((op) => (
                <DisplayOperationCard
                  key={op.id}
                  operation={op}
                  isHighlighted={highlightedId === op.id}
                  isFlashing={flashIds.has(op.id)}
                  onClick={() => setSelectedOperation(op)}
                />
              ))}
            </div>
          </div>
        )
      })}

      <IncidentDetailModal
        operation={selectedOperation}
        open={!!selectedOperation}
        onOpenChange={(open) => { if (!open) setSelectedOperation(null) }}
      />
    </div>
  )
}

function DisplayOperationCard({
  operation,
  isHighlighted,
  isFlashing,
  onClick,
}: {
  operation: Operation
  isHighlighted: boolean
  isFlashing: boolean
  onClick: () => void
}) {
  const t = useTranslations('display')
  const tk = useTranslations('kanban')
  const { groups } = useGroups()
  const { Icon: PriorityIcon, label: priorityLabel, iconColor: priorityIconColor } =
    priorityVisuals[operation.priority]

  // Auftrag (route) membership — read-only chip. Stop position derives from the
  // resolved stop order; group_position (0-based) is the fallback when the id
  // isn't in stopIds yet (optimistic add mid-sync). Mirrors the board card.
  const auftrag = operation.groupId ? groups.find((g) => g.id === operation.groupId) : undefined
  const auftragTotal = auftrag ? auftrag.stopIds.length : 0
  const auftragStopIndex = auftrag ? auftrag.stopIds.indexOf(operation.id) : -1
  const auftragStopPos = auftrag
    ? (auftragStopIndex >= 0 ? auftragStopIndex + 1 : operation.groupPosition + 1)
    : 0

  return (
    <Card
      className={cn(
        "p-3 transition-all border border-border/50 bg-card/80 cursor-pointer hover:border-border hover:bg-card",
        isHighlighted && "ring-2 ring-primary border-primary scale-[1.02]",
        isFlashing && "animate-flash"
      )}
      onClick={onClick}
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
          <PriorityIcon
            className={cn("h-4 w-4 flex-shrink-0 mt-0.5", priorityIconColor)}
            aria-label={t('board.priorityAria', { label: priorityLabel })}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="font-bold text-sm leading-tight break-words">{getIncidentLocationLabel(operation)}</h3>
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground flex-shrink-0">
                {priorityLabel}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <Siren className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
          <span className="text-xs text-muted-foreground">{getIncidentTypeLabel(operation.incidentType)}</span>
        </div>

        {auftrag && (
          <div
            className="flex items-center gap-1.5 rounded-md px-1.5 py-1"
            style={{
              backgroundColor: `color-mix(in srgb, ${auftrag.color ?? "var(--muted-foreground)"} 14%, transparent)`,
            }}
            title={t('board.auftragChipTooltip', { name: auftrag.name })}
          >
            <Waypoints
              className="h-3.5 w-3.5 flex-shrink-0"
              style={{ color: auftrag.color ?? "var(--muted-foreground)" }}
            />
            <span
              className="text-xs font-bold uppercase tracking-wide truncate"
              style={{ color: auftrag.color ?? "var(--muted-foreground)" }}
            >
              {auftrag.name}
            </span>
            <span className="ml-auto text-[10px] font-mono font-semibold uppercase tabular-nums text-muted-foreground flex-shrink-0">
              {tk('card.auftragStopPosition', { pos: auftragStopPos, total: auftragTotal })}
            </span>
          </div>
        )}

        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
            <span className="font-mono text-xs text-muted-foreground">
              {operation.dispatchTime.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" })}
            </span>
          </div>
          <span
            className={`font-mono text-xs ${ageChipClass(operation.statusChangedAt || operation.dispatchTime)}`}
          >
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
            <span className="text-xs text-muted-foreground">{t('common.personCount', { count: operation.crew.length })}</span>
          </div>
        )}

        {operation.materials.length > 0 && (
          <div className="flex items-start gap-1.5">
            <Package className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0 mt-0.5" />
            <span className="text-xs text-muted-foreground">{t('board.materialCount', { count: operation.materials.length })}</span>
          </div>
        )}
      </div>
    </Card>
  )
}
