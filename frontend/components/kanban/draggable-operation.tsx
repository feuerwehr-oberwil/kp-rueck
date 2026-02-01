"use client"

import { useEffect, useRef, useState, memo } from "react"
import Link from "next/link"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { Clock, Users, Package, X, Truck, Siren, MapIcon, FileCheck, AlertTriangle, ChevronUp, ChevronDown, Minus, Search, Binoculars, PenLine, Map, Building2 } from 'lucide-react'
import { draggable, dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine'
import { attachClosestEdge, extractClosestEdge, type Edge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge'
import { DropIndicator } from '@atlaskit/pragmatic-drag-and-drop-react-drop-indicator/box'
import { type Operation, type Material } from "@/lib/contexts/operations-context"
import { getTimeSince } from "@/lib/kanban-utils"
import { getIncidentTypeLabel } from "@/lib/incident-types"
import { cn } from "@/lib/utils"

// Must match SIDEPANEL_BREAKPOINT in side-panel.tsx
const SIDEPANEL_BREAKPOINT = 1536

interface DraggableOperationProps {
  operation: Operation
  columnColor: string
  onRemoveCrew: (crewName: string) => void
  onRemoveMaterial: (materialId: string) => void
  onRemoveVehicle: (vehicleName: string) => void
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
  showMeldung?: boolean
}

// Priority visual configuration - subtle color for high priority only
const priorityStyles = {
  high: {
    icon: 'text-red-400',
    card: 'border-l-2 border-l-red-400/50',
  },
  medium: {
    icon: 'text-muted-foreground',
    card: '',
  },
  low: {
    icon: 'text-muted-foreground/50',
    card: '',
  },
} as const

function DraggableOperationBase({
  operation,
  columnColor,
  onRemoveCrew,
  onRemoveMaterial,
  onRemoveVehicle,
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
  showMeldung,
}: DraggableOperationProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isOver, setIsOver] = useState(false)
  const [closestEdge, setClosestEdge] = useState<Edge | null>(null)
  const [currentTime, setCurrentTime] = useState(new Date())
  const [isLargeScreen, setIsLargeScreen] = useState(false)

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
      draggable({
        element,
        getInitialData: () => ({ type: "operation", operation, index }),
        onDragStart: () => {
          setIsDragging(true)
          isDraggingRef.current = true
        },
        onDrop: () => {
          setIsDragging(false)
          // Delay to prevent click from firing
          setTimeout(() => {
            isDraggingRef.current = false
          }, 200)
        },
      }),
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
  }, [operation, index, isDraggingRef])

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="relative w-full">
          {closestEdge === 'top' && <DropIndicator edge="top" gap="4px" />}
          <Card
            ref={ref}
            style={{ opacity: isDragging ? 0.5 : 1 }}
            data-incident-id={operation.id}
            className={cn(
              'operation-card border border-border/50 bg-card/80 backdrop-blur-sm p-4 transition-all hover:bg-muted/30 cursor-pointer',
              // Priority styling (when not selected/highlighted)
              !isSelected && !isHighlighted && !isKeyboardFocused && priorityConfig?.card,
              isOver && 'bg-muted/20',
              // Selection/highlight states - use red for high priority
              isHighlighted && (priority === 'high' ? 'border-l-4 border-l-red-400 bg-muted/30' : 'border-l-4 border-l-foreground bg-muted/30'),
              isSelected && !isHighlighted && (priority === 'high' ? 'border-l-4 border-l-red-400/80 bg-muted/20 shadow-sm' : 'border-l-4 border-l-foreground/70 bg-muted/20 shadow-sm'),
              isKeyboardFocused && !isHighlighted && !isSelected && (priority === 'high' ? 'border-l-2 border-l-red-400/50' : 'border-l-2 border-l-muted-foreground/50')
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
                  <ChevronUp className={cn('h-4 w-4', priorityConfig?.icon)} aria-label="Hohe Priorität" />
                ) : priority === "medium" ? (
                  <Minus className={cn('h-4 w-4', priorityConfig?.icon)} aria-label="Mittlere Priorität" />
                ) : (
                  <ChevronDown className={cn('h-4 w-4', priorityConfig?.icon)} aria-label="Niedrige Priorität" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="font-bold text-base text-foreground leading-tight break-words">{formatLocation(operation.location)}</h3>
              </div>
            </div>
            {/* Non-draggable icons area */}
            <div className="flex items-center gap-1.5 flex-shrink-0">
              {operation.nachbarhilfe && (
                <div
                  className="p-1.5 rounded-md bg-muted/60"
                  title="Nachbarhilfe"
                >
                  <Building2 className="h-4 w-4 text-muted-foreground/80" />
                </div>
              )}
              {operation.hasCompletedReko && (
                <div
                  className="p-1.5 rounded-md bg-muted/60"
                  title="Reko-Bericht ausgefüllt"
                >
                  <FileCheck className="h-4 w-4 text-muted-foreground/80" />
                </div>
              )}
              <Link
                href={`/map?highlight=${operation.id}`}
                onClick={(e) => e.stopPropagation()}
                className="p-1.5 rounded-md hover:bg-muted/80 transition-colors group/mapicon"
                title="Auf Karte anzeigen"
              >
                <MapIcon className="h-4 w-4 text-muted-foreground group-hover/mapicon:text-foreground transition-colors" />
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
                {operation.dispatchTime.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
            <span
              className={cn(
                "font-mono text-xs text-muted-foreground",
                isOverOneHour && "font-medium"
              )}
              title={isOverOneHour ? `In diesem Status seit über 1 Stunde (seit ${timeInStatus.toLocaleString("de-DE")})` : undefined}
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
          {(operation.assignedReko || operation.crew.length > 0 || operation.vehicles.length > 0 || operation.materials.length > 0) && (
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
                        title={`${operation.assignedReko.name} entfernen`}
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </Badge>
                    {/* Show arrival time if on site but report not yet submitted */}
                    {operation.rekoArrivedAt && !operation.hasCompletedReko && (
                      <span className="text-xs text-muted-foreground">
                        vor Ort {operation.rekoArrivedAt.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    )}
                  </div>
                </div>
              )}
              {operation.crew.length > 0 && (
                <div className="flex items-start gap-1.5">
                  <Users className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0 mt-0.5" />
                  <div className="flex flex-wrap gap-1 min-w-0">
                    {operation.crew.map((crewName, idx) => (
                      <Badge
                        key={idx}
                        variant="secondary"
                        className="text-xs px-1.5 py-0.5 font-normal flex items-center gap-1 group hover:bg-destructive/10 transition-colors cursor-default"
                      >
                        <span>{crewName}</span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            onRemoveCrew(crewName)
                          }}
                          className="opacity-0 group-hover:opacity-100 transition-opacity hover:text-destructive cursor-pointer"
                          title={`${crewName} entfernen`}
                        >
                          <X className="h-2.5 w-2.5" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              {operation.vehicles.length > 0 && (
                <div className="flex items-start gap-1.5">
                  <Truck className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0 mt-0.5" />
                  <div className="flex flex-wrap gap-1 min-w-0">
                    {operation.vehicles.map((vehicleName, idx) => (
                      <Badge key={idx} variant="secondary" className="text-xs px-1.5 py-0.5 font-normal cursor-default">
                        {vehicleName}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              {operation.materials.length > 0 && (
                <div className="flex items-start gap-1.5">
                  <Package className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0 mt-0.5" />
                  <div className="flex flex-wrap gap-1 min-w-0">
                    {operation.materials.map((materialId, idx) => {
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
                            title={`${material?.name || materialId} entfernen`}
                          >
                            <X className="h-2.5 w-2.5" />
                          </button>
                        </Badge>
                      )
                    })}
                  </div>
                </div>
              )}
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
                  <span className="mr-3">{operation.rekoSummary.personnelCount} Pers.</span>
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
      <ContextMenuContent className="w-52">
        <ContextMenuItem onClick={() => isLargeScreen ? onSelect?.() : onClick()}>
          <PenLine className="mr-2 h-4 w-4" />
          Bearbeiten
        </ContextMenuItem>
        <ContextMenuSeparator />
        {onAssignReko && (
          <ContextMenuItem onClick={() => onAssignReko()}>
            <Binoculars className="mr-2 h-4 w-4" />
            {operation.assignedReko ? 'Reko ändern' : 'Reko zuweisen'}
          </ContextMenuItem>
        )}
        {onAssignResource && (
          <ContextMenuItem onClick={() => onAssignResource('vehicles', operation.id)}>
            <Truck className="mr-2 h-4 w-4" />
            Fahrzeug zuweisen
          </ContextMenuItem>
        )}
        {onToggleNachbarhilfe && (
          <ContextMenuItem onClick={() => onToggleNachbarhilfe()}>
            <Building2 className="mr-2 h-4 w-4" />
            {operation.nachbarhilfe ? 'Nachbarhilfe entfernen' : 'Als Nachbarhilfe markieren'}
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem asChild>
          <Link href={`/map?highlight=${operation.id}`}>
            <Map className="mr-2 h-4 w-4" />
            Auf Karte zeigen
          </Link>
        </ContextMenuItem>
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
    prevProps.operation.crew.length === nextProps.operation.crew.length &&
    prevProps.operation.materials.length === nextProps.operation.materials.length &&
    prevProps.operation.vehicles.length === nextProps.operation.vehicles.length &&
    prevProps.columnColor === nextProps.columnColor &&
    prevProps.isHighlighted === nextProps.isHighlighted &&
    prevProps.isSelected === nextProps.isSelected &&
    prevProps.isKeyboardFocused === nextProps.isKeyboardFocused &&
    prevProps.index === nextProps.index &&
    prevProps.showMeldung === nextProps.showMeldung &&
    !rekoSummaryChanged &&
    !assignedRekoChanged
  )
})
