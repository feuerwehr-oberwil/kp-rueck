"use client"

import { useTranslations } from "next-intl"
import { ArrowRight, CheckCircle2, ClipboardCheck, Footprints, Package, Pencil, Waypoints } from "lucide-react"
import { toast } from "sonner"
import { undoToast } from "@/lib/toast-undo"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { AssignRekoDialog } from "@/components/incidents/assign-reko-dialog"
import { RekoReportGateDialog } from "@/components/reko/reko-report-gate-dialog"
import { DisponierTransitionDialog } from "@/components/kanban/disponiert-transition-dialog"
import type { Operation } from "@/lib/contexts/operations-context"
import { statusBadgeClass } from "@/lib/kanban-utils"
import type { OperationDetailSection, OperationDetailTab } from "@/lib/hooks/use-operation-detail-shortcuts"
import type { VehicleDrivers } from "@/lib/hooks/use-vehicle-drivers"
import { operationLabel, type DriverStayTarget, type LeaderTarget, type ResourceType } from "@/components/kanban/incident-status/gates"
import type { IncidentStatusWorkflowController } from "@/components/kanban/incident-status/use-incident-status-workflow"
import { DispatchGateDialog } from "@/components/kanban/incident-status/dispatch-gate-dialog"

interface IncidentStatusWorkflowDialogsProps {
  controller: IncidentStatusWorkflowController
  printerEnabled: boolean
  funkrufname: string
  diveraEnabled: boolean
  onOpenAssignment: (resourceType: ResourceType, operationId: string) => void
  /** «Zu Fuss» in the dispatch gate: flip the card's own `zuFuss` flag. */
  onToggleZuFuss: (operation: Operation) => void
  /** No gate opens the detail since the Reko form opens in its own dialog (#4, 19.11.2026);
   *  kept while the pages still pass it (the map's detail modal hangs off it). */
  onOpenDetail?: (operationId: string, tab?: OperationDetailTab, section?: OperationDetailSection) => void
  onSendDivera: (operation: Operation) => void
  onRefresh: () => unknown
  /** Who drives which vehicle – named in the dispatch gate's vehicle chips. */
  vehicleDrivers?: VehicleDrivers
  /** «bleibt vor Ort | kehrt zurück» in the dispatch gate; without it the rows show no toggle. */
  onSetDriverStay?: (target: DriverStayTarget, driverStay: boolean) => void
  /** The dispatch gate's «EL» stub; without it the crew shows who leads, read-only. */
  onPromoteLeader?: (target: LeaderTarget) => void
}

/** Every gate of the status workflow, rendered once per page next to `useIncidentStatusWorkflow`
 *  (`incident-dialogs.tsx`); each dialog opens off the controller's state. */
export function IncidentStatusWorkflowDialogs({
  controller,
  printerEnabled,
  funkrufname,
  diveraEnabled,
  onOpenAssignment,
  onToggleZuFuss,
  onSendDivera,
  onRefresh,
  vehicleDrivers,
  onSetDriverStay,
  onPromoteLeader,
}: IncidentStatusWorkflowDialogsProps) {
  const tCommon = useTranslations("kanban.common")
  const tDash = useTranslations("kanban.dashboard")
  const tReturning = useTranslations("kanban.returningVehicle")
  const tRekoGate = useTranslations("kanban.rekoGate")
  const tMat = useTranslations("kanban.materialDecision")
  const tNext = useTranslations("kanban.nextStop")
  const tCompletion = useTranslations("kanban.completion")
  const tCorrection = useTranslations("kanban.statusCorrection")
  const tColumns = useTranslations("kanban.columns")

  // The completion gate's two subjects: what is released (null when the gate is
  // open for material alone) and how many units still need an answer.
  const release = controller.completionRelease
  const materialCount = controller.materialDecisionItems.length
  // The rapport read matters only for a unit somebody could answer (not a consumable).
  const waitsForAnswers =
    controller.materialAnswersLoading && controller.materialDecisionItems.some((item) => !item.consumable)
  const correction = controller.statusCorrectionPrompt
  // …and, when the finished card is a stop with route left ahead of it, what
  // the Auftrag continues with. Then the gate is not an Abschluss at all.
  const continuation = controller.completionContinuation
  // The stop the gate may additionally OFFER to start, or null when it must not
  // offer anything (last stop, no Auftrag, squad already on another stop).
  const nextStopOffer = controller.completionNextStop

  /**
   * Close the stop — and, when `startNext` is given, put that stop on Einsatz in
   * the same click.
   *
   * One body for both footer buttons on purpose: the offer must not become a
   * second, quieter way of completing an incident that reports itself
   * differently. Starting the next stop goes through the controller's
   * `startNextStop`, the same call the «Nächsten Stopp starten?» prompt makes,
   * so both offers land the card in exactly the same state.
   */
  const confirmCompletion = (startNext: Operation | null) => {
    // Captured before resolving: `resolveMaterialDecision` clears the
    // gate, and the toast's «Rückgängig» has to outlive it.
    const completed = controller.materialDecisionOperation
    const location = completed ? operationLabel(completed) : ""
    const undoStatus = controller.completionReturnStatus
    const { returned, kept } = controller.resolveMaterialDecision()
    // The completion is written first, then the squad is sent on — so an
    // operator watching the board sees the stop leave before the next one runs.
    if (startNext) controller.startNextStop(startNext.id)
    const nameOf = (id: string) => controller.materials.find((material) => material.id === id)?.name ?? id
    const materialParts = [
      returned.length ? `${tMat("toastToMagazin")}: ${returned.map(nameOf).join(", ")}` : null,
      kept.length ? `${tMat("toastOnSite")}: ${kept.map(nameOf).join(", ")}` : null,
    ]
    // The gate has three subjects and the toast reports the one that was
    // actually answered. Material alone — no release, no route ahead — is the
    // only one that is not a completion the operator needs a receipt for.
    if (!release && !continuation) {
      toast.success(returned.length ? tDash("materialReturned") : tMat("leftOnSite"), {
        description: materialParts.filter(Boolean).join(" · ") || undefined,
      })
      return
    }
    // Mid-route the gate never carries a material question (see
    // `materialDecisionItems`), so `materialParts` is empty here and the toast
    // says what actually happened: one stop off the route. On a standard
    // Auftrag there is no release either — crew and vehicles stayed with the
    // route — and the toast is then the stop line alone.
    const title = continuation ? tCompletion("stopToastTitle", { location }) : tCompletion("toastTitle", { location })
    const description = [
      release?.crew.length ? tCompletion("releasedCrew", { count: release.crew.length }) : null,
      release?.vehicles.length ? tCompletion("releasedVehicles", { vehicles: release.vehicles.join(", ") }) : null,
      ...materialParts,
    ].filter(Boolean).join(" · ") || undefined
    // The undo is only offered when we know where the card came from — an undo
    // that has to guess a status is not an undo. It reopens the incident (crew
    // and vehicles come back with the refetch); material already sent to the
    // Magazin stays there.
    if (completed && undoStatus) {
      undoToast(title, { description, onUndo: () => controller.reopenCompleted(completed.id, undoStatus) })
    } else {
      toast.success(title, { description })
    }
  }

  // The open gate waits while its assignment dialog runs.
  const openAssignment = (resourceType: ResourceType, operationId: string) => {
    controller.suspendGateForAssignment()
    onOpenAssignment(resourceType, operationId)
  }

  return (
    <>
      <DispatchGateDialog
        controller={controller}
        onOpenAssignment={openAssignment}
        onToggleZuFuss={onToggleZuFuss}
        vehicleDrivers={vehicleDrivers}
        onSetDriverStay={onSetDriverStay}
        onPromoteLeader={onPromoteLeader}
      />

      <ConfirmDialog
        open={!!controller.returningVehicleOperation}
        onCancel={() => controller.cancelGate("returningVehicle")}
        icon={<Footprints className="h-5 w-5 text-warning-foreground" />}
        title={tReturning("title")}
        description={controller.returningVehicleOperation && tReturning.rich("description", {
          location: operationLabel(controller.returningVehicleOperation),
          hl: (chunks) => <span className="font-medium text-foreground">{chunks}</span>,
        })}
        extraAction={{ label: tReturning("endAnyway"), onSelect: () => controller.closeGate("returningVehicle") }}
        cancelText={tCommon("cancel")}
        confirmText={tReturning("assignVehicle")}
        onConfirm={() => {
          const operation = controller.returningVehicleOperation
          if (operation) openAssignment("vehicles", operation.id)
        }}
      />

      {/* «Nächsten Stopp starten?» — queued BEHIND the missing-vehicle gate
          (`&& !returningVehicleOperation`) rather than racing it: both are
          answers to the same move, and two modals over one card is a question
          about which of them counts. */}
      <ConfirmDialog
        open={!!controller.nextStopPrompt && !controller.returningVehicleOperation}
        onOpenChange={(open) => !open && controller.closeNextStopPrompt()}
        icon={<Waypoints className="h-5 w-5 text-muted-foreground" />}
        title={tNext("title")}
        description={controller.nextStopPrompt && tNext.rich("description", {
          finished: operationLabel(controller.nextStopPrompt.finished),
          auftrag: controller.nextStopPrompt.auftrag.name,
          next: operationLabel(controller.nextStopPrompt.next),
          hl: (chunks) => <span className="font-medium text-foreground">{chunks}</span>,
        })}
        cancelText={tCommon("cancel")}
        confirmText={tNext("confirm")}
        onConfirm={() => {
          const next = controller.nextStopPrompt?.next
          if (next) controller.startNextStop(next.id)
        }}
      />

      {/* The completion gate. One window for the whole of «was passiert beim
          Abschliessen»: what is released by name, and — underneath — the
          per-unit material question that used to be the only thing asked.

          On a stop with route still ahead of it, neither half is an Abschluss:
          the Auftrag runs on, so the window says «Stopp abschliessen» and names
          where the squad goes next, and the material question is gone (the
          Geräte drive on with them — `materialDecisionItems`). There it opens
          for the route alone, with no release list and none promised: on a
          standard Auftrag the Mittel belong to the route, so a stop hands
          nothing back and the offer would otherwise never be seen. */}
      <ConfirmDialog
        open={!!controller.materialDecisionOperation}
        onCancel={() => controller.cancelGate("materialDecision")}
        icon={continuation ? (
          <Waypoints className="h-5 w-5 text-muted-foreground" />
        ) : release ? (
          <CheckCircle2 className="h-5 w-5 text-muted-foreground" />
        ) : (
          <Package className="h-5 w-5 text-muted-foreground" />
        )}
        title={continuation ? tCompletion("stopTitle") : release ? tCompletion("title") : tMat("title")}
        description={controller.materialDecisionOperation && (continuation
          // Mid-route the release list is the only thing that can sit
          // under this sentence (the material question is gone — see
          // `materialDecisionItems`), so when there is no release the
          // text must not promise one: on a standard Auftrag the Mittel
          // belong to the route and the stop hands nothing back.
          ? tCompletion.rich(release ? "stopDescription" : "stopDescriptionNoRelease", {
              location: operationLabel(controller.materialDecisionOperation),
              auftrag: continuation.auftrag.name,
              hl: (chunks) => <span className="font-medium text-foreground">{chunks}</span>,
            })
          : release
          ? tCompletion.rich("description", {
              location: operationLabel(controller.materialDecisionOperation),
              hl: (chunks) => <span className="font-medium text-foreground">{chunks}</span>,
            })
          : tMat.rich(
              // A rapport that answered everything turns this from a decision
              // into a confirmation, and the text has to say so — otherwise the
              // operator reads "entscheide pro Mittel" over answers that are
              // already made and starts checking work somebody else did.
              controller.materialRapportBy
                ? controller.materialDecisionOpenCount === 0
                  ? "descriptionFromRapport"
                  : "descriptionPartialRapport"
                : "description",
              {
                location: operationLabel(controller.materialDecisionOperation),
                count: controller.materialDecisionOpenCount,
                hl: (chunks) => <span className="font-medium text-foreground">{chunks}</span>,
              },
            ))}
        // Two ways out that both close the stop, and one of them also puts the
        // next one on Einsatz (`confirmCompletion`). The offer is the third
        // answer and only appears mid-route: closing the stop stays the single
        // obvious click it was, because the squad may just as well be standing
        // down and the next stop may be one the KP dispatches deliberately.
        // Same readiness as the main answer (mid-route the list is empty, so it is ready).
        extraAction={nextStopOffer && !waitsForAnswers && controller.materialUnanswered === 0 ? {
          label: tCompletion("stopConfirmAndNext"),
          onSelect: () => confirmCompletion(nextStopOffer),
        } : undefined}
        cancelText={tMat("cancel")}
        confirmText={continuation
          ? tCompletion("stopConfirm")
          // A held completion is made by this answer: it says so, also for material alone.
          : release || controller.completionFromStatus
            ? tCompletion("confirm")
            : controller.materialRapportBy && controller.materialDecisionOpenCount === 0
              ? tMat("confirmRapport")
              : tMat("confirm")}
        onConfirm={() => confirmCompletion(null)}
        // Waits for the rapport's answers, then for every unit nobody answered: «Magazin»
        // is never assumed (hunt 2026-11-24).
        confirmDisabled={waitsForAnswers ? "waiting" : controller.materialUnanswered > 0}
      >
        {/* Where the squad goes now — named, because «der nächste Stopp» is
            an address somebody has to read out over the radio. */}
        {continuation && (
          <div className="flex items-center gap-3 rounded-md border border-border bg-muted/40 px-3 py-2">
            <Waypoints className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-sm font-medium">
              {tCompletion("nextStop", { location: operationLabel(continuation.next) })}
            </span>
          </div>
        )}
        {/* What the completion hands back, by name (owner pick «Dialog mit Freigabeliste»,
            hunt 2026-11-24): label │ value rows, read off the card – which still holds
            them, because nothing is released before «Abschliessen». */}
        {(release || controller.completionFromStatus) && (
          <dl className="divide-y border-y text-sm">
            {controller.completionFromStatus && (
              <div className="flex gap-3 py-2">
                <dt className="w-28 flex-shrink-0 text-muted-foreground">{tCompletion("statusLabel")}</dt>
                <dd className="min-w-0">
                  {tColumns(controller.completionFromStatus)} → {tColumns("complete")}
                </dd>
              </div>
            )}
            {release && release.crew.length > 0 && (
              <div className="flex gap-3 py-2">
                <dt className="w-28 flex-shrink-0 text-muted-foreground">{tCompletion("crewReleased")}</dt>
                <dd className="min-w-0">{release.crew.join(", ")}</dd>
              </div>
            )}
            {release && release.vehicles.length > 0 && (
              <div className="flex gap-3 py-2">
                <dt className="w-28 flex-shrink-0 text-muted-foreground">
                  {tCompletion("vehiclesReleased", { count: release.vehicles.length })}
                </dt>
                <dd className="min-w-0">{release.vehicles.join(", ")}</dd>
              </div>
            )}
            {release && materialCount > 0 && (
              <div className="flex gap-3 py-2">
                <dt className="w-28 flex-shrink-0 text-muted-foreground">{tCompletion("materialLabel")}</dt>
                <dd className="min-w-0">
                  {tCompletion("materialCount", { count: materialCount })}
                  <span className="text-warning-foreground"> {tCompletion("toDecision")}</span>
                </dd>
              </div>
            )}
          </dl>
        )}
        {/* The material question keeps its own heading once it sits under a
            release list — two subjects in one window, each labelled. */}
        {release && materialCount > 0 && (
          <p className="border-t pt-3 text-sm font-medium">{tMat("title")}</p>
        )}
        {/* …and only while there is material to say it about: a completion
            that releases people alone must not cite a Materialrapport. */}
        {controller.materialRapportBy && materialCount > 0 && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <ClipboardCheck className="h-3.5 w-3.5 flex-shrink-0" />
            {/* "Rapport" vs "Rapport-Entwurf" (§18.23): the gate reads a
                draft too now, and an operator weighing a half-finished
                answer has to know it is half-finished. */}
            {tMat(controller.materialRapportIsDraft ? "rapportSourceDraft" : "rapportSource", {
              name: controller.materialRapportBy,
            })}
          </p>
        )}
        {controller.materialAnswersLoading && materialCount > 0 && (
          <p className="text-xs text-muted-foreground">{tMat("rapportLoading")}</p>
        )}
        {/* Mid-route the list is empty (`materialDecisionItems`), and an empty
            scroll area is padding pretending to be a section. */}
        {materialCount > 0 && (
          <div className="max-h-64 space-y-1.5 overflow-y-auto py-1">
            {controller.materialDecisionItems.map((item) => {
              const materialId = item.id
              const choice = controller.materialChoice(item)
              const name = controller.materials.find((material) => material.id === materialId)?.name ?? materialId
              return (
                <div key={materialId} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium" title={name}>{name}</span>
                    {item.source ? (
                      <span className="block text-xs text-muted-foreground">
                        {tMat(item.source === "consumable" ? "consumableHint" : "answeredHint")}
                      </span>
                    ) : choice === null && !controller.materialAnswersLoading ? (
                      <span className="block text-xs text-warning-foreground">{tMat("unknownHint")}</span>
                    ) : null}
                  </div>
                  <div className="flex flex-shrink-0 gap-1">
                    <Button size="xs" variant={choice === "magazin" ? "selected" : "outline"} aria-pressed={choice === "magazin"} onClick={() => controller.setMaterialDecision(materialId, "magazin")}>
                      {tMat("toMagazinShort")}
                    </Button>
                    {/* A consumable has no "vor Ort" state — offering the button
                        would offer a state the backend refuses to store. */}
                    {!item.consumable && (
                      <Button size="xs" variant={choice === "vorort" ? "selected" : "outline"} aria-pressed={choice === "vorort"} onClick={() => controller.setMaterialDecision(materialId, "vorort")}>
                        {tMat("onSiteShort")}
                      </Button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </ConfirmDialog>

      {/* «Status korrigieren?» — the backward way into «Disponiert / Anfahrt».
          Deliberately NOT the dispatch dialog: a Funkdurchsage is a statement
          that somebody is rolling right now, and an Auftrag stop must not
          collect a second Aufgebotseintrag because a status was straightened.
          «Neu disponieren …» is one click away for when it really is a new
          departure — or when the backward move was itself the misfire. */}
      <ConfirmDialog
        open={!!correction?.operation}
        onCancel={() => controller.cancelGate("statusCorrection")}
        icon={<Pencil className="h-5 w-5 text-muted-foreground" />}
        title={tCorrection("title")}
        description={correction?.operation && tCorrection.rich("description", {
          location: operationLabel(correction.operation),
          hl: (chunks) => <span className="font-medium text-foreground">{chunks}</span>,
        })}
        extraAction={{ label: tCorrection("dispatchAgain"), onSelect: controller.dispatchAfterCorrection }}
        cancelText={tCommon("cancel")}
        confirmText={tCorrection("confirm")}
        onConfirm={() => controller.closeGate("statusCorrection")}
      >
        {correction && (
          <div className="space-y-2 py-1">
            {/* The two chips are the two COLUMNS, painted from the board's
                own table (statusBadgeClass) — a status that is orange on
                the board must not be something else in a dialog about it.
                The word stays inside the chip: the colour repeats it, it
                never replaces it. */}
            <div className="flex items-center gap-2">
              <Badge className={statusBadgeClass(correction.previousStatus)}>
                {tColumns(correction.previousStatus)}
              </Badge>
              <ArrowRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
              <Badge className={statusBadgeClass("enroute")}>
                {tColumns("enroute")}
              </Badge>
            </div>
            <p className="border-t pt-2 text-sm text-muted-foreground">{tCorrection("noAnnouncement")}</p>
            <p className="text-xs text-muted-foreground">{tCorrection("dispatchHint")}</p>
          </div>
        )}
      </ConfirmDialog>

      <DisponierTransitionDialog
        open={!!controller.disponiertOperation}
        onOpenChange={(open) => !open && controller.closeDisponiert()}
        operation={controller.disponiertOperation}
        repeat={controller.disponiertRepeat}
        materials={controller.materials}
        printerEnabled={printerEnabled}
        funkrufname={funkrufname}
        diveraEnabled={diveraEnabled}
        onSendDivera={(operation) => {
          controller.closeDisponiert()
          onSendDivera(operation)
        }}
      />

      {/* Into «Reko» without a Reko person: the picker IS the gate (#4 A). Abbrechen, Esc
          and ✕ put the card back; «Zuweisen» assigns and the move stays; the quiet dashed
          row moves it without anybody. */}
      {controller.rekoAssignmentOperation && (
        <AssignRekoDialog
          open
          onOpenChange={(open) => !open && controller.cancelGate("rekoAssignment")}
          incidentId={controller.rekoAssignmentOperation.id}
          incidentTitle={operationLabel(controller.rekoAssignmentOperation)}
          gate={{
            title: tRekoGate("pickerTitle", { location: operationLabel(controller.rekoAssignmentOperation) }),
            description: tRekoGate("pickerLine"),
            confirmLabel: tCommon("assign"),
            withoutLabel: tRekoGate("moveWithout"),
            onWithout: () => controller.closeGate("rekoAssignment"),
          }}
          onAssigned={() => {
            void onRefresh()
            controller.closeGate("rekoAssignment")
          }}
        />
      )}

      {/* Into «Reko abgeschlossen» without a report: the Reko form, and the card waits for
          it (`holdStatusMove`) – so Abbrechen has nothing to undo. The relevance answer files. */}
      {controller.rekoReportOperation && (
        <RekoReportGateDialog
          operation={controller.rekoReportOperation}
          location={operationLabel(controller.rekoReportOperation)}
          onCancel={() => controller.cancelGate("rekoReport")}
          onFinish={controller.finishRekoReport}
        />
      )}
    </>
  )
}
