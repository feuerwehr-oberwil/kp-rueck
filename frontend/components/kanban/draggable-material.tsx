"use client"

import { useEffect, useRef, useState } from "react"
import { Card } from "@/components/ui/card"
import { draggable } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { type Material } from "@/lib/contexts/operations-context"
import { cn } from "@/lib/utils"
import { Check, Minus, Infinity as InfinityIcon } from 'lucide-react'

interface DraggableMaterialProps {
  material: Material
  onClick?: () => void
  disabled?: boolean
}

export function DraggableMaterial({ material, onClick, disabled }: DraggableMaterialProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)

  const isConsumable = material.consumable
  const canDrag = !disabled && (isConsumable || material.status === "available")

  useEffect(() => {
    const element = ref.current
    if (!element || !canDrag) return

    return draggable({
      element,
      getInitialData: () => ({ type: "material", material }),
      onDragStart: () => setIsDragging(true),
      onDrop: () => setIsDragging(false),
    })
  }, [material, canDrag])

  return (
    <Card
      ref={ref}
      onClick={onClick}
      role={canDrag ? "button" : undefined}
      aria-grabbed={isDragging}
      aria-label={canDrag ? `Drag ${material.name} to assign to incident` : undefined}
      className={cn(
        "border border-border/50 bg-card/80 backdrop-blur-sm px-3 py-2 gap-0 transition-all hover:bg-muted/50 hover:border-border",
        canDrag && "draggable",
        isDragging && "dragging",
        isConsumable && "opacity-70",
        !canDrag && !isConsumable && material.status === "assigned" && "cursor-not-allowed opacity-60",
        !canDrag && !isConsumable && material.status !== "assigned" && "cursor-pointer"
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {/* Status indicator - icon only, muted colors */}
          <div
            className="flex items-center justify-center h-4 w-4 rounded flex-shrink-0 text-muted-foreground"
            aria-label={isConsumable ? "Verbrauchsmaterial" : material.status === "available" ? "Verfügbar" : "Im Einsatz"}
            title={isConsumable ? "Verbrauchsmaterial (unbegrenzt)" : material.status === "available" ? "Verfügbar" : "Im Einsatz"}
          >
            {isConsumable ? (
              <InfinityIcon className="h-3.5 w-3.5" />
            ) : material.status === "available" ? (
              <Check className="h-3 w-3" />
            ) : (
              <Minus className="h-3 w-3" />
            )}
          </div>

          <span className="font-medium text-sm text-foreground truncate">{material.name}</span>
        </div>
      </div>
    </Card>
  )
}
