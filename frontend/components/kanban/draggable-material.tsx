"use client"

import { useEffect, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { draggable } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { type Material, useOperations } from "@/lib/contexts/operations-context"
import { cn } from "@/lib/utils"
import { materialResourceState } from "@/lib/resource-status"
import { Infinity as InfinityIcon, MapPin } from 'lucide-react'

interface DraggableMaterialProps {
  material: Material
  onClick?: () => void
  disabled?: boolean
}

export function DraggableMaterial({ material, onClick, disabled }: DraggableMaterialProps) {
  const t = useTranslations('kanban')
  const ref = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  // "zugewiesen" and "steht noch in einem fremden Keller" are different facts,
  // and only the second one sends somebody driving in the morning. The rapport
  // has recorded it for a while; until now nothing on the board said it.
  const { materialOnSite } = useOperations()
  const onSite = materialOnSite.get(material.id)

  const isConsumable = material.consumable
  // Two different ways of being spoken for, one treatment: assigned to a
  // Schadenplatz, or standing at an address waiting to be fetched.
  const isOccupied = !isConsumable && (materialResourceState(material) === "assigned" || !!onSite)
  // Busy material drags too — the drop asks (move / doppelt belegen / abbrechen)
  // rather than the sidebar silently refusing. Same reasoning as the crew list.
  const canDrag = !disabled

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
    // A quiet row, not a card — same restyle and same reasoning as the person
    // row across the board (see draggable-person.tsx).
    <div
      ref={ref}
      onClick={onClick}
      role={canDrag ? "button" : undefined}
      title={material.name}
      aria-grabbed={isDragging}
      aria-label={canDrag ? `Drag ${material.name} to assign to incident` : undefined}
      className={cn(
        "group rounded-md px-2 py-1.5 transition-all hover:bg-muted/50",
        canDrag && "draggable",
        isDragging && "dragging",
        // A lighter row for a device that is spoken for — see the note in
        // draggable-person.tsx for what was tried, reverted, and why only the
        // opacity came back. A consumable never dims: stock handed out does
        // not make the depot empty.
        isOccupied && "opacity-60 hover:opacity-100",
        !canDrag && !isConsumable && material.status === "assigned" && "cursor-not-allowed",
        !canDrag && !isConsumable && material.status !== "assigned" && "cursor-pointer"
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-baseline gap-1.5">
          {/* Wraps to its full length on hover — same reasoning as the person row. */}
          <span className="font-medium text-sm text-foreground truncate group-hover:overflow-visible group-hover:whitespace-normal group-hover:break-words">
            {material.name}
          </span>
          {/* Stock says so quietly; available draws nothing at all. */}
          {isConsumable && (
            <span
              className="shrink-0 self-center"
              title={t('material.consumableUnlimited')}
              aria-label={t('material.consumable')}
            >
              <InfinityIcon className="size-3 text-muted-foreground" aria-hidden />
            </span>
          )}
        </div>

        {onSite && (
          <span
            className="flex shrink-0 items-center gap-1 rounded-full bg-warning/15 px-1.5 py-0.5 text-[10px] font-medium text-warning-foreground"
            title={t('material.onSiteTitle', {
              address: onSite.address ?? '–',
              since: formatSince(onSite.since),
            })}
          >
            <MapPin className="h-2.5 w-2.5" />
            {t('material.onSite')}
          </span>
        )}
        {/* Taken draws the amber dot — the one state mark, same as everywhere. */}
        {isOccupied && (
          <span
            aria-label={t('common.inUse')}
            title={t('common.inUse')}
            className="size-1.5 shrink-0 rounded-full bg-amber-500"
          />
        )}
      </div>
    </div>
  )
}

/** "20:41" — the tooltip's «seit», or an em dash when the rapport carried none. */
function formatSince(value: string | null): string {
  if (!value) return '–'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '–'
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}
