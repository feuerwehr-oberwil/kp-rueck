"use client"

import { useEffect, useRef, useState } from "react"
import { Card } from "@/components/ui/card"
import { draggable } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { DraggableMaterial } from "@/components/kanban/draggable-material"
import { type Material } from "@/lib/contexts/operations-context"
import { type MaterialGroup } from "@/lib/contexts/materials-context"
import { cn } from "@/lib/utils"
import { ChevronDown, ChevronRight, Layers } from "lucide-react"

interface MaterialGroupBlockProps {
  group: MaterialGroup
  materials: Material[]
  allAvailable: boolean
  someAssigned: boolean
  allAssigned: boolean
  onMaterialClick: (material: Material) => void
}

export function MaterialGroupBlock({
  group,
  materials,
  allAvailable,
  someAssigned,
  allAssigned,
  onMaterialClick,
}: MaterialGroupBlockProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [isDragging, setIsDragging] = useState(false)

  const availableCount = materials.filter(m => m.status === 'available').length
  const totalCount = materials.length
  const hasAvailable = availableCount > 0

  useEffect(() => {
    const element = ref.current
    if (!element || !hasAvailable) return

    return draggable({
      element,
      getInitialData: () => ({
        type: "material-group",
        materials: materials.filter(m => m.status === 'available'),
        group,
      }),
      onDragStart: () => setIsDragging(true),
      onDrop: () => setIsDragging(false),
    })
  }, [materials, group, hasAvailable])

  return (
    <Card
      ref={ref}
      className={cn(
        "border border-border/50 bg-card/80 backdrop-blur-sm transition-all overflow-hidden p-0 gap-0",
        allAssigned && "opacity-60",
        hasAvailable && !expanded && "cursor-grab",
        isDragging && "opacity-50",
      )}
    >
      {/* Group header — clickable to expand */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/50 transition-colors"
      >
        <Layers className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
        <span className="font-medium text-sm text-foreground flex-1 truncate">{group.name}</span>

        {/* Status indicator */}
        <span className={cn(
          "text-xs font-medium tabular-nums px-1.5 py-0.5 rounded",
          allAvailable && "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10",
          someAssigned && !allAssigned && "text-yellow-600 dark:text-yellow-400 bg-yellow-500/10",
          allAssigned && "text-muted-foreground bg-muted"
        )}>
          {availableCount}/{totalCount}
        </span>

        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
        )}
      </button>

      {/* Expanded children */}
      {expanded && (
        <div className="px-1.5 pb-1.5 pt-1 space-y-1 border-t border-border/50">
          {materials.map((material) => (
            <DraggableMaterial
              key={material.id}
              material={material}
              onClick={() => onMaterialClick(material)}
            />
          ))}
        </div>
      )}
    </Card>
  )
}
