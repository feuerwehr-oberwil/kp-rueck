"use client"

import { useEffect, useRef, useState, memo } from "react"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { draggable } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { type Person } from "@/lib/contexts/operations-context"
import { PersonContextMenu } from "./person-context-menu"
import { apiClient, type ApiEventSpecialFunctionResponse } from "@/lib/api-client"
import { useEvent } from "@/lib/contexts/event-context"
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
  const [specialFunctions, setSpecialFunctions] = useState<ApiEventSpecialFunctionResponse[]>([])
  const { selectedEvent } = useEvent()

  // Reko personnel can be dragged even when assigned (they can be on multiple incidents)
  const canDrag = !disabled && (person.status === "available" || person.isReko)

  // Load special functions for this person
  useEffect(() => {
    const loadSpecialFunctions = async () => {
      if (!selectedEvent) return

      try {
        const functions = await apiClient.getPersonnelSpecialFunctions(selectedEvent.id, person.id)
        setSpecialFunctions(functions)
      } catch (error) {
        console.error('Failed to load special functions:', error)
      }
    }

    loadSpecialFunctions()
  }, [selectedEvent, person.id])

  useEffect(() => {
    const element = ref.current
    if (!element || !canDrag) return

    return draggable({
      element,
      getInitialData: () => ({ type: "person", person }),
      onDragStart: () => setIsDragging(true),
      onDrop: () => setIsDragging(false),
    })
  }, [person, canDrag])

  const refreshSpecialFunctions = async () => {
    if (!selectedEvent) return

    try {
      const functions = await apiClient.getPersonnelSpecialFunctions(selectedEvent.id, person.id)
      setSpecialFunctions(functions)
    } catch (error) {
      console.error('Failed to refresh special functions:', error)
    }
  }

  const renderSpecialFunctionBadges = () => {
    const badges = []

    // Driver badges (show vehicle name)
    const driverFunctions = specialFunctions.filter(f => f.function_type === 'driver')
    driverFunctions.forEach(df => {
      if (df.vehicle_name) {
        badges.push(
          <Badge key={`driver-${df.vehicle_id}`} variant="secondary" className="text-xs font-normal px-1.5 py-0 gap-1">
            <Car className="h-3 w-3" />
            {df.vehicle_name}
          </Badge>
        )
      }
    })

    // Reko badge
    if (specialFunctions.some(f => f.function_type === 'reko')) {
      badges.push(
        <Badge key="reko" variant="secondary" className="text-xs font-normal px-1.5 py-0 gap-1">
          <Binoculars className="h-3 w-3" />
          Reko
        </Badge>
      )
    }

    // Magazin badge
    if (specialFunctions.some(f => f.function_type === 'magazin')) {
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
      currentFunctions={specialFunctions}
      onFunctionsChange={refreshSpecialFunctions}
    >
      <Card
        ref={ref}
        onClick={onClick}
        role={canDrag ? "button" : undefined}
        aria-grabbed={isDragging}
        aria-label={canDrag ? `Drag ${person.name} to assign to incident` : undefined}
        className={cn(
          "border border-border/50 bg-card/80 backdrop-blur-sm p-3 transition-all hover:bg-muted/50 hover:border-border",
          canDrag && "draggable",
          isDragging && "dragging",
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
    JSON.stringify(prevProps.person.tags) === JSON.stringify(nextProps.person.tags) &&
    prevProps.disabled === nextProps.disabled
  )
})
