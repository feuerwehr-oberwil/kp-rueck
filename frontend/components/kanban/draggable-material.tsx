"use client"

import { useEffect, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { Card } from "@/components/ui/card"
import { draggable } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { type Material, useOperations } from "@/lib/contexts/operations-context"
import { cn } from "@/lib/utils"
import { RESOURCE_STATE_ICON_CLASSES, materialResourceState } from "@/lib/resource-status"
import { Check, Minus, Infinity as InfinityIcon, MapPin } from 'lucide-react'

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
    <Card
      ref={ref}
      onClick={onClick}
      role={canDrag ? "button" : undefined}
      title={material.name}
      aria-grabbed={isDragging}
      aria-label={canDrag ? `Drag ${material.name} to assign to incident` : undefined}
      className={cn(
        "group border border-border/50 bg-card/80 backdrop-blur-sm px-3 py-2 gap-0 transition-all hover:bg-muted/50 hover:border-border",
        canDrag && "draggable",
        isDragging && "dragging",
        // Same border and fill for every card, and a lighter card for one that
        // is spoken for — see the note in draggable-person.tsx for what was
        // tried, reverted, and why only the opacity came back. A consumable
        // never dims: stock handed out does not make the depot empty.
        isOccupied && "opacity-60 hover:opacity-100",
        !canDrag && !isConsumable && material.status === "assigned" && "cursor-not-allowed",
        !canDrag && !isConsumable && material.status !== "assigned" && "cursor-pointer"
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {/* Status indicator — same 16px box, same glyph set and same colours
              as the person card: check = verfügbar, minus = im Einsatz. */}
          <div
            className={cn(
              "flex items-center justify-center h-4 w-4 rounded flex-shrink-0",
              // Same colour language as the person card right above it in the
              // sidebar. Consumables resolve to "available" — stock handed out
              // does not make the depot empty (see materialResourceState).
              RESOURCE_STATE_ICON_CLASSES[materialResourceState(material)],
            )}
            aria-label={isConsumable ? t('material.consumable') : material.status === "available" ? t('common.available') : t('common.inUse')}
            title={isConsumable ? t('material.consumableUnlimited') : material.status === "available" ? t('common.available') : t('common.inUse')}
          >
            {isConsumable ? (
              <InfinityIcon className="h-3 w-3" />
            ) : material.status === "available" ? (
              <Check className="h-3 w-3" />
            ) : (
              <Minus className="h-3 w-3" />
            )}
          </div>

          {/* Wraps to its full length on hover — same reasoning as the person card. */}
          <span className="font-medium text-sm text-foreground truncate group-hover:overflow-visible group-hover:whitespace-normal group-hover:break-words">
            {material.name}
          </span>
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
      </div>
    </Card>
  )
}

/** "20:41" — the tooltip's «seit», or an em dash when the rapport carried none. */
function formatSince(value: string | null): string {
  if (!value) return '–'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '–'
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}
