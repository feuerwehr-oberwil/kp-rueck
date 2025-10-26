"use client"

import { useEffect, useRef, useState } from "react"
import { Card } from "@/components/ui/card"
import { draggable } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { type Material } from "@/lib/contexts/operations-context"

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
      style={{ opacity: isDragging ? 0.5 : 1 }}
      className={`border border-border/50 bg-card/80 backdrop-blur-sm p-3 transition-all hover:border-primary/50 hover:shadow-md hover:bg-card ${canDrag ? "cursor-move" : "cursor-pointer"} ${material.status === "assigned" ? "opacity-60" : ""}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className={`h-2 w-2 rounded-full flex-shrink-0 ${
              material.status === "available" ? "bg-emerald-500" : "bg-zinc-500"
            }`}
          />
          <span className="font-medium text-sm text-foreground truncate">{material.name}</span>
        </div>
      </div>
    </Card>
  )
}
