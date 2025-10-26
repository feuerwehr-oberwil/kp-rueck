"use client"

import { useEffect, useRef, useState } from "react"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { draggable } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { type Person } from "@/lib/contexts/operations-context"

interface DraggablePersonProps {
  person: Person
  onClick?: () => void
  disabled?: boolean
}

export function DraggablePerson({ person, onClick, disabled }: DraggablePersonProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)

  const canDrag = !disabled && person.status === "available"

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

  return (
    <Card
      ref={ref}
      onClick={onClick}
      style={{ opacity: isDragging ? 0.5 : 1 }}
      className={`border border-border/50 bg-card/80 backdrop-blur-sm p-3 transition-all hover:border-primary/50 hover:shadow-md hover:bg-card ${canDrag ? "cursor-move" : "cursor-pointer"} ${person.status === "assigned" ? "opacity-60" : ""}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className={`h-2 w-2 rounded-full flex-shrink-0 ${
              person.status === "available" ? "bg-emerald-500" : "bg-zinc-500"
            }`}
          />
          <span className="font-medium text-sm text-foreground truncate">{person.name}</span>
        </div>
        <Badge variant="outline" className="text-xs flex-shrink-0 font-normal">
          {person.role}
        </Badge>
      </div>
    </Card>
  )
}
