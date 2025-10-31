"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Clock, Users, Package, X, Truck, Siren, MapIcon } from 'lucide-react'
import { draggable, dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine'
import { attachClosestEdge, extractClosestEdge, type Edge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge'
import { DropIndicator } from '@atlaskit/pragmatic-drag-and-drop-react-drop-indicator/box'
import { type Operation, type Material } from "@/lib/contexts/operations-context"
import { getTimeSince } from "@/lib/kanban-utils"
import { getIncidentTypeLabel } from "@/lib/incident-types"

interface DraggableOperationProps {
  operation: Operation
  columnColor: string
  onRemoveCrew: (crewName: string) => void
  onRemoveMaterial: (materialId: string) => void
  onRemoveVehicle: (vehicleName: string) => void
  onClick: () => void
  onHover: (opId: string | null) => void
  isHighlighted?: boolean
  isDraggingRef: React.MutableRefObject<boolean>
  materials: Material[]
  index: number
  columnOperations: Operation[]
  formatLocation: (address: string) => string
}

export function DraggableOperation({
  operation,
  columnColor,
  onRemoveCrew,
  onRemoveMaterial,
  onRemoveVehicle,
  onClick,
  onHover,
  isHighlighted,
  isDraggingRef,
  materials,
  index,
  columnOperations,
  formatLocation,
}: DraggableOperationProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isOver, setIsOver] = useState(false)
  const [closestEdge, setClosestEdge] = useState<Edge | null>(null)

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
    <div className="relative w-full">
      {closestEdge === 'top' && <DropIndicator edge="top" gap="4px" />}
      <Card
        ref={ref}
        style={{ opacity: isDragging ? 0.5 : 1 }}
        data-incident-id={operation.id}
        className={`${columnColor} border border-border/50 backdrop-blur-sm p-4 transition-all hover:border-primary/50 hover:shadow-lg cursor-pointer ${isOver ? "ring-2 ring-primary" : ""} ${isHighlighted ? "ring-4 ring-accent animate-pulse" : ""}`}
        onMouseEnter={() => onHover(operation.id)}
        onMouseLeave={() => onHover(null)}
        onClick={(e) => {
          // Only trigger click if not dragging
          if (!isDraggingRef.current) {
            onClick()
          }
        }}
      >
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-2">
            {/* Draggable area */}
            <div className="flex items-start gap-2 min-w-0 flex-1">
              <div
                className={`h-2.5 w-2.5 rounded-full flex-shrink-0 mt-1 ${
                  operation.priority === "high" ? "bg-red-500" : operation.priority === "medium" ? "bg-yellow-500" : "bg-green-500"
                }`}
                title={operation.priority === "high" ? "Hohe Priorität" : operation.priority === "medium" ? "Mittlere Priorität" : "Niedrige Priorität"}
              />
              <div className="min-w-0 flex-1">
                <h3 className="font-bold text-base text-foreground leading-tight break-words">{formatLocation(operation.location)}</h3>
              </div>
            </div>
            {/* Non-draggable icons area */}
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <Link
                href={`/map?highlight=${operation.id}`}
                onClick={(e) => e.stopPropagation()}
                className="p-1.5 rounded-md hover:bg-primary/20 transition-colors"
                title="Auf Karte anzeigen"
              >
                <MapIcon className="h-4 w-4 text-muted-foreground" />
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
            <span className="font-mono text-xs text-muted-foreground">
              {getTimeSince(operation.statusChangedAt || operation.dispatchTime)}
            </span>
          </div>

          {operation.vehicles.length > 0 && (
            <div className="flex items-start gap-2">
              <Truck className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
              <div className="flex flex-wrap gap-1.5">
                {operation.vehicles.map((vehicleName, idx) => (
                  <Badge
                    key={idx}
                    variant="secondary"
                    className="text-xs gap-1 pr-1 group hover:bg-destructive/20 transition-colors"
                  >
                    {vehicleName}
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onRemoveVehicle(vehicleName)
                      }}
                      className="ml-1 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {operation.crew.length > 0 && (
            <div className="flex items-start gap-2">
              <Users className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
              <div className="flex flex-wrap gap-1.5">
                {operation.crew.map((member, idx) => (
                  <Badge
                    key={idx}
                    variant="secondary"
                    className="text-xs gap-1 pr-1 group hover:bg-destructive/20 transition-colors"
                  >
                    {member.split(" ")[0][0]}.{member.split(" ")[1][0]}
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onRemoveCrew(member)
                      }}
                      className="ml-1 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {operation.materials.length > 0 && (
            <div className="flex items-start gap-2">
              <Package className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
              <div className="flex flex-wrap gap-1.5">
                {operation.materials.map((matId, idx) => {
                  const mat = materials.find(m => m.id === matId)
                  return (
                    <Badge
                      key={idx}
                      variant="outline"
                      className="text-xs gap-1 pr-1 group hover:bg-destructive/20 transition-colors"
                    >
                      {mat?.name.substring(0, 15) || matId}
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          onRemoveMaterial(matId)
                        }}
                        className="ml-1 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </Card>
      {closestEdge === 'bottom' && <DropIndicator edge="bottom" gap="4px" />}
    </div>
  )
}
