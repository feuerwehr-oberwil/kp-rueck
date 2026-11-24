"use client"

/**
 * The phone Lagekarte's Einsatz peek (owner pick 3A, 24.11.2026): a short sheet on the map's
 * foot for the Einsatz whose marker was tapped – priority, number and address, status, type and
 * age, the Einsatzleiter and the vehicles, the Abholung. «Alle Details» (or a tap on the peek)
 * opens the full phone detail sheet.
 *
 * Not a modal: the map above stays live, so the next marker tap swaps the Einsatz in place. The
 * page renders it as MapView's `floating.foot`; ✕, a second tap on the marker or a tap on empty
 * map closes it. Read-only like the phone board (owner, 14.11.2026): the Abholung is a label here,
 * the KP clears it at the desk.
 */

import { ChevronUp, X } from "lucide-react"
import { useTranslations } from "next-intl"
import { type Operation } from "@/lib/contexts/operations-context"
import { type Priority } from "@/lib/priority"
import { getIncidentRefParts, getIncidentTypeLabel } from "@/lib/incident-types"
import { getOperationStatusLabel } from "@/lib/status-labels"
import { vehicleLabel } from "@/lib/vehicle-label"
import { PriorityGlyph } from "@/components/ui/priority-glyph"
import { IncidentNumber } from "@/components/ui/incident-number"
import { IncidentTimeRow } from "@/components/ui/incident-time"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { CloseLabel } from "@/components/ui/dialog"
import { PickupBadge } from "@/components/kanban/pickup-badge"
import { LeaderGlyph } from "@/components/kanban/leader-badge"
import { PersonName } from "@/components/person-name"
import { AddressText } from "@/components/kanban/address-text"

interface MapIncidentPeekProps {
  operation: Operation
  formatLocation: (address: string) => string
  onClose: () => void
  /** The full phone detail sheet for this Einsatz. */
  onOpenDetail: () => void
}

export function MapIncidentPeek({ operation, formatLocation, onClose, onOpenDetail }: MapIncidentPeekProps) {
  const t = useTranslations("map.page")
  const priority = (operation.priority || "low") as Priority
  const address = formatLocation(operation.location)
  const vehicles = operation.vehicles.map(({ name, callsign }) => vehicleLabel({ name, callsign }))

  return (
    <section
      aria-label={getIncidentRefParts(operation).head}
      data-testid="map-incident-peek"
      // The sheet look (rounded top, hairline, the card surface) without the modal; `pb-3` – it
      // stands on the map's foot, which ends on the bottom nav.
      className="rounded-t-lg border-t border-border bg-card px-4 pb-3 pt-2 text-card-foreground shadow-[0_-6px_24px_rgb(0_0_0/0.12)]"
    >
      {/* The tap that opens the full sheet: the whole body, as the board's phone card. */}
      <div className="cursor-pointer" onClick={onOpenDetail} data-press>
        <div className="flex items-start gap-2">
          <span className="mt-0.5 shrink-0">
            <PriorityGlyph priority={priority} size="wall" />
          </span>
          <h2 className="min-w-0 flex-1 break-words text-lg font-bold leading-tight tracking-tight line-clamp-2">
            <IncidentNumber number={operation.number} className="mr-2 text-xs" />
            {address ? <AddressText text={address} /> : getIncidentTypeLabel(operation.incidentType)}
          </h2>
          {/* The phone sheet's ✕: an 18px glyph on a 36px muted plate in the 44px box. */}
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onClose()
            }}
            className="-mr-1 -mt-1 grid size-11 shrink-0 place-items-center"
          >
            <span className="grid size-9 place-items-center rounded-2xl bg-muted text-muted-foreground">
              <X className="size-[18px]" aria-hidden="true" />
            </span>
            <CloseLabel />
          </button>
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 pl-6">
          <Badge variant="secondary" className="max-w-full px-1.5 py-0 text-xs">
            {getOperationStatusLabel(operation.status)}
          </Badge>
          <span className="min-w-0 break-words text-xs text-muted-foreground">
            {getIncidentTypeLabel(operation.incidentType)}
          </span>
          <IncidentTimeRow operation={operation} readOnly colorByAge className="ml-auto gap-1.5" />
        </div>

        {(operation.leaderName || vehicles.length > 0) && (
          <p className="mt-1 flex flex-wrap items-center gap-x-1.5 pl-6 text-xs text-muted-foreground">
            {operation.leaderName && (
              <>
                <LeaderGlyph />
                <PersonName name={operation.leaderName} personnelId={operation.leaderId ?? undefined} />
              </>
            )}
            {operation.leaderName && vehicles.length > 0 && <span aria-hidden="true">·</span>}
            {vehicles.length > 0 && <span className="min-w-0 break-words">{vehicles.join(" · ")}</span>}
          </p>
        )}

        {operation.pickupNeeded && (
          <PickupBadge
            requestedAt={operation.pickupRequestedAt}
            note={operation.pickupNote}
            canEdit={false}
            className="ml-6 mt-2"
          />
        )}
      </div>

      <Button
        variant="outline"
        className="mt-3 h-11 w-full"
        onClick={(event) => {
          event.stopPropagation()
          // Safari does not focus a tapped button; the detail sheet gives the focus back to
          // whatever held it when it opened.
          event.currentTarget.focus({ preventScroll: true })
          onOpenDetail()
        }}
      >
        {t("allDetails")}
        <ChevronUp aria-hidden="true" />
      </Button>
    </section>
  )
}
