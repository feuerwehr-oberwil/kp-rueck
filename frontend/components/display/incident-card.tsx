"use client"

/**
 * The command-post card, rendered for a screen nobody operates.
 *
 * `/display/board` is not a second design — it is THE board with every control
 * taken out. So this component follows `components/kanban/draggable-operation.tsx`
 * block for block and in the same order (Kopf → Meldung → Melder → Ressourcen →
 * Auftrag → Reko), down to the two section rules and the 12px rhythm between
 * them. A difference from the kanban card is a bug here, unless it exists
 * because the control it belonged to was removed.
 *
 * What was removed, and why each one is a control rather than information:
 *  * drag source, drop target, context menu, the card's own status controls;
 *  * the X on every resource chip (`RemovableChip` without `onRemove` keeps the
 *    exact chip, minus the button), the driver-stay toggle (the MapPin/Undo2
 *    glyph stays — it is the state, the click was the control), the «Ansicht»
 *    menu, the time-mode dropdown (`readOnly`);
 *  * the Feldmeldungen nudge, which renders nothing without `canEdit` because it
 *    is a question with two buttons, not a status;
 *  * the map link and the `tel:` link — a wall display has no pointer and no
 *    telephone; both facts are still on the card, as text.
 *
 * It takes everything it renders as props and reads no context, because the
 * share-token board mounts it with no session and therefore with empty
 * contexts: what the token payload cannot supply (the Rapport flags) is absent
 * rather than empty, and the block disappears with its rule.
 *
 * The Reko photos are NOT drawn here even though `rekoSummary` now carries
 * them. A card is the glance; a picture on it costs a row of height on every
 * card in the column and says less than the two lines of Reko text next to it.
 * They belong in the detail dialog, where somebody is already looking.
 */

import { useTranslations } from "next-intl"
import {
  AlertTriangle, Binoculars, Building2, ChevronDown, ChevronUp, FileText, Footprints,
  Layers, MapPin, Minus, Package, Phone, Search, Siren, Timer, Truck, Undo2, Users, Waypoints,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { RemovableChip } from "@/components/ui/removable-chip"
import { IncidentTimeRow } from "@/components/ui/incident-time"
import { LeaderBadge } from "@/components/kanban/leader-badge"
import { PickupBadge } from "@/components/kanban/pickup-badge"
import { type Operation } from "@/lib/contexts/operations-context"
import { type Material, type MaterialGroup } from "@/lib/contexts/materials-context"
import { type GroupResources, type IncidentGroup } from "@/lib/types/groups"
import { DEFAULT_CARD_VIEW, type CardViewSettings } from "@/lib/card-view"
import { groupAssignedMaterials } from "@/lib/material-grouping"
import { rapportApplies } from "@/lib/rapport-visibility"
import { sortCrewByLeader } from "@/lib/crew-order"
import { getIncidentLocationLabel, getIncidentTypeLabel } from "@/lib/incident-types"
import { PRIORITY_CARD_CLASSES, PRIORITY_ICON_CLASSES, type Priority } from "@/lib/priority"
import { formatClockTime } from "@/lib/incident-time"
import { cn } from "@/lib/utils"

/** Same two boundaries the kanban card draws — Ressourcen and Reko — and the
 *  same rule: whichever block OPENS a section carries it, so a section that
 *  renders nothing cannot leave a line above nothing. */
const SECTION_RULE = "border-t pt-3"

/** The priority treatment comes from lib/priority.ts, not from a copy of
 *  `draggable-operation.tsx` — importing the CARD would pull the whole
 *  drag-and-drop adapter onto a wall that has nothing to drag, importing the
 *  TABLE costs nothing. The copy that used to live here was «checked whenever
 *  either card changes», which is exactly the promise that had already been
 *  broken by the time anybody looked. */

export interface DisplayIncidentCardProps {
  operation: Operation
  /** The same per-device switches the kanban card obeys — `useCardView()` is
   *  shared across the tabs of one machine, so the wall shows what the board
   *  next to it shows. Read-only here: the display offers no «Ansicht» menu. */
  cardView?: CardViewSettings
  /** For resolving material ids to names; empty is tolerated (ids are shown). */
  materials?: Material[]
  materialGroups?: MaterialGroup[]
  /** Material the crew left standing at the address (from the Rapport). Typed
   *  by the only thing the card asks of it, so the board can hand over its
   *  `materialOnSite` map without copying it into a Set. */
  materialOnSite?: { has(materialId: string): boolean }
  /** Vehicle name → driver, loaded once per board rather than per card. */
  vehicleDrivers?: ReadonlyMap<string, string>
  /** Names assigned to more than one incident — the card's conflict styling. */
  doubleBookedCrewNames?: ReadonlySet<string>
  /** The Auftrag this stop belongs to, resolved by the caller (the token board
   *  has no groups context). */
  auftrag?: IncidentGroup
  /** The route's resources — a stop owns none of its own. */
  auftragResources?: GroupResources | null
  isHighlighted?: boolean
  isFlashing?: boolean
  onClick?: () => void
}

export function DisplayIncidentCard({
  operation,
  cardView = DEFAULT_CARD_VIEW,
  materials = [],
  materialGroups = [],
  materialOnSite,
  vehicleDrivers,
  doubleBookedCrewNames,
  auftrag,
  auftragResources,
  isHighlighted = false,
  isFlashing = false,
  onClick,
}: DisplayIncidentCardProps) {
  const t = useTranslations("kanban")
  const tFeld = useTranslations("feld.board")

  const priority = (operation.priority || "low") as Priority

  const auftragTotal = auftrag ? auftrag.stopIds.length : 0
  const auftragStopIndex = auftrag ? auftrag.stopIds.indexOf(operation.id) : -1
  const auftragStopPos = auftrag
    ? (auftragStopIndex >= 0 ? auftragStopIndex + 1 : operation.groupPosition + 1)
    : 0
  const auftragSummary = auftragResources
    ? [
        auftragResources.vehicles.map((v) => v.name).join(", "),
        auftragResources.personnel.length ? t("card.auftragPersSummary", { count: auftragResources.personnel.length }) : "",
        auftragResources.materials.length ? t("card.auftragMatSummary", { count: auftragResources.materials.length }) : "",
      ]
        .filter(Boolean)
        .join(" · ")
    : ""
  // The whole row as one string. Kept even though a wall has no pointer: the
  // logged-in /display/board is also opened on a desk, and the attribute used to
  // carry the Auftrag NAME — the one part of the row that was never cut off.
  const auftragTitle = auftrag
    ? [
        auftrag.name,
        t("card.auftragStopLine", { pos: auftragStopPos, total: auftragTotal }),
        auftragSummary,
      ]
        .filter(Boolean)
        .join(" · ")
    : ""

  // Resolved up front for the same reason the kanban card does it: the resource
  // block owns a rule and a gap, so a block whose every row is switched off has
  // to take both with it.
  const showRekoPerson = cardView.reko && !!operation.assignedReko
  const showCrewRow = cardView.mannschaft && !auftrag && operation.crew.length > 0
  const showVehicleRow = cardView.fahrzeuge && !auftrag && (operation.zuFuss || operation.vehicles.length > 0)
  const showMaterialRow = cardView.material && !auftrag && operation.materials.length > 0
  const showNachbarhilfeRow = !!operation.nachbarhilfe
  const showResourceBlock =
    showRekoPerson || showCrewRow || showVehicleRow || showMaterialRow || showNachbarhilfeRow
  const showMeldungBlock = cardView.meldung && !!operation.notes
  const showMelderBlock = cardView.melder && !!(operation.contact || operation.contactPhone)
  const showAuftragBlock = cardView.auftrag && !!auftrag
  const showRekoSummary = cardView.reko && !!operation.rekoSummary
  // The free text the Reko dictated. The kanban card leaves it to the detail —
  // on a wall there is nobody to click, so the finding itself stays, two lines
  // of it, at the bottom of the block it belongs to.

  return (
    <Card
      data-incident-id={operation.id}
      className={cn(
        "operation-card border border-border border-l-4 bg-card/80 backdrop-blur-sm p-4 transition-all",
        PRIORITY_CARD_CLASSES[priority],
        onClick && "cursor-pointer hover:bg-muted/20",
        // The other window said "this one" — same accent frame the board uses.
        isHighlighted && "is-highlighted border-l-accent bg-muted/30 ring-[1.5px] ring-accent shadow-lg shadow-accent/25",
        isFlashing && "display-card-flash",
      )}
      onClick={onClick}
    >
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2 min-w-0 flex-1">
            <div className="flex items-center flex-shrink-0 mt-0.5">
              {priority === "high" ? (
                <ChevronUp className={cn("h-4 w-4", PRIORITY_ICON_CLASSES[priority])} aria-label={t("card.priorityHighAria")} />
              ) : priority === "medium" ? (
                <Minus className={cn("h-4 w-4", PRIORITY_ICON_CLASSES[priority])} aria-label={t("card.priorityMediumAria")} />
              ) : (
                <ChevronDown className={cn("h-4 w-4", PRIORITY_ICON_CLASSES[priority])} aria-label={t("card.priorityLowAria")} />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="font-bold text-base text-foreground leading-tight break-words">
                {getIncidentLocationLabel(operation)}
              </h3>
              {/* A crew standing at the kerb is the last thing a wall display
                  may keep to itself. No `incidentId`: the chip stays a label. */}
              {operation.pickupNeeded && (
                <PickupBadge
                  requestedAt={operation.pickupRequestedAt}
                  note={operation.pickupNote}
                  canEdit={false}
                  className="mt-1.5"
                />
              )}
            </div>
          </div>
          {/* The status glyphs — the row that told the operator at a glance what
              kind of card this is, and was missing here entirely. */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {operation.source === "intake" && (
              <div className="p-1.5 rounded-md bg-sky-100 dark:bg-sky-900/30" title={t("card.intakeTooltip")}>
                <Phone className="h-4 w-4 text-sky-600 dark:text-sky-400" />
              </div>
            )}
            {operation.amWarten && (
              <div className="p-1.5 rounded-md bg-amber-100 dark:bg-amber-900/30" title={t("common.amWarten")}>
                <Timer className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              </div>
            )}
            {operation.nachbarhilfe && (
              <div className="p-1.5 rounded-md bg-muted/60" title={t("common.nachbarhilfe")}>
                <Building2 className="h-4 w-4 text-muted-foreground/80" />
              </div>
            )}
            {operation.hasCompletedReko && (
              <div className="p-1.5 rounded-md bg-muted/60" title={t("card.rekoDoneTooltip")}>
                <Binoculars className="h-4 w-4 text-muted-foreground/80" />
              </div>
            )}
            {operation.hasSchadenplatzRapport ? (
              <div className="p-1.5 rounded-md bg-muted/60" title={tFeld("cardRapportTooltip")}>
                <FileText className="h-4 w-4 text-muted-foreground/80" />
              </div>
            ) : operation.status === "complete" && rapportApplies({
                hasBeenDispatched: operation.hasBeenDispatched,
                status: operation.status,
                hasReport: operation.hasSchadenplatzRapportDraft,
              }) ? (
              <div className="p-1.5 rounded-md bg-muted/40" title={tFeld("cardNoRapportTooltip")}>
                <FileText className="h-4 w-4 text-muted-foreground/40" />
              </div>
            ) : null}
          </div>
        </div>

        {/* Einsatzart and time on one row, each half independently switchable —
            the board's own three branches. `readOnly`: the mode follows the
            station setting, and nobody works a dropdown on a wall. */}
        {cardView.einsatzart && cardView.zeiten ? (
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-1.5">
              <Siren className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
              <span className="truncate text-xs text-muted-foreground" title={getIncidentTypeLabel(operation.incidentType)}>
                {getIncidentTypeLabel(operation.incidentType)}
              </span>
            </div>
            <IncidentTimeRow operation={operation} readOnly colorByAge className="flex-shrink-0" />
          </div>
        ) : cardView.einsatzart ? (
          <div className="flex items-center gap-1.5">
            <Siren className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
            <span className="truncate text-xs text-muted-foreground">{getIncidentTypeLabel(operation.incidentType)}</span>
          </div>
        ) : cardView.zeiten ? (
          <IncidentTimeRow operation={operation} readOnly colorByAge className="justify-between" />
        ) : null}

        {showMeldungBlock && (
          <div>
            <p className="text-xs text-muted-foreground line-clamp-3 whitespace-pre-wrap">{operation.notes}</p>
          </div>
        )}

        {/* Melder — the name and the number, as text: there is nothing to dial
            from a wall, and a link the room cannot click is a control. */}
        {showMelderBlock && (
          <div className="flex items-start gap-1.5 text-xs">
            <Phone className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0 mt-px" />
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 min-w-0">
              {operation.contact && <span className="text-muted-foreground break-words">{operation.contact}</span>}
              {operation.contactPhone && (
                <span className="tabular-nums text-muted-foreground">{operation.contactPhone}</span>
              )}
            </div>
          </div>
        )}

        {/* RESSOURCEN — who and what is at this address. */}
        {showResourceBlock && (
          <div className={cn(SECTION_RULE, "space-y-3 text-xs")}>
            {showRekoPerson && operation.assignedReko && (
              <div className="flex items-start gap-1.5">
                <Search className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0 mt-1" />
                <div className="flex flex-wrap items-center gap-1 min-w-0">
                  <RemovableChip
                    variant="secondary"
                    className="text-xs px-1.5 py-0.5 font-normal flex items-center gap-1"
                  >
                    <span>{operation.assignedReko.name}</span>
                  </RemovableChip>
                  {operation.rekoArrivedAt && !operation.hasCompletedReko && (
                    <span className="text-xs text-muted-foreground">
                      {t("card.onSiteSince", { time: formatClockTime(operation.rekoArrivedAt) })}
                    </span>
                  )}
                </div>
              </div>
            )}
            {showCrewRow && (
              <div className="flex items-start gap-1.5">
                <Users className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0 mt-1" />
                <div className="flex flex-wrap gap-1 min-w-0">
                  {/* EL first (decision 23) — off a wall at distance, the first
                      badge is the one that gets read at all. */}
                  {sortCrewByLeader(operation.crew, operation.leaderName).map((crewName) => {
                    const isConflict = doubleBookedCrewNames?.has(crewName) ?? false
                    return (
                      <RemovableChip
                        key={crewName}
                        variant="secondary"
                        className={cn(
                          "text-xs px-1.5 py-0.5 font-normal flex items-center gap-1",
                          isConflict && "border border-warning/60 text-warning-foreground bg-warning/10",
                        )}
                        title={isConflict ? t("card.doubleBookedTooltip", { name: crewName }) : undefined}
                      >
                        {isConflict && <AlertTriangle className="h-3 w-3 flex-shrink-0" />}
                        <LeaderBadge isLeader={operation.leaderName === crewName} />
                        <span>{crewName}</span>
                      </RemovableChip>
                    )
                  })}
                </div>
              </div>
            )}
            {showVehicleRow && (
              <div className="flex items-start gap-1.5">
                <Truck className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0 mt-1" />
                <div className="flex flex-wrap gap-1 min-w-0">
                  {operation.zuFuss && (
                    <RemovableChip variant="secondary" className="text-xs px-1.5 py-0.5 font-normal flex items-center gap-1">
                      <Footprints className="h-3 w-3 flex-shrink-0" />
                      <span>{t("common.zuFuss")}</span>
                    </RemovableChip>
                  )}
                  {operation.vehicles.map((vehicleName) => {
                    const callsign = operation.vehicleCallsigns.get(vehicleName)
                    const driverStay = operation.vehicleDriverStay?.get(vehicleName)
                    const driverName = vehicleDrivers?.get(vehicleName)
                    return (
                      <RemovableChip
                        key={vehicleName}
                        variant="secondary"
                        className="text-xs px-1.5 py-0.5 font-normal flex items-center gap-1"
                        title={callsign ? t("common.funkrufname", { callsign }) : undefined}
                      >
                        <span className="flex items-center gap-1">
                          <span>
                            {vehicleName}{callsign ? ` · ${callsign}` : ""}
                            {driverName && <span className="text-muted-foreground"> ({driverName})</span>}
                          </span>
                          {/* The glyph is the state — «Fahrer bleibt» vs
                              «Fahrer fährt zurück». Only the click was removed. */}
                          {driverStay !== undefined && (driverStay ? (
                            <MapPin className="h-3 w-3 flex-shrink-0 text-muted-foreground/70" aria-label={t("common.driverStays")} />
                          ) : (
                            <Undo2 className="h-3 w-3 flex-shrink-0 text-muted-foreground/40" aria-label={t("common.driverReturns")} />
                          ))}
                        </span>
                      </RemovableChip>
                    )
                  })}
                </div>
              </div>
            )}
            {showMaterialRow && (
              <div className="flex items-start gap-1.5">
                <Package className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0 mt-1" />
                <div className="flex flex-wrap gap-1 min-w-0">
                  {(() => {
                    const { completeGroups, ungrouped } = groupAssignedMaterials(operation.materials, materials, materialGroups)
                    return (
                      <>
                        {completeGroups.map(({ group }) => (
                          <RemovableChip
                            key={`group-${group.id}`}
                            variant="secondary"
                            className="text-xs px-1.5 py-0.5 font-normal flex items-center gap-1"
                          >
                            <Layers className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
                            <span>{group.name}</span>
                          </RemovableChip>
                        ))}
                        {ungrouped.map((materialId) => {
                          const material = materials.find((m) => m.id === materialId)
                          const onSite = materialOnSite?.has(materialId) ?? false
                          return (
                            <RemovableChip
                              key={materialId}
                              variant="secondary"
                              className={cn(
                                "text-xs px-1.5 py-0.5 font-normal flex items-center gap-1",
                                onSite && "bg-warning/15 text-warning-foreground",
                              )}
                            >
                              {onSite && <MapPin className="h-3 w-3 flex-shrink-0" />}
                              <span>{material?.name || materialId}</span>
                            </RemovableChip>
                          )
                        })}
                      </>
                    )
                  })()}
                </div>
              </div>
            )}
            {showNachbarhilfeRow && (
              <div className="flex items-start gap-1.5">
                <Building2 className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0 mt-px" />
                <div className="flex flex-wrap items-center gap-1 min-w-0">
                  <span className="text-muted-foreground break-words">
                    {operation.nachbarhilfeNote || t("common.nachbarhilfe")}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* AUFTRAG — part of the Ressourcen section (the route is where this
            stop's crew and vehicles actually are), so it carries the rule only
            when nothing above it opened the section. Not a button here: the
            Aufträge sheet it opens is an editing surface.
            The crew names ride underneath, which the kanban card leaves to its
            sheet: a route is one squad, and «wer ist dort» is the question
            somebody walks up to the wall to answer — a count cannot. */}
        {showAuftragBlock && auftrag && (
          <div className={cn("text-xs", !showResourceBlock && SECTION_RULE)}>
            <div className="flex w-full min-w-0 items-start gap-1.5" title={auftragTitle}>
              <Waypoints className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0 mt-0.5" />
              <span
                className="h-2 w-2 rounded-full flex-shrink-0 mt-1"
                style={{ backgroundColor: auftrag.color ?? "var(--muted-foreground)" }}
              />
              {/* Two lines, the same shape as the kanban card — and needed here
                  more, not less. Measured on this board: one line gave the
                  summary 19px of the 264px card at 1280 (39px of 284px at 1920)
                  for 106px of content, so it rendered «P…», and a wall has
                  nobody to hover the tooltip that could give it back. Split, the
                  progress and the summary have 193px for ~161px of text and
                  neither truncates at either width. */}
              <span className="flex min-w-0 flex-1 flex-col gap-px">
                <span className="truncate font-medium text-foreground/80">{auftrag.name}</span>
                <span className="truncate text-2xs text-muted-foreground">
                  <span className="tabular-nums">
                    {t("card.auftragStopLine", { pos: auftragStopPos, total: auftragTotal })}
                  </span>
                  {auftragSummary && <> · {auftragSummary}</>}
                </span>
              </span>
            </div>
            {auftragResources && auftragResources.personnel.length > 0 && (
              <div className="mt-1.5 flex items-start gap-1.5">
                <Users className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0 mt-1" />
                <div className="flex flex-wrap gap-1 min-w-0">
                  {sortCrewByLeader(auftragResources.personnel, (p) => Boolean(p.isLeader)).map((p) => (
                    <RemovableChip
                      key={p.assignmentId}
                      variant="secondary"
                      className="text-xs px-1.5 py-0.5 font-normal flex items-center gap-1"
                    >
                      <LeaderBadge isLeader={Boolean(p.isLeader)} />
                      <span>{p.name}</span>
                    </RemovableChip>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* REKO — section three: what somebody went and looked at is a different
            kind of statement from everything above it. */}
        {showRekoSummary && operation.rekoSummary && (
          <div className={cn(SECTION_RULE, "space-y-3")}>
            {operation.rekoSummary.hasDangers && operation.rekoSummary.dangerTypes.length > 0 && (
              <div className="flex items-start gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0 mt-1" />
                <div className="flex flex-wrap gap-1">
                  {operation.rekoSummary.dangerTypes.map((danger, idx) => (
                    <Badge key={idx} variant="outline" className="text-xs px-1.5 py-0.5">
                      {danger}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {(operation.rekoSummary.personnelCount || operation.rekoSummary.estimatedDuration) && (
              <div className="text-xs text-muted-foreground">
                {operation.rekoSummary.personnelCount && (
                  <span className="mr-3">{t("card.persCount", { count: operation.rekoSummary.personnelCount })}</span>
                )}
                {operation.rekoSummary.estimatedDuration && <span>{operation.rekoSummary.estimatedDuration}h</span>}
              </div>
            )}

            {/* The Reko's own words are NOT on the card. They were, briefly, on
                the theory that a wall is scanned rather than clicked — but the
                command-post card does not carry them either, and a sentence
                clamped to two lines is a sentence you have to open the incident
                to finish anyway. Dangers and Aufwand stay: those are the facts
                you scan for. The full finding is the first thing in the detail's
                Reko block. */}
          </div>
        )}
      </div>
    </Card>
  )
}
