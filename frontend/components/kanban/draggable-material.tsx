"use client"

import { useEffect, useRef, useState } from "react"
import { Card } from "@/components/ui/card"
import { draggable } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { type Material } from "@/lib/contexts/operations-context"
import { cn } from "@/lib/utils"

interface DraggableMaterialProps {
  material: Material
  onClick?: () => void
  disabled?: boolean
}

export function DraggableMaterial({ material, onClick, disabled }: DraggableMaterialProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)

  const canDrag = !disabled && material.status === "available"

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
        "border border-border/50 bg-card/80 backdrop-blur-sm p-3 transition-all hover:bg-muted/50 hover:border-border",
        canDrag && "draggable",
        isDragging && "dragging",
        !canDrag && material.status === "assigned" && "cursor-not-allowed opacity-60",
        !canDrag && material.status !== "assigned" && "cursor-pointer"
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {/* Status indicator - filled circle for available, empty circle for unavailable */}
          <div
            className={cn(
              "h-2 w-2 rounded-full flex-shrink-0",
              material.status === "available"
                ? "bg-emerald-500"
                : "border border-zinc-500 bg-transparent"
            )}
            aria-label={material.status === "available" ? "Available" : "Assigned"}
          />

          <span className="font-medium text-sm text-foreground truncate">{material.name}</span>
        </div>
      </div>
    </Card>
  )
}
