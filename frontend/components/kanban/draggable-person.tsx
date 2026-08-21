"use client"

import { useEffect, useRef, useState, memo } from "react"
import { useTranslations } from "next-intl"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { draggable } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { type Person } from "@/lib/contexts/operations-context"
import { PersonContextMenu } from "./person-context-menu"
import { RESOURCE_STATE_ICON_CLASSES, isPersonOccupied } from "@/lib/resource-status"
import type { PersonEngagement } from "@/lib/hooks/use-person-engagements"
import { Car, Binoculars, Package2, Phone, MonitorCog, Check, Minus, AlertTriangle } from 'lucide-react'
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
          {t('common.reko')}
        </Badge>
      )
    }

    // Magazin badge
    if (person.isMagazin) {
      badges.push(
        <Badge key="magazin" variant="secondary" className="text-xs font-normal px-1.5 py-0 gap-1">
          <Package2 className="h-3 w-3" />
          {t('common.magazin')}
        </Badge>
      )
    }

    // Telefondienst badge — the phone desk is a role like the three above it
    // (plan 26, decision 6), so it wears a chip rather than becoming a "rank".
    if (person.isTelefondienst) {
      badges.push(
        <Badge key="telefondienst" variant="secondary" className="text-xs font-normal px-1.5 py-0 gap-1">
          <Phone className="h-3 w-3" />
          {t('common.telefondienst')}
        </Badge>
      )
    }

    // Kommandoposten — the one role that unlocks nothing. It exists to say the
    // person is working on THIS, so the board stops offering its own operators
    // as crew for a Schadenplatz.
    if (person.isKommandoposten) {
      badges.push(
        <Badge key="kommandoposten" variant="secondary" className="text-xs font-normal px-1.5 py-0 gap-1">
          <MonitorCog className="h-3 w-3" />
          {t('common.kommandoposten')}
        </Badge>
      )
    }

    return badges
  }

  const specialFunctionBadges = renderSpecialFunctionBadges()
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
      <Card
        ref={ref}
        onClick={onClick}
        role={canDrag ? "button" : undefined}
        title={person.name}
        aria-grabbed={isDragging}
        aria-label={canDrag ? `Drag ${person.name} to assign to incident` : undefined}
        className={cn(
          "group border border-border/50 bg-card/80 backdrop-blur-sm px-3 py-2 gap-0 transition-all hover:bg-muted/50 hover:border-border",
          canDrag && "draggable",
          isDragging && "dragging",
          isDragging && person.isDriver && "ring-2 ring-blue-500/50",
          // Every card keeps the same BORDER and the same FILL — that part of
          // the earlier note stands. What was tried and reverted was
          // `opacity-60` together with `bg-muted/30` and `border-border/30`, and
          // it was the border going soft that made one column read as "some
          // cards have a border and some don't".
          //
          // The opacity is back on its own. Scanning a roster of forty for
          // somebody free was a hunt for a 12px minus against a 12px check, in
          // colours a quarter of a second apart; who is available has to be
          // answerable at a glance down the column, and that is what a second
          // channel buys. Hover brings the card back to full strength, so
          // nothing dimmed is ever hard to read while it is being read.
          isOccupied && !isDoubleBooked && "opacity-60 hover:opacity-100",
          !canDrag && person.status === "assigned" && "cursor-not-allowed",
          !canDrag && person.status !== "assigned" && "cursor-pointer",
          // Double-booked is the one exception: a genuine conflict the operator
          // has to catch, so it still gets a ring.
          isDoubleBooked && "border-warning/70 ring-1 ring-warning/30",
        )}
      >
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              {/* Status indicator - icon only, muted colors */}
              <div
                className={cn(
                  "flex items-center justify-center h-4 w-4 rounded flex-shrink-0",
                  RESOURCE_STATE_ICON_CLASSES[isOccupied ? "assigned" : "available"],
                )}
                aria-label={isOccupied ? occupiedTooltip : t('common.available')}
                title={isOccupied ? occupiedTooltip : t('common.available')}
              >
                {isOccupied ? (
                  <Minus className="h-3 w-3" />
                ) : (
                  <Check className="h-3 w-3" />
                )}
              </div>

              {/* The sidebar is narrow enough that longer names truncate. On
                  hover the name wraps to its full length instead of relying on
                  the browser's title tooltip, which only appears after a second
                  and is easy to miss while scanning. */}
              <span className="font-medium text-sm text-foreground truncate group-hover:overflow-visible group-hover:whitespace-normal group-hover:break-words">
                {person.name}
              </span>
            </div>

            {/* Tags */}
            <div className="flex items-center gap-1 flex-shrink-0">
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
    prevProps.person.isTelefondienst === nextProps.person.isTelefondienst &&
    prevProps.person.isKommandoposten === nextProps.person.isKommandoposten &&
    JSON.stringify(prevProps.person.tags) === JSON.stringify(nextProps.person.tags) &&
    prevProps.disabled === nextProps.disabled &&
    prevProps.assignmentCount === nextProps.assignmentCount &&
    // The engagement label is derived state — compare by value, not identity,
    // because the parent's map is rebuilt on every operations change.
    prevProps.engagement?.full === nextProps.engagement?.full
  )
})
