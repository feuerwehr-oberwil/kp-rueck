"use client"

import { useEffect, useRef, useState, memo } from "react"
import { useTranslations } from "next-intl"
import { Badge } from "@/components/ui/badge"
import { draggable } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { type Person } from "@/lib/contexts/operations-context"
import { PersonContextMenu } from "./person-context-menu"
import { isPersonOccupied } from "@/lib/resource-status"
import { abbreviateRank } from "@/lib/roster-order"
import type { PersonEngagement } from "@/lib/hooks/use-person-engagements"
import { AlertTriangle } from 'lucide-react'
import { cn } from "@/lib/utils"

interface DraggablePersonProps {
  person: Person
  onClick?: () => void
  disabled?: boolean
  /** When > 1, this person is currently on multiple incidents — surface a conflict badge. */
  assignmentCount?: number
  /** Where this person actually is (incident label / Auftrag name), resolved by
   *  the parent via `usePersonEngagements` — a prop, not a hook, so this
   *  memoized card does not subscribe to the whole operations context (§P3.5). */
  engagement?: PersonEngagement
}

function DraggablePersonBase({ person, onClick, disabled, assignmentCount, engagement }: DraggablePersonProps) {
  const t = useTranslations('kanban')
  const ref = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)

  // Everybody on the roster can be dragged, busy or not. An assigned person used
  // to be undraggable, which made the sidebar answer "no" to a question the
  // operator is entitled to ask — the board is the surface that can move somebody
  // — and the only way to reassign them was to release them somewhere else first.
  // Dropping a busy person now opens the Doppelbelegung prompt (move / doppelt
  // belegen / abbrechen) instead of being refused by a cursor.
  const canDrag = !disabled

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

  const isDoubleBooked = (assignmentCount ?? 0) > 1
  // "Occupied" = on an incident OR tied up in a special function. Drivers/reko
  // stay draggable, so without this they read as free. Shared with the sidebar's
  // "nur verfügbare" filter so the filter and this icon can never disagree.
  const isOccupied = isPersonOccupied(person)

  // WHY occupied, for the hover tooltip (§P3.5) — same rule as the assignment
  // dialog's labels: a real engagement names the incident (short address) or
  // the Auftrag; a mere function holder gets the function's name; the generic
  // «Im Einsatz» is the last resort for an engagement nothing can resolve —
  // never the answer for somebody who only carries a role.
  const functionLabel = [
    person.isDriver && person.driverVehicleName
      ? t('person.driverFunction', { vehicle: person.driverVehicleName })
      : null,
    person.isReko ? t('common.reko') : null,
    person.isMagazin ? t('common.magazin') : null,
    person.isTelefondienst ? t('common.telefondienst') : null,
    person.isKommandoposten ? t('common.kommandoposten') : null,
  ]
    .filter(Boolean)
    .join(' · ')
  const occupiedTooltip = engagement
    ? t('person.engagedTooltip', { label: engagement.full })
    : functionLabel || t('common.inUse')

  return (
    <PersonContextMenu
      personnelId={person.id}
      personnelName={person.name}
    >
      {/* A quiet row, not a card: no border, no fill at rest — the sidebar is
          a list of forty names, and forty boxes were chrome without meaning.
          Hover carries the affordance; the drag/context behaviour is unchanged. */}
      <div
        ref={ref}
        onClick={onClick}
        role={canDrag ? "button" : undefined}
        title={person.name}
        aria-grabbed={isDragging}
        aria-label={canDrag ? `Drag ${person.name} to assign to incident` : undefined}
        className={cn(
          "group rounded-md px-2 py-1.5 transition-all hover:bg-muted/50",
          canDrag && "draggable",
          isDragging && "dragging",
          isDragging && person.isDriver && "ring-2 ring-blue-500/50",
          // The dimming stayed through the row restyle: who is available has to
          // be answerable at a glance down the column, and the amber dot alone
          // is a smaller signal than a whole row changing weight. Hover brings
          // the row back to full strength, so nothing dimmed is ever hard to
          // read while it is being read.
          isOccupied && !isDoubleBooked && "opacity-60 hover:opacity-100",
          !canDrag && person.status === "assigned" && "cursor-not-allowed",
          !canDrag && person.status !== "assigned" && "cursor-pointer",
          // Double-booked is the one exception: a genuine conflict the operator
          // has to catch, so it still gets a ring.
          isDoubleBooked && "ring-1 ring-warning/50",
        )}
      >
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 flex-1 items-baseline gap-1.5">
              {/* The sidebar is narrow enough that longer names truncate. On
                  hover the name wraps to its full length instead of relying on
                  the browser's title tooltip, which only appears after a second
                  and is easy to miss while scanning. */}
              <span className="font-medium text-sm text-foreground truncate group-hover:overflow-visible group-hover:whitespace-normal group-hover:break-words">
                {person.name}
              </span>
            </div>

            {/* Rank, then tags and the conflict badge at the outer edge — the
                marks worth catching sit against the rail, the Grad («Wm»,
                «Kpl», full word on hover) is a quieter fact just inside them.
                The amber dot only fills when bound — available shows nothing,
                but the slot stays, so the columns line up across groups. */}
            <div className="flex items-center gap-1.5 flex-shrink-0">
              {person.role && (
                <span className="shrink-0 text-right text-xs text-muted-foreground" title={person.role}>
                  {abbreviateRank(person.role)}
                </span>
              )}
              {person.tags && person.tags.length > 0 ? (
                <div className="flex gap-1">
                  {person.tags.map((tag) => (
                    <Badge key={tag} variant="outline" className="text-xs font-normal px-1.5 py-0">
                      {tag}
                    </Badge>
                  ))}
                </div>
              ) : null}
              {isDoubleBooked && (
                <Badge
                  variant="outline"
                  className="text-xs font-medium px-1.5 py-0 gap-1 border-warning/60 text-warning-foreground"
                  title={t('person.doubleBookedTooltip', { count: assignmentCount ?? 0 })}
                >
                  <AlertTriangle className="h-3 w-3" />
                  {assignmentCount}×
                </Badge>
              )}
              <span
                aria-label={isOccupied ? occupiedTooltip : undefined}
                title={isOccupied ? occupiedTooltip : undefined}
                className={cn("size-1.5 shrink-0 rounded-full", isOccupied ? "bg-amber-500" : "invisible")}
              />
            </div>
          </div>

          {/* Where the person is, as a second quiet line — the binding used to
              live only in a hover tooltip. Incident address or Auftrag first,
              function (Fahrer TLF, Reko, Telefondienst …) as the fallback. */}
          {isOccupied && (engagement?.short || functionLabel) && (
            <div className="truncate text-[11px] leading-tight text-muted-foreground" title={occupiedTooltip}>
              {engagement?.short ?? functionLabel}
            </div>
          )}
        </div>
      </div>
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
    prevProps.person.isTelefondienst === nextProps.person.isTelefondienst &&
    prevProps.person.isKommandoposten === nextProps.person.isKommandoposten &&
    JSON.stringify(prevProps.person.tags) === JSON.stringify(nextProps.person.tags) &&
    prevProps.disabled === nextProps.disabled &&
    prevProps.assignmentCount === nextProps.assignmentCount &&
    // The engagement label is derived state — compare by value, not identity,
    // because the parent's map is rebuilt on every operations change. Both
    // forms: the row draws `short`, the tooltip `full`.
    prevProps.engagement?.full === nextProps.engagement?.full &&
    prevProps.engagement?.short === nextProps.engagement?.short
  )
})
