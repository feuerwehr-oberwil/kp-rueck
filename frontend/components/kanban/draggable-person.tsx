"use client"

import { useEffect, useRef, useState, memo } from "react"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { draggable } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { type Person } from "@/lib/contexts/operations-context"
import { PersonContextMenu } from "./person-context-menu"
import { Car, Binoculars, Package2, Check, Minus } from 'lucide-react'
import { cn } from "@/lib/utils"

interface DraggablePersonProps {
  person: Person
  onClick?: () => void
  disabled?: boolean
}

function DraggablePersonBase({ person, onClick, disabled }: DraggablePersonProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)

  // Reko personnel can be dragged even when assigned (they can be on multiple incidents)
  // Drivers can be dragged to assign their vehicle to an incident
  const canDrag = !disabled && (person.status === "available" || person.isReko || person.isDriver)

  useEffect(() => {
    const element = ref.current
    if (!element || !canDrag) return

    return draggable({
      element,
      getInitialData: () => {
        // Drivers drag as vehicles, not as persons
        if (person.isDriver && person.driverVehicleId && person.driverVehicleName) {
          return {
            type: "driver-vehicle",
            person,
            vehicleId: person.driverVehicleId,
            vehicleName: person.driverVehicleName,
          }
        }
        return { type: "person", person }
      },
      onDragStart: () => setIsDragging(true),
      onDrop: () => setIsDragging(false),
    })
  }, [person, canDrag])

  // Render badges from Person props (already computed in operations context)
  const renderSpecialFunctionBadges = () => {
    const badges = []

    // Driver badge (show vehicle name)
    if (person.isDriver && person.driverVehicleName) {
      badges.push(
        <Badge key={`driver-${person.driverVehicleId}`} variant="secondary" className="text-xs font-normal px-1.5 py-0 gap-1">
          <Car className="h-3 w-3" />
          {person.driverVehicleName}
        </Badge>
      )
    }

    // Reko badge
    if (person.isReko) {
      badges.push(
        <Badge key="reko" variant="secondary" className="text-xs font-normal px-1.5 py-0 gap-1">
          <Binoculars className="h-3 w-3" />
          Reko
        </Badge>
      )
    }

    // Magazin badge
    if (person.isMagazin) {
      badges.push(
        <Badge key="magazin" variant="secondary" className="text-xs font-normal px-1.5 py-0 gap-1">
          <Package2 className="h-3 w-3" />
          Magazin
        </Badge>
      )
    }

    return badges
  }

  const specialFunctionBadges = renderSpecialFunctionBadges()

  return (
    <PersonContextMenu
      personnelId={person.id}
      personnelName={person.name}
    >
      <Card
        ref={ref}
        onClick={onClick}
        role={canDrag ? "button" : undefined}
        aria-grabbed={isDragging}
        aria-label={canDrag ? `Drag ${person.name} to assign to incident` : undefined}
        className={cn(
          "border border-border/50 bg-card/80 backdrop-blur-sm px-3 py-2 gap-0 transition-all hover:bg-muted/50 hover:border-border",
          canDrag && "draggable",
          isDragging && "dragging",
          isDragging && person.isDriver && "ring-2 ring-blue-500/50",
          // Assigned reko personnel: subtle visual distinction but still draggable
          // Use border and background colors instead of opacity for WCAG contrast compliance
          canDrag && person.isReko && person.status === "assigned" && "bg-muted/30 border-border/30",
          // Non-reko assigned personnel: clear visual indication they're not draggable
          !canDrag && person.status === "assigned" && "cursor-not-allowed opacity-60",
          !canDrag && person.status !== "assigned" && "cursor-pointer"
        )}
      >
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              {/* Status indicator - icon only, muted colors */}
              <div
                className="flex items-center justify-center h-4 w-4 rounded flex-shrink-0 text-muted-foreground"
                aria-label={person.status === "available" ? "Verfügbar" : "Im Einsatz"}
                title={person.status === "available" ? "Verfügbar" : "Im Einsatz"}
              >
                {person.status === "available" ? (
                  <Check className="h-3 w-3" />
                ) : (
                  <Minus className="h-3 w-3" />
                )}
              </div>

              <span className="font-medium text-sm text-foreground truncate">{person.name}</span>
            </div>

            {/* Tags */}
            <div className="flex items-center gap-1 flex-shrink-0">
              {person.tags && person.tags.length > 0 ? (
                <div className="flex gap-1">
                  {person.tags.map((tag) => (
                    <Badge key={tag} variant="outline" className="text-xs font-normal px-1.5 py-0">
                      {tag}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          {/* Special function badges */}
          {specialFunctionBadges.length > 0 && (
            <div className="flex gap-1 flex-wrap pl-4">
              {specialFunctionBadges}
            </div>
          )}
        </div>
      </Card>
    </PersonContextMenu>
  )
}

// Memoize the component to prevent unnecessary re-renders
export const DraggablePerson = memo(DraggablePersonBase, (prevProps, nextProps) => {
  return (
    prevProps.person.id === nextProps.person.id &&
    prevProps.person.status === nextProps.person.status &&
    prevProps.person.name === nextProps.person.name &&
    prevProps.person.role === nextProps.person.role &&
    prevProps.person.isReko === nextProps.person.isReko &&
    prevProps.person.isDriver === nextProps.person.isDriver &&
    prevProps.person.driverVehicleName === nextProps.person.driverVehicleName &&
    prevProps.person.isMagazin === nextProps.person.isMagazin &&
    JSON.stringify(prevProps.person.tags) === JSON.stringify(nextProps.person.tags) &&
    prevProps.disabled === nextProps.disabled
  )
})
