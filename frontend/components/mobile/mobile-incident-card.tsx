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
import { ChevronUp, ChevronDown, Minus, FileCheck, AlertTriangle, Star, FileWarning } from "lucide-react"
import { type Operation } from "@/lib/contexts/operations-context"
import { columns } from "@/lib/kanban-utils"
import { IncidentTimeRow } from "@/components/ui/incident-time"
import { PickupBadge } from "@/components/kanban/pickup-badge"
import { DriverStayGlyph } from "@/components/ui/driver-stay-glyph"
import { rapportApplies } from "@/lib/rapport-visibility"
import { getIncidentTypeLabel } from "@/lib/incident-types"
import { cn } from "@/lib/utils"
import { getOperationStatusLabel } from "@/lib/status-labels"
import { type Priority, PRIORITY_DOT_CLASSES, PRIORITY_TEXT_CLASSES } from "@/lib/priority"

interface MobileIncidentCardProps {
  operation: Operation
  onClick: () => void
  formatLocation: (address: string) => string
  /** Live vehicle name → driver name map — the LIST fetches it once
   *  (`useVehicleDrivers`) rather than every card asking the API itself. */
  vehicleDrivers?: Map<string, string>
}

/** `label | value` line of the card's fact block — same reading the incident
 *  detail uses, shrunk to the phone. Renders nothing without a value. */
function FactRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2 text-xs leading-snug">
      <span className="w-[4.5rem] shrink-0 text-muted-foreground">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

function MobileIncidentCardBase({ operation, onClick, formatLocation, vehicleDrivers }: MobileIncidentCardProps) {
  const t = useTranslations("incidents.card")
  const tCard = useTranslations("kanban.card")
  const tMobile = useTranslations("incidents.mobileCard")
  const tDetail = useTranslations("incidents.mobileDetail")
  const priority = (operation.priority || "low") as Priority
  const priorityConfig = { dot: PRIORITY_DOT_CLASSES[priority], chevron: PRIORITY_TEXT_CLASSES[priority] }

  // Get column color for the card
  const column = columns.find(col => col.status.includes(operation.status))
  const columnColor = column?.color || "bg-muted"

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
        "p-3 transition-all active:scale-[0.98] cursor-pointer touch-manipulation",
        columnColor,
        priority === "high" ? "border-red-500/40 border-2 bg-red-500/[0.04] dark:bg-red-500/[0.06]" : "border-border"
      )}
      onClick={onClick}
    >
      <div className="flex items-start gap-3">
        {/* Priority indicator */}
        <div className="flex items-center gap-0.5 flex-shrink-0 mt-0.5">
          <div
            className={cn("w-2.5 h-2.5 rounded-full flex-shrink-0", priorityConfig?.dot)}
            aria-hidden="true"
          />
          {priority === "high" ? (
            <ChevronUp className={cn("h-4 w-4", priorityConfig?.chevron)} aria-label={tCard("priorityHighAria")} />
          ) : priority === "medium" ? (
            <Minus className={cn("h-4 w-4", priorityConfig?.chevron)} aria-label={tCard("priorityMediumAria")} />
          ) : (
            <ChevronDown className={cn("h-4 w-4", priorityConfig?.chevron)} aria-label={tCard("priorityLowAria")} />
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Location + the one debt that survives completion (image #21) */}
          <div className="flex items-start justify-between gap-2">
            {formatLocation(operation.location) && (
              <h3 className="font-semibold text-base truncate leading-tight">
                {formatLocation(operation.location)}
              </h3>
            )}
            {rapportMissing && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-2xs font-medium text-amber-700 dark:text-amber-300">
                <FileWarning className="h-3 w-3" />
                {tMobile("noRapport")}
              </span>
            )}
          </div>

          {/* Einsatzleiter — who to raise on the radio. */}
          {operation.leaderName && (
            <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
              <Star className="h-3 w-3 shrink-0 text-amber-500" aria-hidden />
              {tMobile("leader", { name: operation.leaderName })}
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

          {/* Type + Status */}
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <Badge variant="outline" className="text-xs px-1.5 py-0">
              {getIncidentTypeLabel(operation.incidentType)}
            </Badge>
            <Badge variant="secondary" className="text-xs px-1.5 py-0 max-w-full">
              {getOperationStatusLabel(operation.status)}
            </Badge>
            {operation.hasCompletedReko && (
              <span title={t("rekoCompleted")}>
                <FileCheck className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
              </span>
            )}
            {operation.rekoSummary?.hasDangers && (
              <span title={tDetail("dangers")}>
                <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
              </span>
            )}
          </div>

          {/* The fact block (image #21): Meldung, Mannschaft, Fahrzeuge (with
              driver and the stays/returns word), Reko. Rows without a value
              disappear, so a fresh card stays two lines tall. */}
          {(operation.notes.trim() || operation.crew.length > 0 || operation.vehicles.length > 0 || rekoText) && (
            <div className="mt-2 space-y-1 border-t border-border/50 pt-2">
              {operation.notes.trim() && (
                <FactRow label={tMobile("meldung")}>
                  <p className="line-clamp-2 whitespace-pre-wrap">{operation.notes.trim()}</p>
                </FactRow>
              )}
              {operation.crew.length > 0 && (
                <FactRow label={tMobile("crew")}>
                  <p className="line-clamp-2">{operation.crew.join(", ")}</p>
                </FactRow>
              )}
              {operation.vehicles.length > 0 && (
                <FactRow label={tMobile("vehicles")}>
                  <div className="space-y-0.5">
                    {operation.vehicles.map(vehicleName => {
                      const driver = vehicleDrivers?.get(vehicleName)
                      return (
                        <div key={vehicleName} className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                          <span className="font-medium">{vehicleName}</span>
                          {driver && (
                            <span className="text-muted-foreground">
                              · {tMobile("driver", { name: driver })}
                            </span>
                          )}
                          <DriverStayGlyph stays={operation.vehicleDriverStay.get(vehicleName)} />
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

          {/* Time */}
          <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
            {/* Read-only: the phone list is for looking, and a dropdown inside a
                tappable row fights the tap that opens the incident. */}
            <IncidentTimeRow
              operation={operation}
              readOnly
              className="gap-1.5"
              startClassName="text-xs"
              chipClassName="text-xs"
              startIconClassName="h-3 w-3"
              iconClassName="h-3 w-3"
            />
          </div>
        </div>
      </div>
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
    prev.status === next.status &&
    prev.priority === next.priority &&
    prev.location === next.location &&
    // The fact block renders these, so they all gate the memo — a comparator
    // that ignores a field leaves stale text on screen after a poll.
    prev.notes === next.notes &&
    prev.leaderName === next.leaderName &&
    prev.crew.join("|") === next.crew.join("|") &&
    prev.vehicles.join("|") === next.vehicles.join("|") &&
    Array.from(prev.vehicleDriverStay).join("|") === Array.from(next.vehicleDriverStay).join("|") &&
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
    prev.pickupRequestedAt?.getTime() === next.pickupRequestedAt?.getTime()
  )
})
