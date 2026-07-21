"use client"

import { useEffect, useRef, useState, memo } from "react"
import { useTranslations } from "next-intl"
import Link from "next/link"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { Clock, Users, Package, X, Truck, Siren, FileCheck, AlertTriangle, ChevronUp, ChevronDown, Minus, Search, Binoculars, PenLine, Map, Building2, Printer, Timer, Footprints, MapPin, Undo2, Layers, Phone, CheckCircle2, ArrowRightLeft, Waypoints } from 'lucide-react'
import { draggable, dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine'
import { attachClosestEdge, extractClosestEdge, type Edge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge'
import { DropIndicator } from '@atlaskit/pragmatic-drag-and-drop-react-drop-indicator/box'
import { type Operation, type Material } from "@/lib/contexts/operations-context"
import { useMaterials } from "@/lib/contexts/materials-context"
import { useGroups } from "@/lib/contexts/groups-context"
import { getTimeSince, ageChipClass } from "@/lib/kanban-utils"
import { getIncidentTypeLabel } from "@/lib/incident-types"
import { cn } from "@/lib/utils"
import { apiClient } from "@/lib/api-client"
import { toast } from "sonner"

// Must match SIDEPANEL_BREAKPOINT in side-panel.tsx
const SIDEPANEL_BREAKPOINT = 1536

interface DraggableOperationProps {
  operation: Operation
  columnColor: string
  onRemoveCrew: (crewName: string) => void
  onRemoveMaterial: (materialId: string) => void
  onRemoveVehicle: (vehicleName: string) => void
  onToggleDriverStay?: (vehicleName: string) => void
  onRemoveReko?: () => void
  onClick: () => void
  onSelect?: () => void
  onHover: (opId: string | null) => void
  isHighlighted?: boolean
  isSelected?: boolean
  isKeyboardFocused?: boolean
  isDraggingRef: React.MutableRefObject<boolean>
  materials: Material[]
  index: number
  columnOperations: Operation[]
  formatLocation: (address: string) => string
  onAssignResource?: (resourceType: 'crew' | 'vehicles' | 'materials', operationId: string) => void
  onAssignReko?: () => void
  onToggleNachbarhilfe?: () => void
  onToggleAmWarten?: () => void
  onToggleZuFuss?: () => void
  /** Editor-only: archive the incident (status → complete) directly from the card. */
  onRequestComplete?: () => void
  /** Editor-only: open the "Ressourcen übertragen" dialog for this incident. */
  onTransfer?: () => void
  /** Editor-only: open the Auftrag picker to distribute this incident into a route. */
  onDistributeToAuftrag?: () => void
  showMeldung?: boolean
  printerEnabled?: boolean
  /** Names of crew members currently assigned to >1 incident — surface conflict styling. */
  doubleBookedCrewNames?: Set<string>
  /** False for viewers: don't register the drag source at all — a drag whose
   *  PATCH is guaranteed to 403 must not offer a working-looking affordance. */
  canDrag?: boolean
  /** Notifies the sync layer that a card drag started/ended so remote reloads
   *  queue for the duration (a mid-drag reload aborts the native drag). */
  onDragActiveChange?: (dragging: boolean) => void
}

// Priority visual configuration - bold borders for quick scanning
// All cards always have border-l-4 to prevent layout shifts on hover/select
const priorityStyles = {
  high: {
    icon: 'text-destructive',
    card: 'border-l-destructive priority-high-pulse bg-destructive/[0.08] dark:bg-destructive/[0.12] ring-1 ring-destructive/20 dark:ring-destructive/30',
  },
  medium: {
    icon: 'text-warning',
    card: 'border-l-warning',
  },
  low: {
    icon: 'text-muted-foreground/50',
    card: 'border-l-transparent',
  },
} as const

function DraggableOperationBase({
  operation,
  columnColor,
  onRemoveCrew,
  onRemoveMaterial,
  onRemoveVehicle,
  onToggleDriverStay,
  onRemoveReko,
  onClick,
  onSelect,
  onHover,
  isHighlighted,
  isSelected,
  isKeyboardFocused,
  isDraggingRef,
  materials,
  index,
  columnOperations,
  formatLocation,
  onAssignResource,
  onAssignReko,
  onToggleNachbarhilfe,
  onToggleAmWarten,
  onToggleZuFuss,
  onRequestComplete,
  onTransfer,
  onDistributeToAuftrag,
  showMeldung,
  printerEnabled,
  doubleBookedCrewNames,
  canDrag = true,
  onDragActiveChange,
}: DraggableOperationProps) {
  const t = useTranslations('kanban')
  const ref = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isOver, setIsOver] = useState(false)
  const [closestEdge, setClosestEdge] = useState<Edge | null>(null)
  const [currentTime, setCurrentTime] = useState(new Date())
  const [isLargeScreen, setIsLargeScreen] = useState(false)
  const [isPrinting, setIsPrinting] = useState(false)
  const { materialGroups } = useMaterials()
  const { groups, getGroupResources } = useGroups()

  // Auftrag (route) membership chip — opening the Aufträge sheet is signalled to
  // the page via a window event (mirrors the driver-assignment-changed pattern),
  // avoiding prop threading through the column/side-panel render trees.
  const auftrag = operation.groupId ? groups.find((g) => g.id === operation.groupId) : undefined
  const auftragTotal = auftrag ? auftrag.stopIds.length : 0
  const auftragDone = auftrag ? auftrag.progress.done : 0
  // Grouped incidents carry no resources themselves — the route owns them. Read
  // the route's resource roll-up for the card chip summary.
  const auftragResources = auftrag ? getGroupResources(auftrag.id) : null
  const auftragSummary = auftragResources
    ? [
        auftragResources.vehicles.map((v) => v.name).join(', '),
        auftragResources.personnel.length ? t('card.auftragPersSummary', { count: auftragResources.personnel.length }) : '',
        auftragResources.materials.length ? t('card.auftragMatSummary', { count: auftragResources.materials.length }) : '',
      ]
        .filter(Boolean)
        .join(' · ')
    : ''

  // Handle thermal print
  const handlePrint = async () => {
    if (isPrinting) return
    setIsPrinting(true)
    try {
      await apiClient.queueAssignmentPrint(operation.id)
      toast.success(t('common.printJobSent'))
    } catch (error) {
      console.error('Print failed:', error)
      toast.error(t('common.printFailed'))
    } finally {
      setIsPrinting(false)
    }
  }

  // Detect screen width for sidebar vs modal behavior
  useEffect(() => {
    const checkWidth = () => {
      setIsLargeScreen(window.innerWidth >= SIDEPANEL_BREAKPOINT)
    }
    checkWidth()
    window.addEventListener('resize', checkWidth)
    return () => window.removeEventListener('resize', checkWidth)
  }, [])

  // Get priority styling configuration
  const priority = operation.priority || 'low'
  const priorityConfig = priorityStyles[priority as keyof typeof priorityStyles]

  // Auto-update time every minute to refresh age badges
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(new Date())
    }, 60000) // Update every minute

    return () => clearInterval(interval)
  }, [])

  // Calculate time in current status (recalculates when currentTime changes)
  // Use statusChangedAt if available, otherwise fall back to dispatchTime
  const timeInStatus = operation.statusChangedAt || operation.dispatchTime
  const minutesInStatus = Math.floor((currentTime.getTime() - timeInStatus.getTime()) / (1000 * 60))
  const isOverOneHour = minutesInStatus >= 60

  useEffect(() => {
    const element = ref.current
    if (!element) return

    return combine(
      ...(canDrag
        ? [
            draggable({
              element,
              getInitialData: () => ({ type: "operation", operation, index }),
              onDragStart: () => {
                setIsDragging(true)
                isDraggingRef.current = true
                onDragActiveChange?.(true)
              },
              onDrop: () => {
                setIsDragging(false)
                // Sync layer must know immediately — the click-suppression
                // delay below is only for the ref.
                onDragActiveChange?.(false)
                // Delay to prevent click from firing
                setTimeout(() => {
                  isDraggingRef.current = false
                }, 200)
              },
            }),
          ]
        : []),
      dropTargetForElements({
        element,
        canDrop: ({ source }) => {
          // Can drop anything on operation cards
          return true
        },
        getData: ({ input }) => {
          return attachClosestEdge(
            { type: "operation-drop", operationId: operation.id, index },
            { element, input, allowedEdges: ['top', 'bottom'] }
          )
        },
        onDragEnter: ({ self }) => {
          setIsOver(true)
          const edge = extractClosestEdge(self.data)
          setClosestEdge(edge)
        },
        onDrag: ({ self }) => {
          const edge = extractClosestEdge(self.data)
          setClosestEdge(edge)
        },
        onDragLeave: () => {
          setIsOver(false)
          setClosestEdge(null)
        },
        onDrop: () => {
          setIsOver(false)
          setClosestEdge(null)
        },
      })
    )
  }, [operation, index, isDraggingRef, canDrag, onDragActiveChange])

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="relative w-full">
          {closestEdge === 'top' && <DropIndicator edge="top" gap="4px" />}
          <Card
            ref={ref}
            style={{ opacity: isDragging ? 0.5 : 1 }}
            data-testid="incident-card"
            data-incident-id={operation.id}
            className={cn(
              'operation-card border border-border/50 border-l-4 bg-card/80 backdrop-blur-sm p-4 transition-all hover:bg-muted/30 cursor-pointer',
              // Priority styling (when not selected/highlighted)
              !isSelected && !isHighlighted && !isKeyboardFocused && priorityConfig?.card,
              isOver && 'bg-muted/20',
              // Selection/highlight states - preserve priority border colors
              isHighlighted && (priority === 'high' ? 'border-l-destructive bg-muted/30' : priority === 'medium' ? 'border-l-warning bg-muted/30' : 'border-l-foreground bg-muted/30'),
              isSelected && !isHighlighted && (priority === 'high' ? 'ring-2 ring-destructive/50 border-l-destructive/80 bg-muted/30 shadow-sm' : priority === 'medium' ? 'ring-2 ring-warning/50 border-l-warning/80 bg-muted/30 shadow-sm' : 'ring-2 ring-primary/50 border-l-foreground/70 bg-muted/30 shadow-sm'),
              isKeyboardFocused && !isHighlighted && !isSelected && (priority === 'high' ? 'border-l-destructive/50' : priority === 'medium' ? 'border-l-warning/50' : 'border-l-muted-foreground/50')
            )}
            onMouseEnter={() => onHover(operation.id)}
            onMouseLeave={() => onHover(null)}
            onClick={(e) => {
              // Only trigger click if not dragging
              if (!isDraggingRef.current) {
                // Large screen: select for sidebar, small screen: open modal
                if (isLargeScreen) {
                  onSelect?.()
                } else {
                  onClick()
                }
              }
            }}
          >
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-2">
            {/* Draggable area */}
            <div className="flex items-start gap-2 min-w-0 flex-1">
              <div className="flex items-center flex-shrink-0 mt-0.5">
                {/* Priority indicator - icon only, no colors */}
                {priority === "high" ? (
                  <ChevronUp className={cn('h-4 w-4', priorityConfig?.icon)} aria-label={t('card.priorityHighAria')} />
                ) : priority === "medium" ? (
                  <Minus className={cn('h-4 w-4', priorityConfig?.icon)} aria-label={t('card.priorityMediumAria')} />
                ) : (
                  <ChevronDown className={cn('h-4 w-4', priorityConfig?.icon)} aria-label={t('card.priorityLowAria')} />
                )}
              </div>
              <div className="min-w-0 flex-1">
                {formatLocation(operation.location) && (
                  <h3 className="font-bold text-base text-foreground leading-tight break-words">{formatLocation(operation.location)}</h3>
                )}
              </div>
            </div>
            {/* Non-draggable icons area */}
            <div className="flex items-center gap-1.5 flex-shrink-0">
              {operation.source === 'intake' && (
                <div
                  className="p-1.5 rounded-md bg-sky-100 dark:bg-sky-900/30"
                  title={t('card.intakeTooltip')}
                >
                  <Phone className="h-4 w-4 text-sky-600 dark:text-sky-400" />
                </div>
              )}
              {operation.amWarten && (
                <div
                  className="p-1.5 rounded-md bg-amber-100 dark:bg-amber-900/30"
                  title={t('common.amWarten')}
                >
                  <Timer className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                </div>
              )}
              {operation.nachbarhilfe && (
                <div
                  className="p-1.5 rounded-md bg-muted/60"
                  title={t('common.nachbarhilfe')}
                >
                  <Building2 className="h-4 w-4 text-muted-foreground/80" />
                </div>
              )}
              {operation.hasCompletedReko && (
                <div
                  className="p-1.5 rounded-md bg-muted/60"
                  title={t('card.rekoDoneTooltip')}
                >
                  <FileCheck className="h-4 w-4 text-muted-foreground/80" />
                </div>
              )}
              <Link
                href={`/map?highlight=${operation.id}`}
                onClick={(e) => e.stopPropagation()}
                className="p-1.5 rounded-md hover:bg-muted/80 transition-colors group/mapicon"
                title={t('card.showOnMap')}
              >
                <Map className="h-4 w-4 text-muted-foreground group-hover/mapicon:text-foreground transition-colors" />
              </Link>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Siren className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <span className="text-sm text-muted-foreground break-words">{getIncidentTypeLabel(operation.incidentType)}</span>
          </div>

          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <span className="font-mono text-sm text-muted-foreground">
                {operation.dispatchTime.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
            <span
              className={cn("font-mono text-xs", ageChipClass(timeInStatus))}
              title={isOverOneHour ? t('card.inStatusTooltip', { since: timeInStatus.toLocaleString("de-CH") }) : undefined}
            >
              {getTimeSince(timeInStatus)}
            </span>
          </div>

          {/* Meldung (notes) - shown when toggle is enabled */}
          {showMeldung && operation.notes && (
            <div className="border-t pt-3">
              <p className="text-xs text-muted-foreground line-clamp-3 whitespace-pre-wrap">
                {operation.notes}
              </p>
            </div>
          )}

          {/* Resource assignments - show names with quick removal */}
          {(operation.assignedReko || operation.crew.length > 0 || operation.zuFuss || operation.vehicles.length > 0 || operation.materials.length > 0 || operation.nachbarhilfe) && (
            <div className="border-t pt-3 space-y-1.5 text-xs">
              {/* Assigned Reko Person */}
              {operation.assignedReko && (
                <div className="flex items-start gap-1.5">
                  <Search className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0 mt-0.5" />
                  <div className="flex flex-wrap items-center gap-1 min-w-0">
                    <Badge
                      variant="secondary"
                      className="text-xs px-1.5 py-0.5 font-normal flex items-center gap-1 group hover:bg-destructive/10 transition-colors cursor-default"
                    >
                      <span>{operation.assignedReko.name}</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          onRemoveReko?.()
                        }}
                        className="opacity-0 group-hover:opacity-100 transition-opacity hover:text-destructive cursor-pointer"
                        title={t('common.removeNamed', { name: operation.assignedReko.name })}
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </Badge>
                    {/* Show arrival time if on site but report not yet submitted */}
                    {operation.rekoArrivedAt && !operation.hasCompletedReko && (
                      <span className="text-xs text-muted-foreground">
                        {t('card.onSiteSince', { time: operation.rekoArrivedAt.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' }) })}
                      </span>
                    )}
                  </div>
                </div>
              )}
              {!auftrag && operation.crew.length > 0 && (
                <div className="flex items-start gap-1.5">
                  <Users className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0 mt-0.5" />
                  <div className="flex flex-wrap gap-1 min-w-0">
                    {operation.crew.map((crewName) => {
                      const isConflict = doubleBookedCrewNames?.has(crewName) ?? false
                      return (
                        <Badge
                          key={crewName}
                          variant="secondary"
                          className={cn(
                            "text-xs px-1.5 py-0.5 font-normal flex items-center gap-1 group hover:bg-destructive/10 transition-colors cursor-default",
                            isConflict && "border border-warning/60 text-warning bg-warning/10",
                          )}
                          title={
                            isConflict
                              ? t('card.doubleBookedTooltip', { name: crewName })
                              : undefined
                          }
                        >
                          {isConflict && <AlertTriangle className="h-2.5 w-2.5" />}
                          <span>{crewName}</span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              onRemoveCrew(crewName)
                            }}
                            className="opacity-0 group-hover:opacity-100 transition-opacity hover:text-destructive cursor-pointer"
                            title={t('common.removeNamed', { name: crewName })}
                          >
                            <X className="h-2.5 w-2.5" />
                          </button>
                        </Badge>
                      )
                    })}
                  </div>
                </div>
              )}
              {!auftrag && (operation.zuFuss || operation.vehicles.length > 0) && (
                <div className="flex items-start gap-1.5">
                  <Truck className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0 mt-0.5" />
                  <div className="flex flex-wrap gap-1 min-w-0">
                    {operation.zuFuss && (
                      <Badge
                        variant="secondary"
                        className="text-xs px-1.5 py-0.5 font-normal flex items-center gap-1 group hover:bg-destructive/10 transition-colors cursor-default"
                      >
                        <Footprints className="h-3 w-3" />
                        <span>{t('common.zuFuss')}</span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            onToggleZuFuss?.()
                          }}
                          className="opacity-0 group-hover:opacity-100 transition-opacity hover:text-destructive cursor-pointer"
                          title={t('common.removeZuFuss')}
                        >
                          <X className="h-2.5 w-2.5" />
                        </button>
                      </Badge>
                    )}
                    {operation.vehicles.map((vehicleName) => {
                      const callsign = operation.vehicleCallsigns.get(vehicleName)
                      const driverStay = operation.vehicleDriverStay?.get(vehicleName)
                      return (
                      <Badge
                        key={vehicleName}
                        variant="secondary"
                        className="text-xs px-1.5 py-0.5 font-normal flex items-center gap-1 group transition-colors cursor-default"
                        title={callsign ? t('common.funkrufname', { callsign }) : undefined}
                      >
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            onToggleDriverStay?.(vehicleName)
                          }}
                          className="flex items-center gap-1 cursor-pointer"
                          title={driverStay ? t('common.driverStayTooltip') : t('common.driverReturnTooltip')}
                        >
                          <span>{vehicleName}{callsign ? ` · ${callsign}` : ''}</span>
                          {driverStay ? (
                            <MapPin className="h-3 w-3 text-muted-foreground/70" />
                          ) : (
                            <Undo2 className="h-3 w-3 text-muted-foreground/40" />
                          )}
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            onRemoveVehicle(vehicleName)
                          }}
                          className="opacity-0 group-hover:opacity-100 transition-opacity hover:text-destructive cursor-pointer"
                          title={t('common.removeNamed', { name: vehicleName })}
                        >
                          <X className="h-2.5 w-2.5" />
                        </button>
                      </Badge>
                      )
                    })}
                  </div>
                </div>
              )}
              {!auftrag && operation.materials.length > 0 && (
                <div className="flex items-start gap-1.5">
                  <Package className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0 mt-0.5" />
                  <div className="flex flex-wrap gap-1 min-w-0">
                    {(() => {
                      // Group assigned materials by their material group
                      // Only show as group badge if ALL materials in the group are assigned
                      const ungrouped: string[] = []
                      const grouped: Record<string, string[]> = {}
                      for (const materialId of operation.materials) {
                        const material = materials.find(m => m.id === materialId)
                        const groupId = material?.groupId
                        const group = groupId ? materialGroups.find(g => g.id === groupId) : null
                        if (group) {
                          if (!grouped[group.id]) grouped[group.id] = []
                          grouped[group.id].push(materialId)
                        } else {
                          ungrouped.push(materialId)
                        }
                      }
                      // Check completeness — partial groups become ungrouped items
                      const completeGroups: Record<string, string[]> = {}
                      for (const [groupId, matIds] of Object.entries(grouped)) {
                        const group = materialGroups.find(g => g.id === groupId)
                        if (group && matIds.length === group.materialIds.length) {
                          completeGroups[groupId] = matIds
                        } else {
                          ungrouped.push(...matIds)
                        }
                      }
                      return (
                        <>
                          {/* Complete groups shown as single group badge */}
                          {Object.entries(completeGroups).map(([groupId, matIds]) => {
                            const group = materialGroups.find(g => g.id === groupId)!
                            return (
                              <Badge
                                key={`group-${groupId}`}
                                variant="secondary"
                                className="text-xs px-1.5 py-0.5 font-normal flex items-center gap-1 group hover:bg-destructive/10 transition-colors cursor-default"
                              >
                                <Layers className="h-2.5 w-2.5 text-muted-foreground" />
                                <span>{group.name}</span>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    // Remove all materials in this group from the operation
                                    for (const matId of matIds) {
                                      onRemoveMaterial(matId)
                                    }
                                  }}
                                  className="opacity-0 group-hover:opacity-100 transition-opacity hover:text-destructive cursor-pointer"
                                  title={t('common.removeNamed', { name: group.name })}
                                >
                                  <X className="h-2.5 w-2.5" />
                                </button>
                              </Badge>
                            )
                          })}
                          {/* Ungrouped materials shown individually */}
                          {ungrouped.map((materialId, idx) => {
                            const material = materials.find(m => m.id === materialId)
                            return (
                              <Badge
                                key={idx}
                                variant="secondary"
                                className="text-xs px-1.5 py-0.5 font-normal flex items-center gap-1 group hover:bg-destructive/10 transition-colors cursor-default"
                              >
                                <span>{material?.name || materialId}</span>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    onRemoveMaterial(materialId)
                                  }}
                                  className="opacity-0 group-hover:opacity-100 transition-opacity hover:text-destructive cursor-pointer"
                                  title={t('common.removeNamed', { name: material?.name || materialId })}
                                >
                                  <X className="h-2.5 w-2.5" />
                                </button>
                              </Badge>
                            )
                          })}
                        </>
                      )
                    })()}
                  </div>
                </div>
              )}
              {operation.nachbarhilfe && (
                <div className="flex items-start gap-1.5">
                  <Building2 className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0 mt-0.5" />
                  <div className="flex flex-wrap items-center gap-1 min-w-0">
                    <span className="text-muted-foreground break-words">
                      {operation.nachbarhilfeNote || t('common.nachbarhilfe')}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Auftrag (route) membership — rendered as a labelled resource-style row
              (matching the crew/vehicle/material rows above) rather than a floating
              pill. Resources live on the route, so the row carries the route name,
              its done/total progress, and the route's resource roll-up. The whole
              row opens the Aufträge sheet. */}
          {auftrag && (
            <div className="border-t pt-3 text-xs">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  window.dispatchEvent(new CustomEvent('kp:open-auftraege', { detail: { groupId: auftrag.id } }))
                }}
                className="group/auftrag flex w-full items-start gap-1.5 text-left transition-colors"
                title={t('card.auftragChipTooltip', { name: auftrag.name })}
              >
                <Waypoints className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0 mt-0.5" />
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-0.5">
                  <span
                    className="h-2 w-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: auftrag.color ?? 'var(--muted-foreground)' }}
                  />
                  <span className="font-medium text-foreground/80 group-hover/auftrag:text-foreground transition-colors">
                    {auftrag.name}
                  </span>
                  <span className="tabular-nums text-muted-foreground flex-shrink-0">{auftragDone}/{auftragTotal}</span>
                  {auftragSummary && (
                    <>
                      <span className="text-muted-foreground/40">·</span>
                      <span className="truncate text-muted-foreground">{auftragSummary}</span>
                    </>
                  )}
                </div>
              </button>
            </div>
          )}

          {/* Reko Summary */}
          {operation.rekoSummary && (
            <div className="border-t pt-3 space-y-1.5">
              {operation.rekoSummary.hasDangers && operation.rekoSummary.dangerTypes.length > 0 && (
                <div className="flex items-start gap-1.5">
                  <AlertTriangle className="h-3 w-3 text-muted-foreground flex-shrink-0 mt-0.5" />
                  <div className="flex flex-wrap gap-1">
                    {operation.rekoSummary.dangerTypes.map((danger, idx) => (
                      <Badge key={idx} variant="outline" className="text-xs px-1.5 py-0.5">
                        {danger}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              <div className="text-xs text-muted-foreground">
                {operation.rekoSummary.personnelCount && (
                  <span className="mr-3">{t('card.persCount', { count: operation.rekoSummary.personnelCount })}</span>
                )}
                {operation.rekoSummary.estimatedDuration && (
                  <span>{operation.rekoSummary.estimatedDuration}h</span>
                )}
              </div>
            </div>
          )}
        </div>
          </Card>
          {closestEdge === 'bottom' && <DropIndicator edge="bottom" gap="4px" />}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent
        className="w-52 max-h-[var(--radix-context-menu-content-available-height)] overflow-y-auto"
        collisionPadding={{ top: 8, bottom: 80, left: 8, right: 8 }}
      >
        {/* Bearbeiten */}
        <ContextMenuItem onClick={() => isLargeScreen ? onSelect?.() : onClick()}>
          <PenLine className="mr-2 h-4 w-4" />
          {t('common.edit')}
        </ContextMenuItem>

        {/* Zuweisen — reko, crew, vehicle, material, and resource transfer */}
        {(onAssignReko || onAssignResource || onTransfer || onDistributeToAuftrag) && (
          <>
            <ContextMenuSeparator />
            {onAssignReko && (
              <ContextMenuItem onClick={() => onAssignReko()}>
                <Binoculars className="mr-2 h-4 w-4" />
                {operation.assignedReko ? t('card.changeReko') : t('card.assignReko')}
              </ContextMenuItem>
            )}
            {onAssignResource && (
              <>
                <ContextMenuItem onClick={() => onAssignResource('crew', operation.id)}>
                  <Users className="mr-2 h-4 w-4" />
                  {t('common.assignCrew')}
                </ContextMenuItem>
                <ContextMenuItem onClick={() => onAssignResource('vehicles', operation.id)}>
                  <Truck className="mr-2 h-4 w-4" />
                  {t('common.assignVehicle')}
                </ContextMenuItem>
                <ContextMenuItem onClick={() => onAssignResource('materials', operation.id)}>
                  <Package className="mr-2 h-4 w-4" />
                  {t('common.assignMaterial')}
                </ContextMenuItem>
              </>
            )}
            {onTransfer && (
              <ContextMenuItem onClick={() => onTransfer()}>
                <ArrowRightLeft className="mr-2 h-4 w-4" />
                {t('common.transferResources')}
              </ContextMenuItem>
            )}
            {onDistributeToAuftrag && (
              <ContextMenuItem onClick={() => onDistributeToAuftrag()}>
                <Waypoints className="mr-2 h-4 w-4" />
                {t('common.distributeToAuftrag')}
              </ContextMenuItem>
            )}
          </>
        )}

        {/* Markieren — quick status flags */}
        {(onToggleZuFuss || onToggleNachbarhilfe || onToggleAmWarten) && (
          <>
            <ContextMenuSeparator />
            {onToggleZuFuss && (
              <ContextMenuItem onClick={() => onToggleZuFuss()}>
                <Footprints className="mr-2 h-4 w-4" />
                {operation.zuFuss ? t('common.removeZuFuss') : t('card.markZuFuss')}
              </ContextMenuItem>
            )}
            {onToggleNachbarhilfe && (
              <ContextMenuItem onClick={() => onToggleNachbarhilfe()}>
                <Building2 className="mr-2 h-4 w-4" />
                {operation.nachbarhilfe ? t('card.removeNachbarhilfe') : t('card.markNachbarhilfe')}
              </ContextMenuItem>
            )}
            {onToggleAmWarten && (
              <ContextMenuItem onClick={() => onToggleAmWarten()}>
                <Timer className="mr-2 h-4 w-4" />
                {operation.amWarten ? t('card.removeAmWarten') : t('card.markAmWarten')}
              </ContextMenuItem>
            )}
          </>
        )}

        {/* Status — lifecycle. Editor-only: archive an incident that turned out
            not to be relevant (same completion path as dragging to ABGESCHLOSSEN). */}
        {onRequestComplete && operation.status !== "complete" && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => onRequestComplete()}>
              <CheckCircle2 className="mr-2 h-4 w-4" />
              {t('card.completeIncident')}
            </ContextMenuItem>
          </>
        )}

        {/* Ansicht & Druck */}
        <ContextMenuSeparator />
        <ContextMenuItem asChild>
          <Link href={`/map?highlight=${operation.id}`}>
            <Map className="mr-2 h-4 w-4" />
            {t('card.showOnMapMenu')}
          </Link>
        </ContextMenuItem>
        {printerEnabled && (
          <ContextMenuItem onClick={handlePrint} disabled={isPrinting}>
            <Printer className="mr-2 h-4 w-4" />
            {isPrinting ? t('card.printing') : t('common.printSlip')}
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}

// Memoize the component to prevent unnecessary re-renders
// Only re-render if props actually change (deep comparison)
export const DraggableOperation = memo(DraggableOperationBase, (prevProps, nextProps) => {
  // Check if REKO summary has changed
  const rekoSummaryChanged =
    prevProps.operation.hasCompletedReko !== nextProps.operation.hasCompletedReko ||
    prevProps.operation.rekoArrivedAt?.getTime() !== nextProps.operation.rekoArrivedAt?.getTime() ||
    (prevProps.operation.rekoSummary?.hasDangers !== nextProps.operation.rekoSummary?.hasDangers) ||
    (prevProps.operation.rekoSummary?.dangerTypes.length !== nextProps.operation.rekoSummary?.dangerTypes.length) ||
    (prevProps.operation.rekoSummary?.personnelCount !== nextProps.operation.rekoSummary?.personnelCount) ||
    (prevProps.operation.rekoSummary?.estimatedDuration !== nextProps.operation.rekoSummary?.estimatedDuration)

  // Check if assigned reko has changed
  const assignedRekoChanged =
    prevProps.operation.assignedReko?.id !== nextProps.operation.assignedReko?.id

  return (
    prevProps.operation.id === nextProps.operation.id &&
    prevProps.operation.status === nextProps.operation.status &&
    prevProps.operation.priority === nextProps.operation.priority &&
    prevProps.operation.location === nextProps.operation.location &&
    prevProps.operation.notes === nextProps.operation.notes &&
    prevProps.operation.nachbarhilfe === nextProps.operation.nachbarhilfe &&
    prevProps.operation.amWarten === nextProps.operation.amWarten &&
    prevProps.operation.zuFuss === nextProps.operation.zuFuss &&
    prevProps.operation.source === nextProps.operation.source &&
    prevProps.operation.groupId === nextProps.operation.groupId &&
    prevProps.operation.groupPosition === nextProps.operation.groupPosition &&
    prevProps.operation.crew.length === nextProps.operation.crew.length &&
    prevProps.operation.crew.every((c, i) => c === nextProps.operation.crew[i]) &&
    prevProps.operation.materials.length === nextProps.operation.materials.length &&
    prevProps.operation.materials.every((m, i) => m === nextProps.operation.materials[i]) &&
    prevProps.operation.vehicles.length === nextProps.operation.vehicles.length &&
    prevProps.operation.vehicles.every((v, i) => v === nextProps.operation.vehicles[i]) &&
    prevProps.operation.vehicles.every((v) => prevProps.operation.vehicleDriverStay?.get(v) === nextProps.operation.vehicleDriverStay?.get(v)) &&
    prevProps.columnColor === nextProps.columnColor &&
    prevProps.isHighlighted === nextProps.isHighlighted &&
    prevProps.isSelected === nextProps.isSelected &&
    prevProps.isKeyboardFocused === nextProps.isKeyboardFocused &&
    prevProps.index === nextProps.index &&
    prevProps.showMeldung === nextProps.showMeldung &&
    !rekoSummaryChanged &&
    !assignedRekoChanged &&
    // Conflict set: identity check is enough — page.tsx memoizes the Set
    // via useMemo, so a new reference means the underlying value changed.
    prevProps.doubleBookedCrewNames === nextProps.doubleBookedCrewNames
  )
})
