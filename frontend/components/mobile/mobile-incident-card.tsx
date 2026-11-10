"use client"

/**
 * One entry of the phone's Einsatz list — the "list overview".
 *
 * Rich on purpose (sweep 27 §P5b.8, image #21): the phone is a *viewing*
 * surface, an event rarely has many Einsätze, and every fact that used to hide
 * behind a tap — who leads, what was reported, who and what is out there,
 * whether the driver comes back, what the Reko saw — is exactly what somebody
 * glancing at their phone wants without the tap. The detail sheet stays the
 * place for editing; this card answers the questions.
 */

import { memo } from "react"
import { useTranslations } from "next-intl"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ChevronUp, ChevronDown, Minus, FileCheck, AlertTriangle } from "lucide-react"
import { type Operation } from "@/lib/contexts/operations-context"
import { IncidentNumber } from "@/components/ui/incident-number"
import { IncidentTimeRow } from "@/components/ui/incident-time"
import { PickupBadge } from "@/components/kanban/pickup-badge"
import { LeaderGlyph } from "@/components/kanban/leader-badge"
import { DuplicateFlag } from "@/components/duplicates/duplicate-flag"
import { DriverStayGlyph } from "@/components/ui/driver-stay-glyph"
import { rapportApplies } from "@/lib/rapport-visibility"
import { getIncidentTypeLabel } from "@/lib/incident-types"
import { AddressText } from "@/components/kanban/address-text"
import { cn } from "@/lib/utils"
import { getOperationStatusLabel } from "@/lib/status-labels"
import { type Priority, PRIORITY_CARD_CLASSES, PRIORITY_ICON_CLASSES } from "@/lib/priority"
import { sameCrew, sameVehicles } from "@/lib/operation-equality"

interface MobileIncidentCardProps {
  operation: Operation
  onClick: () => void
  formatLocation: (address: string) => string
  /** Live vehicle id → driver name map — the LIST fetches it once
   *  (`useVehicleDrivers`) rather than every card asking the API itself. */
  vehicleDrivers?: Map<string, string>
}

/** `label | value` line of the card's fact block — same reading the incident
 *  detail uses, shrunk to the phone. Renders nothing without a value. Two cells of
 *  the block's grid: the label column is as wide as the longest label in the
 *  current language («Reconnaissance» does not fit a fixed 4.5rem). */
function FactRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <span className="text-muted-foreground">{label}</span>
      <div className="min-w-0">{children}</div>
    </>
  )
}

function MobileIncidentCardBase({ operation, onClick, formatLocation, vehicleDrivers }: MobileIncidentCardProps) {
  const t = useTranslations("incidents.card")
  const tCard = useTranslations("kanban.card")
  const tMobile = useTranslations("incidents.mobileCard")
  const tDetail = useTranslations("incidents.mobileDetail")
  const tLeader = useTranslations("kanban.leader")
  const priority = (operation.priority || "low") as Priority
  const chevronClass = PRIORITY_ICON_CLASSES[priority]

  // The Schadenplatz-Rapport is due but nobody has filed it (drafts count as
  // missing — the chip is a reminder, and a draft is not an answer).
  const rapportMissing =
    !operation.hasSchadenplatzRapport &&
    rapportApplies({
      hasBeenDispatched: operation.hasBeenDispatched,
      status: operation.status,
      hasReport: operation.hasSchadenplatzRapport,
    })

  const rekoText = operation.rekoSummary?.summaryText?.trim()

  return (
    <Card
      className={cn(
        // `gap-0`: the Card's own `gap-6` would open 24px between the header and
        // every body row; the rows carry their own 4–8px steps.
        "gap-0 p-3 transition-all active:scale-[0.98] cursor-pointer touch-manipulation",
        // The board card's own priority reading (lib/priority.ts): a 4px left
        // edge — red + wash + ring + pulse for Hoch, amber for Mittel, plain
        // border for Niedrig. No status tint: the status is the badge's job.
        "bg-card border border-border border-l-4",
        PRIORITY_CARD_CLASSES[priority],
      )}
      onClick={onClick}
    >
      {/* The chevron and the age sit beside the HEADER only (address, EL,
          Abholung, Duplikat, status + type); from the rule down, the fact block
          runs the card's full width, as the desk card's body does.
          Indenting the whole card under the chevron cost the fact values 24px
          per line on a phone — enough to push «TLF · Fahrer: Müller Hans» and
          its stay chip onto two lines. */}
      <div className="flex items-start gap-2">
        {/* Priority indicator */}
        <div className="flex items-center flex-shrink-0 mt-0.5">
          {priority === "high" ? (
            <ChevronUp className={cn("h-4 w-4", chevronClass)} aria-label={tCard("priorityHighAria")} />
          ) : priority === "medium" ? (
            <Minus className={cn("h-4 w-4", chevronClass)} aria-label={tCard("priorityMediumAria")} />
          ) : (
            <ChevronDown className={cn("h-4 w-4", chevronClass)} aria-label={tCard("priorityLowAria")} />
          )}
        </div>

        {/* Header */}
        <div className="flex-1 min-w-0">
          {formatLocation(operation.location) && (
            // Two lines, never cut: the address is what the card is for. On a 360px phone
            // «Allschwilerstrasse 20» ended in an ellipsis (overflow sweep, 03.10.).
            <h3 className="min-w-0 font-semibold text-base line-clamp-2 break-words leading-tight">
              {/* The number the desk card, the detail and the map list put before
                  the address — what the radio says. 12/500 mono, 8px to the address. */}
              <IncidentNumber number={operation.number} className="mr-2 text-xs" />
              <AddressText text={formatLocation(operation.location)} />
            </h3>
          )}

          {/* Einsatzleiter — who to raise on the radio. The desk's «EL» mark,
              never a star (leader-badge.tsx says why). */}
          {operation.leaderName && (
            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
              <LeaderGlyph />
              <span className="sr-only">{tLeader("is")}:</span>
              <span className="min-w-0 break-words">{operation.leaderName}</span>
            </p>
          )}

          {/* Abholung (decision 24). Same chip as the board and the wall, and
              like there it is NOT gated on status: completing a card releases
              the crew while they are still standing at the address.
              `compact` because this is the scan list — the waiting time is one
              tap away in the detail sheet. Read-only: clearing a pickup erases
              the only record of how long they stood there, and the phone is a
              viewing surface, so the KP clears it from the board. */}
          {operation.pickupNeeded && (
            <PickupBadge
              variant="compact"
              requestedAt={operation.pickupRequestedAt}
              note={operation.pickupNote}
              canEdit={false}
              className="mt-1.5"
            />
          )}

          {/* «Mögliches Duplikat» (R2): read-only here, like the pickup chip —
              the phone is a viewing surface; the KP merges on the board. */}
          {operation.possibleDuplicateOf && (
            <DuplicateFlag
              operationId={operation.id}
              targetId={operation.possibleDuplicateOf}
              canEdit={false}
              className="mt-1.5"
            />
          )}

          {/* Status + Type: the status is the one chip; the type is a label,
              so it is plain muted text and never outshines the status. ONE line on
              every card (hill climb r23: a wrapping row put the type beside a short
              status but under «Disponiert / Anfahrt»): the chip and the marks keep
              their size, the type ellipsizes with its full text in `title`. */}
          <div className="flex items-center gap-2 mt-1.5">
            <Badge variant="secondary" className="text-xs px-1.5 py-0 max-w-full">
              {getOperationStatusLabel(operation.status)}
            </Badge>
            <span
              className="min-w-0 truncate text-xs text-muted-foreground"
              title={getIncidentTypeLabel(operation.incidentType)}
            >
              {getIncidentTypeLabel(operation.incidentType)}
            </span>
            {operation.hasCompletedReko && (
              <span className="shrink-0" title={t("rekoCompleted")}>
                <FileCheck className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
              </span>
            )}
            {operation.rekoSummary?.hasDangers && (
              <span className="shrink-0" title={tDetail("dangers")}>
                <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
              </span>
            )}
          </div>
        </div>

        {/* The age on the address row's right, as a list reads (hill climb r20: on a
            line of its own under the facts it cost a line per card). Read-only: the
            phone list is for looking, and a dropdown inside a tappable row fights the
            tap that opens the incident. 14/18 600 in the desk card's age colours
            (`colorByAge` = `ageLevel`: amber ≥ 60′, red ≥ 120′). */}
        <div className="flex shrink-0 flex-col items-end gap-0.5 pt-px text-right">
          <IncidentTimeRow
            operation={operation}
            readOnly
            colorByAge
            className="gap-1.5"
            startClassName="text-sm leading-[18px] font-semibold"
            chipClassName="text-sm leading-[18px] font-semibold"
            startIconClassName="h-3.5 w-3.5"
            iconClassName="h-3.5 w-3.5"
          />
          {/* The one debt that survives completion (image #21): a quiet line
              directly under the time, not a pill in the title row. */}
          {rapportMissing && (
            <p className="text-xs text-muted-foreground">{tMobile("noRapport")}</p>
          )}
        </div>
      </div>

      {/* The fact block (image #21): Meldung, Mannschaft, Fahrzeuge (with
          driver and the stays/returns word), Reko. Rows without a value
          disappear, so a fresh card stays two lines tall. */}
      {(operation.notes.trim() || operation.crew.length > 0 || operation.vehicles.length > 0 || rekoText) && (
        <div className="mt-2 grid grid-cols-[minmax(4.5rem,auto)_minmax(0,1fr)] gap-x-2 gap-y-1 border-t border-border/50 pt-2 text-xs leading-snug">
          {operation.notes.trim() && (
            <FactRow label={tMobile("meldung")}>
              <p className="line-clamp-2 whitespace-pre-wrap">{operation.notes.trim()}</p>
            </FactRow>
          )}
          {operation.crew.length > 0 && (
            <FactRow label={tMobile("crew")}>
              <p className="line-clamp-2">{operation.crew.map((m) => m.name).join(", ")}</p>
            </FactRow>
          )}
          {operation.vehicles.length > 0 && (
            <FactRow label={tMobile("vehicles")}>
              <div className="space-y-0.5">
                {operation.vehicles.map(({ vehicleId, name: vehicleName, driverStay }) => {
                  const driver = vehicleDrivers?.get(vehicleId)
                  return (
                    <div key={vehicleId} className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                      <span className="font-medium">{vehicleName}</span>
                      {driver && (
                        <span className="text-muted-foreground">
                          · {tMobile("driver", { name: driver })}
                        </span>
                      )}
                      <DriverStayGlyph stays={driverStay} />
                    </div>
                  )
                })}
              </div>
            </FactRow>
          )}
          {rekoText && (
            <FactRow label={tMobile("reko")}>
              <p className="line-clamp-2 whitespace-pre-wrap">{rekoText}</p>
            </FactRow>
          )}
        </div>
      )}

    </Card>
  )
}

export const MobileIncidentCard = memo(MobileIncidentCardBase, (prevProps, nextProps) => {
  const prev = prevProps.operation
  const next = nextProps.operation
  return (
    // The hook hands out a NEW Map only when a driver actually changed, so
    // reference equality is the honest comparison here.
    prevProps.vehicleDrivers === nextProps.vehicleDrivers &&
    prev.id === next.id &&
    prev.number === next.number &&
    prev.status === next.status &&
    prev.priority === next.priority &&
    prev.location === next.location &&
    // The fact block renders these, so they all gate the memo — a comparator
    // that ignores a field leaves stale text on screen after a poll.
    prev.notes === next.notes &&
    prev.leaderName === next.leaderName &&
    sameCrew(prev.crew, next.crew) &&
    sameVehicles(prev.vehicles, next.vehicles) &&
    prev.hasCompletedReko === next.hasCompletedReko &&
    prev.rekoSummary?.hasDangers === next.rekoSummary?.hasDangers &&
    prev.rekoSummary?.summaryText === next.rekoSummary?.summaryText &&
    prev.hasSchadenplatzRapport === next.hasSchadenplatzRapport &&
    prev.hasBeenDispatched === next.hasBeenDispatched &&
    // The pickup chip is rendered above, so it has to be compared here too —
    // a memo that ignores it leaves an amber chip on screen after the KP
    // cleared it (or never shows one that just arrived).
    prev.pickupNeeded === next.pickupNeeded &&
    prev.pickupNote === next.pickupNote &&
    prev.pickupRequestedAt?.getTime() === next.pickupRequestedAt?.getTime() &&
    prev.possibleDuplicateOf === next.possibleDuplicateOf
  )
})
