"use client"

import { useState, useMemo, useEffect, useRef } from "react"
import { useTranslations } from "next-intl"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useOperations, type Operation } from "@/lib/contexts/operations-context"
import { useMaterials } from "@/lib/contexts/materials-context"
import { usePersonnel } from "@/lib/contexts/personnel-context"
import { useEvent } from "@/lib/contexts/event-context"
import { useAuth } from "@/lib/contexts/auth-context"
import { useCrossWindowSync } from "@/lib/hooks/use-cross-window-sync"
import { useVehicleDrivers } from "@/lib/hooks/use-vehicle-drivers"
import { columns, getTimeSince, ageChipClass } from "@/lib/kanban-utils"
import { getIncidentTypeLabel } from "@/lib/incident-types"
import { PRIORITY_ICONS, PRIORITY_LABELS } from "@/lib/priority"
import { Clock, Truck, Users, Siren, Package, AlertTriangle, AlertCircle, Info, FileText, Phone, MessageSquare, Building2, Timer, Footprints, FileCheck, ChevronRight } from "lucide-react"
import { type LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

export default function DisplayBoardPage() {
  const t = useTranslations('display')
  const { isAuthenticated } = useAuth()
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
  const { operations } = useOperations()
  const [highlightedId, setHighlightedId] = useState<string | null>(null)
  const [selectedOperation, setSelectedOperation] = useState<Operation | null>(null)
  // Collapsible columns (ABGESCHLOSSEN) start collapsed so the active columns reclaim
  // the full board width. Click the thin bar to expand/collapse.
  const [collapsedColumns, setCollapsedColumns] = useState<Set<string>>(
    () => new Set(columns.filter(c => c.collapsible).map(c => c.id))
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

  const toggleColumn = (columnId: string) => {
    setCollapsedColumns(prev => {
      const next = new Set(prev)
      if (next.has(columnId)) next.delete(columnId)
      else next.add(columnId)
      return next
    })
  }

  return (
    <div className="flex h-full gap-2 p-3">
      {columns.map((column) => {
        const ops = operationsByColumn[column.id] || []
        const isCollapsed = column.collapsible && collapsedColumns.has(column.id)

        // Collapsed: thin vertical toggle bar showing the count, reclaiming width.
        if (isCollapsed) {
          return (
            <button
              key={column.id}
              type="button"
              onClick={() => toggleColumn(column.id)}
              className={cn(
                "flex w-12 flex-shrink-0 flex-col items-center gap-3 rounded-lg border border-border py-3 transition-colors hover:bg-foreground/5",
                column.color
              )}
              title={t('board.collapsedColumnTitle', { title: column.title, count: ops.length })}
            >
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
              <span className="inline-flex items-center justify-center h-6 min-w-6 px-1.5 rounded-md bg-foreground/10 text-foreground text-xs font-bold tabular-nums">
                {ops.length}
              </span>
              <span className="text-xs font-bold uppercase tracking-tight text-foreground [writing-mode:vertical-rl]">
                {column.title}
              </span>
            </button>
          )
        }

        return (
          <div key={column.id} className="flex flex-1 flex-col min-w-0 overflow-hidden">
            <div
              className={cn(
                "mb-2 rounded-lg border border-border px-3 py-3",
                column.color,
                column.collapsible && "cursor-pointer"
              )}
              onClick={column.collapsible ? () => toggleColumn(column.id) : undefined}
            >
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold tracking-tight text-foreground uppercase">{column.title}</h2>
                <span className="inline-flex items-center justify-center h-6 min-w-6 px-1.5 rounded-md bg-foreground/10 text-foreground text-xs font-bold tabular-nums">
                  {ops.length}
                </span>
              </div>
            </div>
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

// Icons/labels from the shared priority module; only the tailwind tint is local.
const priorityVisuals: Record<
  Operation["priority"],
  { Icon: LucideIcon; label: string; iconColor: string }
> = {
  high: { Icon: PRIORITY_ICONS.high, label: PRIORITY_LABELS.high, iconColor: "text-red-500" },
  medium: { Icon: PRIORITY_ICONS.medium, label: PRIORITY_LABELS.medium, iconColor: "text-amber-500" },
  low: { Icon: PRIORITY_ICONS.low, label: PRIORITY_LABELS.low, iconColor: "text-green-600 dark:text-green-500" },
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
  const { Icon: PriorityIcon, label: priorityLabel, iconColor: priorityIconColor } =
    priorityVisuals[operation.priority]

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
              <h3 className="font-bold text-sm leading-tight break-words">{operation.location}</h3>
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

function IncidentDetailModal({
  operation,
  open,
  onOpenChange,
}: {
  operation: Operation | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const t = useTranslations('display')
  const { materials } = useMaterials()
  const { personnel } = usePersonnel()
  const { selectedEvent } = useEvent()
  const vehicleDrivers = useVehicleDrivers(selectedEvent?.id, open && !!operation)

  if (!operation) return null

  const { Icon: PriorityIcon, label: priorityLabel, iconColor: priorityIconColor } =
    priorityVisuals[operation.priority]

  const materialNames = operation.materials.map(id => {
    const mat = materials.find(m => m.id === id)
    return mat?.name ?? id
  })

  const personnelRoleByName = new Map<string, string | undefined>(
    personnel.map(p => [p.name, p.role]),
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PriorityIcon
              className={cn("h-5 w-5 flex-shrink-0", priorityIconColor)}
              aria-label={t('board.priorityAria', { label: priorityLabel })}
            />
            <span className="break-words">{operation.location}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {/* Type, Priority, Time */}
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <div className="flex items-center gap-1.5">
              <Siren className="h-4 w-4 text-muted-foreground" />
              <span>{getIncidentTypeLabel(operation.incidentType)}</span>
            </div>
            <Badge variant="outline">{priorityLabel}</Badge>
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Clock className="h-4 w-4" />
              <span className="font-mono">
                {operation.dispatchTime.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" })}
              </span>
              <span>·</span>
              <span className="font-mono">{getTimeSince(operation.statusChangedAt || operation.dispatchTime)}</span>
            </div>
          </div>

          {/* Flags */}
          <div className="flex flex-wrap gap-2">
            {operation.nachbarhilfe && (
              <Badge variant="outline" className="gap-1">
                <Building2 className="h-3 w-3" /> {t('board.nachbarhilfe')}
              </Badge>
            )}
            {operation.amWarten && (
              <Badge variant="outline" className="gap-1 border-yellow-500/50 text-yellow-600 dark:text-yellow-400">
                <Timer className="h-3 w-3" /> {t('board.amWarten')}
              </Badge>
            )}
            {operation.zuFuss && (
              <Badge variant="outline" className="gap-1">
                <Footprints className="h-3 w-3" /> {t('board.zuFuss')}
              </Badge>
            )}
          </div>

          {/* Description */}
          {operation.notes && (
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                <FileText className="h-4 w-4" /> {t('board.report')}
              </div>
              <p className="text-sm whitespace-pre-wrap">{operation.notes}</p>
            </div>
          )}

          {/* Contact */}
          {operation.contact && (
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                <Phone className="h-4 w-4" /> {t('board.contact')}
              </div>
              <p className="text-sm">{operation.contact}</p>
            </div>
          )}

          {/* Internal Notes */}
          {operation.internalNotes && (
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                <MessageSquare className="h-4 w-4" /> {t('board.notes')}
              </div>
              <p className="text-sm whitespace-pre-wrap">{operation.internalNotes}</p>
            </div>
          )}

          {/* Nachbarhilfe Note */}
          {operation.nachbarhilfe && operation.nachbarhilfeNote && (
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                <Building2 className="h-4 w-4" /> {t('board.nachbarhilfeNote')}
              </div>
              <p className="text-sm">{operation.nachbarhilfeNote}</p>
            </div>
          )}

          {/* Am Warten Note */}
          {operation.amWarten && operation.amWartenNote && (
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                <Timer className="h-4 w-4" /> {t('board.waitReason')}
              </div>
              <p className="text-sm">{operation.amWartenNote}</p>
            </div>
          )}

          {/* Crew */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
              <Users className="h-4 w-4" /> {t('board.crewHeading', { count: operation.crew.length })}
            </div>
            {operation.crew.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {operation.crew.map((name) => {
                  const role = personnelRoleByName.get(name)
                  return (
                    <Badge key={name} variant="secondary" className="text-sm">
                      {name}
                      {role && <span className="ml-1 opacity-70">· {role}</span>}
                    </Badge>
                  )
                })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground/60 italic">{t('board.noCrew')}</p>
            )}
          </div>

          {/* Vehicles */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
              <Truck className="h-4 w-4" /> {t('board.vehiclesHeading', { count: operation.vehicles.length })}
            </div>
            {operation.vehicles.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {operation.vehicles.map((vehicleName) => {
                  const callsign = operation.vehicleCallsigns.get(vehicleName)
                  const driverStay = operation.vehicleDriverStay.get(vehicleName)
                  const driverName = vehicleDrivers.get(vehicleName)
                  return (
                    <Badge key={vehicleName} variant="default" className="text-sm gap-1">
                      {vehicleName}
                      {callsign && <span className="opacity-70">· {callsign}</span>}
                      {driverName && <span className="opacity-70">{t('board.driver', { name: driverName })}</span>}
                      {driverStay !== undefined && (
                        <span className="opacity-70 ml-0.5">
                          {driverStay ? t('board.driverStays') : t('board.driverReturns')}
                        </span>
                      )}
                    </Badge>
                  )
                })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground/60 italic">{t('board.noVehicles')}</p>
            )}
          </div>

          {/* Materials */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
              <Package className="h-4 w-4" /> {t('board.materialsHeading', { count: operation.materials.length })}
            </div>
            {materialNames.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {materialNames.map((name, i) => (
                  <Badge key={i} variant="secondary" className="text-sm">{name}</Badge>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground/60 italic">{t('board.noMaterials')}</p>
            )}
          </div>

          {/* Reko Summary */}
          {operation.hasCompletedReko && operation.rekoSummary && (
            <div className="space-y-1.5 border-t pt-3">
              <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                <FileCheck className="h-4 w-4" /> {t('board.rekoResult')}
              </div>
              <div className="space-y-1 text-sm">
                <p>
                  <span className="text-muted-foreground">{t('board.relevant')}</span>{" "}
                  {operation.rekoSummary.isRelevant ? t('common.yes') : t('common.no')}
                </p>
                {operation.rekoSummary.hasDangers && (
                  <div className="flex items-start gap-1.5">
                    <AlertTriangle className="h-4 w-4 text-yellow-500 flex-shrink-0 mt-0.5" />
                    <span>{t('board.dangers', { types: operation.rekoSummary.dangerTypes.join(", ") })}</span>
                  </div>
                )}
                {operation.rekoSummary.personnelCount !== null && (
                  <p>
                    <span className="text-muted-foreground">{t('board.personnelNeed')}</span>{" "}
                    {t('common.personCount', { count: operation.rekoSummary.personnelCount })}
                  </p>
                )}
                {operation.rekoSummary.estimatedDuration !== null && (
                  <p>
                    <span className="text-muted-foreground">{t('board.estimatedDuration')}</span>{" "}
                    {t('board.durationHours', { hours: operation.rekoSummary.estimatedDuration })}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
