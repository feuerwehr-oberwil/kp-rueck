"use client"

import { useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { AlertCircle, Check, CheckCircle2, ChevronRight, Footprints, MapPin, Package, Truck, Undo2, Users } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import type { Operation } from "@/lib/contexts/operations-context"
import { cn } from "@/lib/utils"
import { PersonName, usePersonNaming } from "@/components/person-name"
import { LeaderBadge, LeaderGlyph } from "@/components/kanban/leader-badge"
import { PersonMenuSubtitle } from "@/components/kanban/chip-menu-subtitle"
import { CrewChipSlot } from "@/components/kanban/route-resource-sections"
import { RemovableChip } from "@/components/ui/removable-chip"
import { usePointerFine } from "@/lib/hooks/use-pointer-fine"
import type { VehicleDrivers } from "@/lib/hooks/use-vehicle-drivers"
import { operationLabel, type DriverStayTarget, type LeaderTarget, type ResourceType } from "@/components/kanban/incident-status/gates"
import type { IncidentStatusWorkflowController } from "@/components/kanban/incident-status/use-incident-status-workflow"

/**
 * Which missing resources actually BAR a dispatch, as opposed to being worth a reminder.
 *
 * Material is deliberately not one of them. Most incidents genuinely need none — a
 * Brandbekämpfung with three people and a TLF is complete — so treating «Material (0)» as a
 * blocker fired the gate on nearly every incident and pushed the Funkdurchsage behind the
 * quietest button in the dialog. A gate that trips on the normal case does not teach care, it
 * teaches clicking through gates.
 *
 * Crew and vehicles stay hard: you cannot send nobody, and you cannot drive without a vehicle
 * unless the incident is marked «zu Fuss» (which getMissingResources already honours).
 */
const BLOCKING_RESOURCES: readonly ResourceType[] = ["crew", "vehicles"]

/** The dispatch gate's box action: its `::after` covers the whole box (the box is `relative`,
 *  the button is not), so a click anywhere on the box is this button's click. */
const GATE_OPEN_STRETCH = "after:absolute after:inset-0 after:rounded-md after:content-['']"

/** Lifted above `GATE_OPEN_STRETCH`: a crew chip, the «EL» stub or a toggle keeps its own
 *  click instead of opening the picker under it. Read-only names stay under it. */
const GATE_ABOVE_OPEN = "relative z-10"

/**
 * «Ressourcen fehlen» — the gate in front of the Funkdurchsage (the board's
 * `missingResources` gate). Rendered once by `IncidentStatusWorkflowDialogs`.
 *
 * PRESS TWICE (owner pick, UX-DESKTOP-09 B): «Disponieren» is always live and
 * always in the same place. With a blocking gap open (no crew, or no vehicle and
 * not «zu Fuss») the first press only ARMS it: the missing row turns amber and
 * asks «wirklich so ausrücken?», the button says what it will do («Ohne
 * Fahrzeug disponieren»), and «Abbrechen» becomes «Zurück». The second press —
 * or Enter, the button has the focus — dispatches; Zurück or Esc disarms. There
 * is no greyed-out button and no third «Trotzdem» button any more.
 *
 * ZU FUSS (borrowed from variant C): without a vehicle the vehicle row offers
 * «Zuweisen | Zu Fuss». «Zu Fuss» sets the card's own `zuFuss` flag, which
 * `getMissingResources` already honours — so it answers the gap and the button
 * goes back to a plain «Disponieren».
 *
 * NAMES, NOT COUNTS (owner pick 19.11.2026, #8/9 A): each row lists what is already there as
 * name chips – the Mannschaft EL first with its «EL» mark, each vehicle as «TLF · Fahrer» with
 * its own «bleibt vor Ort | kehrt zurück» (an Auftrag's vehicles too), the Geräte by name.
 * «Hinzufügen ›» per row opens the assignment, also on an empty row (20.11.2026). Only a row
 * without any vehicle keeps the pair «Zuweisen | Zu Fuss»: there they are two answers.
 *
 * ONE BOX, ONE TARGET (owner pick 19.11.2026b, 1A): every box is the same grid – status |
 * type icon | content | action – so the titles, chips and toggles of all three hang on the
 * same columns, and a click anywhere on a box opens that resource's picker. The action
 * button stays the real control (keyboard, screen reader); its `::after` is stretched over
 * the box (`GATE_OPEN_STRETCH`). Chips, the «EL» stub and the toggles sit above that layer
 * (`GATE_ABOVE_OPEN`), so a click on them is theirs alone. The «EL» stub is the board
 * detail's: hover a crew chip, click the dashed «EL», and that person leads (a chip menu
 * row without a mouse).
 *
 * The armed state belongs to one opening of the gate and one set of gaps: it is
 * dropped when the gate closes (also for an assignment round-trip) and whenever
 * what is missing changes, so a press can never confirm a question it did not see.
 */
export function DispatchGateDialog({
  controller,
  onOpenAssignment,
  onToggleZuFuss,
  vehicleDrivers,
  onSetDriverStay,
  onPromoteLeader,
}: {
  controller: IncidentStatusWorkflowController
  onOpenAssignment: (resourceType: ResourceType, operationId: string) => void
  onToggleZuFuss: (operation: Operation) => void
  vehicleDrivers?: VehicleDrivers
  onSetDriverStay?: (target: DriverStayTarget, driverStay: boolean) => void
  onPromoteLeader?: (target: LeaderTarget) => void
}) {
  const tCommon = useTranslations("kanban.common")
  const tRes = useTranslations("kanban.resources")
  const tMissing = useTranslations("kanban.missingResources")
  const tLeader = useTranslations("kanban.leader")
  const naming = usePersonNaming()
  const primaryRef = useRef<HTMLButtonElement>(null)

  const missingOperation = controller.missingResourcesOperation
  const missing = missingOperation ? controller.getMissingResources(missingOperation) : []
  const allFilled = missing.length === 0
  // The checklist still LISTS everything that is missing; only these hold the dispatch back.
  const blockingGaps = missing.filter((resource) => BLOCKING_RESOURCES.includes(resource))
  const gapKey = missing.join(",")

  // `armedFor`: the opening and the gaps the first press was made against.
  // Reset on every open/close (the render-time «props changed» pattern, no effect).
  const openId = missingOperation?.id ?? null
  const [seenOpenId, setSeenOpenId] = useState(openId)
  const [armedFor, setArmedFor] = useState<string | null>(null)
  // A mouse: a crew chip has no menu, so a click on the name opens the Mannschaft picker like
  // the rest of the box. Touch keeps the chip's menu (remove, «Als Einsatzleiter»).
  const pointerFine = usePointerFine()
  if (seenOpenId !== openId) {
    setSeenOpenId(openId)
    setArmedFor(null)
  }
  const armed = blockingGaps.length > 0 && openId !== null && armedFor === `${openId}|${gapKey}`

  const missingTitleKey = allFilled
    ? "readyTitle"
    : missing.length === 1
      ? missing[0] === "crew"
        ? "titleCrewOnly"
        : missing[0] === "vehicles"
          ? "titleVehiclesOnly"
          : "titleMaterialsOnly"
      : "title"
  const dispatchLabelKey = !armed
    ? "done"
    : blockingGaps.length === 2
      ? "dispatchWithoutBoth"
      : blockingGaps[0] === "crew"
        ? "dispatchWithoutCrew"
        : "dispatchWithoutVehicle"

  const dispatch = () => {
    if (!missingOperation) return
    if (blockingGaps.length > 0 && !armed) {
      setArmedFor(`${missingOperation.id}|${gapKey}`)
      return
    }
    controller.openDisponiert(missingOperation.id)
  }
  const assign = (resourceType: ResourceType, operationId: string) => {
    setArmedFor(null)
    onOpenAssignment(resourceType, operationId)
  }
  // The focus goes back to «Disponieren», so Enter still dispatches after an EL change.
  const promote = (target: LeaderTarget) => {
    onPromoteLeader?.(target)
    primaryRef.current?.focus()
  }

  return (
    // Escape and the overlay are Abbrechen, never the dispatch: these gates open
    // because a card was ALREADY moved, and `cancelGate` puts it back. While the
    // button is armed, Escape first only disarms it (the same as «Zurück»).
    <AlertDialog open={!!missingOperation} onOpenChange={(open) => !open && controller.cancelGate("missingResources")}>
      <AlertDialogContent
        // M, not S: the armed button names both gaps («Ohne Mannschaft und Fahrzeug
        // disponieren») beside «Zurück», and the rows list names (dialog-frame.ts).
        size="md"
        // The dispatch button takes the focus, so Enter is the first press and
        // Enter again the confirmation — the keyboard path of the mouse's two clicks.
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          primaryRef.current?.focus()
        }}
        onEscapeKeyDown={(event) => {
          if (!armed) return
          event.preventDefault()
          setArmedFor(null)
        }}
      >
        {missingOperation && (() => {
          const coverage = controller.getResourceCoverage(missingOperation)
          // An edge of their own (the mock's chips): on the hovered box the chip fill and the box tint are
          // nearly one tone.
          // Vehicle and material names are read-only: they stay UNDER the opener, so a click on
          // one opens the box's picker like the rest of the box (owner: «the entire row/box»).
          const chip = "max-w-full min-w-0 gap-1 border-border font-normal"
          // A crew chip has its own menu (remove, «Als Einsatzleiter»): lifted above the opener.
          const crewChip = cn(chip, GATE_ABOVE_OPEN)
          // The EL slot before every crew chip (`CrewChipSlot`, as in the board detail):
          // only where it can hold something – a promotable person, or somebody leading.
          const crewHasLeaderSlot = (Boolean(onPromoteLeader) && coverage.crew.some((member) => member.leaderTarget))
            || coverage.crew.some((member) => member.isLeader)
          const rows = [
            {
              key: "crew" as const,
              icon: Users,
              count: coverage.crew.length,
              names: coverage.crew.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {coverage.crew.map((member) => {
                    const target = onPromoteLeader ? member.leaderTarget : null
                    return (
                      <CrewChipSlot
                        key={member.personnelId}
                        leader={
                          crewHasLeaderSlot && (
                            <LeaderBadge
                              isLeader={member.isLeader}
                              // The current EL is a read-only mark: the button form lets a touch
                              // fall through (`pointer-events-none`) – here onto the box's picker.
                              onPromote={target && !member.isLeader ? () => promote(target) : undefined}
                              // ≤768px the global touch rule squares every button to 44px; the
                              // 16px mark keeps its size, its `hit-area` pad is the 46px target.
                              className={cn("max-md:min-h-0 max-md:min-w-0", GATE_ABOVE_OPEN)}
                            />
                          )
                        }
                      >
                        {/* Not a button of its own: the box's «Hinzufügen ›» is the keyboard way in. */}
                        <span
                          className={cn("inline-flex min-w-0 max-w-full", pointerFine && "cursor-pointer")}
                          onClick={pointerFine ? () => assign("crew", missingOperation.id) : undefined}
                        >
                        <RemovableChip
                          variant="secondary"
                          className={cn(crewChip, pointerFine && "hover:border-foreground/20")}
                          // Touch: no hover, so no stub – the chip's menu offers the promotion.
                          menuTitle={naming.inline({ name: member.name, personnelId: member.personnelId })}
                          menuSubtitle={<PersonMenuSubtitle personnelId={member.personnelId} isLeader={member.isLeader} />}
                          menuActions={
                            target && !member.isLeader
                              ? [{ label: tLeader("promote"), icon: <LeaderGlyph />, onSelect: () => promote(target) }]
                              : undefined
                          }
                        >
                          <span className="min-w-0 truncate">
                            <PersonName name={member.name} personnelId={member.personnelId} />
                          </span>
                        </RemovableChip>
                        </span>
                      </CrewChipSlot>
                    )
                  })}
                </div>
              ),
            },
            {
              key: "vehicles" as const,
              icon: Truck,
              count: coverage.vehicles.length,
              names: missingOperation.zuFuss && coverage.vehicles.length === 0 ? null : coverage.vehicles.length > 0 && (
                <div className="space-y-1">
                  {coverage.vehicles.map((vehicle) => {
                    const driver = vehicleDrivers?.get(vehicle.vehicleId)
                    const stay = vehicle.driverStay
                    return (
                      <div key={vehicle.vehicleId} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <Badge variant="secondary" className={chip}>
                          <span className="min-w-0 truncate">
                            <span className="font-semibold">{vehicle.name}</span>
                            {driver && <> · <PersonName name={driver.name} personnelId={driver.personnelId} /></>}
                          </span>
                        </Badge>
                        {/* Unsaid while the assign POST has not answered (`driverStay` absent).
                            `ml-auto`: right-aligned with the action above it. */}
                        {onSetDriverStay && stay !== undefined && (
                          <div role="group" aria-label={vehicle.name} className={cn("ml-auto flex flex-shrink-0", GATE_ABOVE_OPEN)}>
                            <Button
                              variant={stay ? "selected" : "outline"}
                              size="xs"
                              className="rounded-r-none"
                              aria-pressed={stay}
                              onClick={() => !stay && onSetDriverStay(vehicle.target, true)}
                            >
                              <MapPin className="h-3.5 w-3.5" />
                              {tCommon("driverStaysFull")}
                            </Button>
                            <Button
                              variant={stay ? "outline" : "selected"}
                              size="xs"
                              className="-ml-px rounded-l-none"
                              aria-pressed={!stay}
                              onClick={() => stay && onSetDriverStay(vehicle.target, false)}
                            >
                              <Undo2 className="h-3.5 w-3.5" />
                              {tCommon("driverReturnsFull")}
                            </Button>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              ),
            },
            {
              key: "materials" as const,
              icon: Package,
              count: coverage.materials.length,
              names: coverage.materials.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {coverage.materials.map((material) => (
                    <Badge key={material.id} variant="secondary" className={chip}>
                      <span className="min-w-0 truncate">{material.name ?? tCommon("unknownResource")}</span>
                    </Badge>
                  ))}
                </div>
              ),
            },
          ]
          return (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle className="flex items-center gap-2">
                  {allFilled
                    ? <CheckCircle2 className="h-5 w-5 text-success" />
                    : <Package className="h-5 w-5 text-muted-foreground" />}
                  {tMissing(missingTitleKey)}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {tMissing.rich(allFilled ? "readyIntro" : "checklistIntro", {
                    location: operationLabel(missingOperation),
                    hl: (chunks) => <span className="font-medium text-foreground">{chunks}</span>,
                  })}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <div className="space-y-1.5 py-1">
                {rows.map(({ key, icon: Icon, count, names }) => {
                  const filled = !missing.includes(key)
                  const asking = armed && blockingGaps.includes(key)
                  const open = () => assign(key, missingOperation.id)
                  // No vehicle of its own or on the route: the row answers with
                  // «Zuweisen | Zu Fuss» instead of a plain «Zuweisen».
                  const footOption = key === "vehicles" && coverage.vehicles.length === 0
                  const action = footOption ? (
                    <div role="group" aria-label={tRes(key)} className="flex flex-shrink-0">
                      <Button
                        variant="outline"
                        size="xs"
                        className={cn("rounded-r-none", GATE_OPEN_STRETCH)}
                        data-gate-open=""
                        onClick={open}
                      >
                        {tCommon("assign")}
                      </Button>
                      <Button
                        variant={missingOperation.zuFuss ? "selected" : "outline"}
                        size="xs"
                        className={cn("-ml-px rounded-l-none", GATE_ABOVE_OPEN)}
                        aria-pressed={missingOperation.zuFuss}
                        onClick={() => onToggleZuFuss(missingOperation)}
                      >
                        <Footprints className="h-3.5 w-3.5" />
                        {tCommon("zuFuss")}
                      </Button>
                    </div>
                  ) : (
                    // Empty or not, the same quiet «Hinzufügen ›» (owner, 20.11.2026): the whole box is
                    // the target, so no outlined button inside it. No fill and no side padding: the box
                    // is what lights up, and «›» ends on the toggles' right edge below it.
                    <Button
                      variant="ghost"
                      size="xs"
                      className={cn("flex-shrink-0 gap-0.5 px-0 text-muted-foreground hover:bg-transparent has-[>svg]:px-0", GATE_OPEN_STRETCH)}
                      data-gate-open=""
                      onClick={open}
                    >
                      {tMissing("addMore")}
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                  )
                  const body = asking
                    ? <div className="text-xs text-muted-foreground">{tMissing(key === "crew" ? "armedCrew" : "armedVehicles")}</div>
                    : names
                  return (
                    <div
                      key={key}
                      role="group"
                      aria-label={tRes(key)}
                      data-gate-row={key}
                      className={cn(
                        // status | type icon | content | action — the same columns in every box.
                        "relative grid w-full cursor-pointer grid-cols-[1rem_1rem_minmax(0,1fr)_auto] items-center gap-x-3",
                        "rounded-md border px-3 py-2 transition-colors",
                        // Hover = the whole box, but only where a click opens the picker:
                        // over a chip or a toggle the box stays as it is.
                        asking
                          ? "border-warning/60 bg-warning/10 has-[[data-gate-open]:hover]:bg-warning/15"
                          : "has-[[data-gate-open]:hover]:border-foreground/20 has-[[data-gate-open]:hover]:bg-muted",
                      )}
                    >
                      {filled
                        ? <CheckCircle2 className="h-4 w-4 text-success" />
                        : <AlertCircle className="h-4 w-4 text-warning-foreground" />}
                      <Icon className="h-4 w-4 text-muted-foreground" />
                      <div className="min-w-0 text-sm font-medium">
                        {tRes(key)}
                        {count > 0 && <span className="text-xs font-normal text-muted-foreground"> · {count}</span>}
                        {key === "vehicles" && missingOperation.zuFuss && count === 0 && (
                          <span className="text-xs font-normal text-muted-foreground"> · {tCommon("zuFuss")}</span>
                        )}
                      </div>
                      {action}
                      {body && <div className="col-span-2 col-start-3 mt-1">{body}</div>}
                    </div>
                  )
                })}
              </div>
              <div className="space-y-2">
                <AlertDialogFooter>
                  {armed ? (
                    <Button variant="outline" onClick={() => setArmedFor(null)}>
                      {tMissing("back")}
                    </Button>
                  ) : (
                    <Button variant="outline" onClick={() => controller.cancelGate("missingResources")}>
                      {tCommon("cancel")}
                    </Button>
                  )}
                  <Button ref={primaryRef} onClick={dispatch}>
                    {armed && <Check className="h-4 w-4" />}
                    {tMissing(dispatchLabelKey)}
                  </Button>
                </AlertDialogFooter>
                {armed && (
                  <p role="status" className="text-right text-xs text-muted-foreground">
                    {tMissing("armedHint")}
                  </p>
                )}
              </div>
            </>
          )
        })()}
      </AlertDialogContent>
    </AlertDialog>
  )
}
