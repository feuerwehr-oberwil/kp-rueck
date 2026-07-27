"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import {
  AlertCircle,
  Binoculars,
  CheckCircle2,
  ClipboardCheck,
  Footprints,
  Package,
  Plus,
  Truck,
  Users,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { AssignRekoDialog } from "@/components/incidents/assign-reko-dialog"
import { DisponierTransitionDialog } from "@/components/kanban/disponiert-transition-dialog"
import type { Material, Operation, OperationStatus } from "@/lib/contexts/operations-context"
import type { GroupResources } from "@/lib/types/groups"
import { formatLocationForDisplay, getGlobalHomeCity } from "@/lib/utils"
import { getIncidentTypeLabel } from "@/lib/incident-types"

// Home-town-free label for dialog texts; falls back to the incident type when
// the address was only the home town (formatted location is then empty).
function operationLabel(operation: Operation): string {
  return (operation.locationDisplay ?? formatLocationForDisplay(operation.location, getGlobalHomeCity()))
    || getIncidentTypeLabel(operation.incidentType)
}

type ResourceType = "crew" | "vehicles" | "materials"

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
type AssignmentReturn = { kind: "missing" | "returning"; operationId: string }

interface UseIncidentStatusWorkflowOptions {
  operations: Operation[]
  materials: Material[]
  changeStatusToTop: (operationId: string, status: OperationStatus) => void
  getGroupResources: (groupId: string) => GroupResources
  removeMaterial: (operationId: string, materialId: string) => unknown
  unassignGroupResource: (groupId: string, assignmentId: string) => unknown
}

export function useIncidentStatusWorkflow({
  operations,
  materials,
  changeStatusToTop,
  getGroupResources,
  removeMaterial,
  unassignGroupResource,
}: UseIncidentStatusWorkflowOptions) {
  const [disponiertOperationId, setDisponiertOperationId] = useState<string | null>(null)
  const [missingResourcesOperationId, setMissingResourcesOperationId] = useState<string | null>(null)
  // Status the incident was in BEFORE dispatch — Cancel in the missing-resources
  // dialog reverts to it (the status change happens before the dialog opens).
  const [missingResourcesReturnStatus, setMissingResourcesReturnStatus] = useState<OperationStatus | null>(null)
  const [returningVehicleOperationId, setReturningVehicleOperationId] = useState<string | null>(null)
  // Same Cancel-reverts pattern for the other post-change gates: each stores
  // the status the incident was in BEFORE the change so Abbrechen can undo it.
  const [returningVehicleReturnStatus, setReturningVehicleReturnStatus] = useState<OperationStatus | null>(null)
  const [rekoMissingOperationId, setRekoMissingOperationId] = useState<string | null>(null)
  const [rekoMissingReturnStatus, setRekoMissingReturnStatus] = useState<OperationStatus | null>(null)
  const [rekoFormMissingOperationId, setRekoFormMissingOperationId] = useState<string | null>(null)
  const [rekoFormMissingReturnStatus, setRekoFormMissingReturnStatus] = useState<OperationStatus | null>(null)
  const [materialDecisionOperationId, setMaterialDecisionOperationId] = useState<string | null>(null)
  const [materialDecisionReturnStatus, setMaterialDecisionReturnStatus] = useState<OperationStatus | null>(null)
  const [rekoAssignmentOperationId, setRekoAssignmentOperationId] = useState<string | null>(null)
  const [assignmentReturn, setAssignmentReturn] = useState<AssignmentReturn | null>(null)
  const [materialDecisions, setMaterialDecisions] = useState<Record<string, "magazin" | "vorort">>({})

  const operationById = useCallback(
    (operationId: string | null) => operationId
      ? operations.find((operation) => operation.id === operationId) ?? null
      : null,
    [operations],
  )

  const getMissingResources = useCallback((operation: Operation): ResourceType[] => {
    const route = operation.groupId ? getGroupResources(operation.groupId) : null
    const missing: ResourceType[] = []
    if (operation.crew.length + (route?.personnel.length ?? 0) === 0) missing.push("crew")
    if (!operation.zuFuss && operation.vehicles.length + (route?.vehicles.length ?? 0) === 0) missing.push("vehicles")
    if (operation.materials.length + (route?.materials.length ?? 0) === 0) missing.push("materials")
    return missing
  }, [getGroupResources])

  const getResourceCoverage = useCallback((operation: Operation) => {
    const route = operation.groupId ? getGroupResources(operation.groupId) : null
    return {
      crewCount: operation.crew.length + (route?.personnel.length ?? 0),
      vehicleNames: [...operation.vehicles, ...(route?.vehicles.map((vehicle) => vehicle.name) ?? [])],
      materialCount: operation.materials.length + (route?.materials.length ?? 0),
    }
  }, [getGroupResources])

  const triggerDisponiertDialog = useCallback((operationId: string, previousStatus?: OperationStatus) => {
    const operation = operationById(operationId)
    if (!operation) return
    if (getMissingResources(operation).length > 0) {
      setMissingResourcesOperationId(operation.id)
      setMissingResourcesReturnStatus(previousStatus ?? null)
    } else {
      setDisponiertOperationId(operation.id)
    }
  }, [getMissingResources, operationById])

  const triggerReturningVehicleCheck = useCallback((operationId: string, previousStatus?: OperationStatus) => {
    const operation = operationById(operationId)
    if (!operation) return
    const routeVehicleCount = operation.groupId ? getGroupResources(operation.groupId).vehicles.length : 0
    if (!operation.zuFuss && operation.vehicles.length === 0 && routeVehicleCount === 0) {
      setReturningVehicleOperationId(operation.id)
      // The assignment round-trip re-triggers without previousStatus — keep
      // the stored return status alive instead of overwriting it with null.
      if (previousStatus) setReturningVehicleReturnStatus(previousStatus)
    } else {
      // Gate resolved (vehicle assigned / zu Fuss) — drop any stored revert.
      setReturningVehicleReturnStatus(null)
    }
  }, [getGroupResources, operationById])

  const triggerRekoCheck = useCallback((operationId: string, previousStatus?: OperationStatus) => {
    const operation = operationById(operationId)
    if (operation && !operation.assignedReko) {
      setRekoMissingOperationId(operation.id)
      setRekoMissingReturnStatus(previousStatus ?? null)
    }
  }, [operationById])

  const triggerRekoFormCheck = useCallback((operationId: string, previousStatus?: OperationStatus) => {
    const operation = operationById(operationId)
    if (operation && !operation.hasCompletedReko) {
      setRekoFormMissingOperationId(operation.id)
      setRekoFormMissingReturnStatus(previousStatus ?? null)
    }
  }, [operationById])

  const promptMaterialDecision = useCallback((operationId: string, previousStatus?: OperationStatus) => {
    const operation = operationById(operationId)
    if (!operation) return
    if (operation.groupId) {
      if (getGroupResources(operation.groupId).materials.length === 0) return
      const hasOpenSibling = operations.some((candidate) =>
        candidate.groupId === operation.groupId
        && candidate.id !== operation.id
        && candidate.status !== "complete"
        && candidate.status !== "returning",
      )
      if (!hasOpenSibling) {
        setMaterialDecisionOperationId(operation.id)
        setMaterialDecisionReturnStatus(previousStatus ?? null)
      }
      return
    }
    if (operation.materials.length > 0) {
      setMaterialDecisionOperationId(operation.id)
      setMaterialDecisionReturnStatus(previousStatus ?? null)
    }
  }, [getGroupResources, operationById, operations])

  const requestStatusChange = useCallback((operationId: string, targetStatus: OperationStatus) => {
    const operation = operationById(operationId)
    if (!operation || operation.status === targetStatus) return

    const previousStatus = operation.status
    changeStatusToTop(operationId, targetStatus)
    if (targetStatus === "enroute") triggerDisponiertDialog(operationId, previousStatus)
    if (targetStatus === "ready") triggerRekoCheck(operationId, previousStatus)
    if (targetStatus === "rekoDone") triggerRekoFormCheck(operationId, previousStatus)
    if (targetStatus === "returning") triggerReturningVehicleCheck(operationId, previousStatus)
    if (targetStatus === "complete") promptMaterialDecision(operationId, previousStatus)
  }, [changeStatusToTop, operationById, promptMaterialDecision, triggerDisponiertDialog, triggerRekoCheck, triggerRekoFormCheck, triggerReturningVehicleCheck])

  const requestCompletion = useCallback(
    (operationId: string) => requestStatusChange(operationId, "complete"),
    [requestStatusChange],
  )

  const suspendGateForAssignment = useCallback((kind: AssignmentReturn["kind"], operationId: string) => {
    setMissingResourcesOperationId(null)
    setReturningVehicleOperationId(null)
    setAssignmentReturn({ kind, operationId })
  }, [])

  const resumeGateAfterAssignment = useCallback(() => {
    if (!assignmentReturn) return
    const { kind, operationId } = assignmentReturn
    setAssignmentReturn(null)
    if (kind === "missing") setMissingResourcesOperationId(operationId)
    else triggerReturningVehicleCheck(operationId)
  }, [assignmentReturn, triggerReturningVehicleCheck])

  const cancelMissingResources = useCallback(() => {
    if (missingResourcesOperationId && missingResourcesReturnStatus) {
      changeStatusToTop(missingResourcesOperationId, missingResourcesReturnStatus)
    }
    setMissingResourcesOperationId(null)
    setMissingResourcesReturnStatus(null)
  }, [changeStatusToTop, missingResourcesOperationId, missingResourcesReturnStatus])

  const cancelReturningVehicle = useCallback(() => {
    if (returningVehicleOperationId && returningVehicleReturnStatus) {
      changeStatusToTop(returningVehicleOperationId, returningVehicleReturnStatus)
    }
    setReturningVehicleOperationId(null)
    setReturningVehicleReturnStatus(null)
  }, [changeStatusToTop, returningVehicleOperationId, returningVehicleReturnStatus])

  const cancelRekoMissing = useCallback(() => {
    if (rekoMissingOperationId && rekoMissingReturnStatus) {
      changeStatusToTop(rekoMissingOperationId, rekoMissingReturnStatus)
    }
    setRekoMissingOperationId(null)
    setRekoMissingReturnStatus(null)
  }, [changeStatusToTop, rekoMissingOperationId, rekoMissingReturnStatus])

  const cancelRekoFormMissing = useCallback(() => {
    if (rekoFormMissingOperationId && rekoFormMissingReturnStatus) {
      changeStatusToTop(rekoFormMissingOperationId, rekoFormMissingReturnStatus)
    }
    setRekoFormMissingOperationId(null)
    setRekoFormMissingReturnStatus(null)
  }, [changeStatusToTop, rekoFormMissingOperationId, rekoFormMissingReturnStatus])

  const cancelMaterialDecision = useCallback(() => {
    if (materialDecisionOperationId && materialDecisionReturnStatus) {
      changeStatusToTop(materialDecisionOperationId, materialDecisionReturnStatus)
    }
    setMaterialDecisionOperationId(null)
    setMaterialDecisionReturnStatus(null)
  }, [changeStatusToTop, materialDecisionOperationId, materialDecisionReturnStatus])

  const materialDecisionOperation = operationById(materialDecisionOperationId)
  useEffect(() => setMaterialDecisions({}), [materialDecisionOperationId])

  const materialDecisionItems = useMemo(() => {
    if (!materialDecisionOperation) return []
    return materialDecisionOperation.groupId
      ? getGroupResources(materialDecisionOperation.groupId).materials.map((material) => ({
          id: material.resourceId,
          assignmentId: material.assignmentId,
        }))
      : materialDecisionOperation.materials.map((id) => ({ id, assignmentId: null }))
  }, [getGroupResources, materialDecisionOperation])

  const resolveMaterialDecision = useCallback(() => {
    if (!materialDecisionOperation) return { returned: [] as string[], kept: [] as string[] }
    const returnedItems = materialDecisionItems.filter(
      (item) => (materialDecisions[item.id] ?? "magazin") === "magazin",
    )
    const kept = materialDecisionItems
      .filter((item) => (materialDecisions[item.id] ?? "magazin") === "vorort")
      .map((item) => item.id)

    for (const item of returnedItems) {
      if (item.assignmentId && materialDecisionOperation.groupId) {
        void unassignGroupResource(materialDecisionOperation.groupId, item.assignmentId)
      } else {
        void removeMaterial(materialDecisionOperation.id, item.id)
      }
    }
    setMaterialDecisionOperationId(null)
    setMaterialDecisionReturnStatus(null)
    return { returned: returnedItems.map((item) => item.id), kept }
  }, [materialDecisionItems, materialDecisionOperation, materialDecisions, removeMaterial, unassignGroupResource])

  const returningVehicleOperation = operationById(returningVehicleOperationId)
  const effectiveReturningVehicleOperation = returningVehicleOperation
    && !returningVehicleOperation.zuFuss
    && returningVehicleOperation.vehicles.length === 0
    && (!returningVehicleOperation.groupId || getGroupResources(returningVehicleOperation.groupId).vehicles.length === 0)
    ? returningVehicleOperation
    : null

  return {
    requestStatusChange,
    requestCompletion,
    triggerDisponiertDialog,
    triggerReturningVehicleCheck,
    triggerRekoCheck,
    triggerRekoFormCheck,
    promptMaterialDecision,
    getMissingResources,
    getResourceCoverage,
    suspendGateForAssignment,
    resumeGateAfterAssignment,
    disponiertOperation: operationById(disponiertOperationId),
    closeDisponiert: () => setDisponiertOperationId(null),
    openDisponiert: (operationId: string) => {
      setMissingResourcesOperationId(null)
      setMissingResourcesReturnStatus(null)
      setDisponiertOperationId(operationId)
    },
    missingResourcesOperation: operationById(missingResourcesOperationId),
    closeMissingResources: () => {
      setMissingResourcesOperationId(null)
      setMissingResourcesReturnStatus(null)
    },
    cancelMissingResources,
    returningVehicleOperation: effectiveReturningVehicleOperation,
    closeReturningVehicle: () => {
      setReturningVehicleOperationId(null)
      setReturningVehicleReturnStatus(null)
    },
    cancelReturningVehicle,
    rekoMissingOperation: operationById(rekoMissingOperationId),
    closeRekoMissing: () => {
      setRekoMissingOperationId(null)
      setRekoMissingReturnStatus(null)
    },
    cancelRekoMissing,
    rekoFormMissingOperation: operationById(rekoFormMissingOperationId),
    closeRekoFormMissing: () => {
      setRekoFormMissingOperationId(null)
      setRekoFormMissingReturnStatus(null)
    },
    cancelRekoFormMissing,
    materialDecisionOperation,
    closeMaterialDecision: () => {
      setMaterialDecisionOperationId(null)
      setMaterialDecisionReturnStatus(null)
    },
    cancelMaterialDecision,
    materialDecisionItems,
    materialDecisions,
    setMaterialDecision: (materialId: string, decision: "magazin" | "vorort") => {
      setMaterialDecisions((current) => ({ ...current, [materialId]: decision }))
    },
    resolveMaterialDecision,
    rekoAssignmentOperation: operationById(rekoAssignmentOperationId),
    openRekoAssignment: (operationId: string) => {
      setRekoMissingOperationId(null)
      // Assigning Reko is a "proceed" — the gate never resumes afterwards,
      // so drop the stored revert status.
      setRekoMissingReturnStatus(null)
      setRekoAssignmentOperationId(operationId)
    },
    closeRekoAssignment: () => setRekoAssignmentOperationId(null),
    materials,
  }
}

export type IncidentStatusWorkflowController = ReturnType<typeof useIncidentStatusWorkflow>

interface IncidentStatusWorkflowDialogsProps {
  controller: IncidentStatusWorkflowController
  printerEnabled: boolean
  funkrufname: string
  diveraEnabled: boolean
  onOpenAssignment: (resourceType: ResourceType, operationId: string) => void
  onOpenDetail: (operationId: string) => void
  onSendDivera: (operation: Operation) => void
  onRefresh: () => void | Promise<void>
}

export function IncidentStatusWorkflowDialogs({
  controller,
  printerEnabled,
  funkrufname,
  diveraEnabled,
  onOpenAssignment,
  onOpenDetail,
  onSendDivera,
  onRefresh,
}: IncidentStatusWorkflowDialogsProps) {
  const tCommon = useTranslations("kanban.common")
  const tDash = useTranslations("kanban.dashboard")
  const tRes = useTranslations("kanban.resources")
  const tMissing = useTranslations("kanban.missingResources")
  const tReturning = useTranslations("kanban.returningVehicle")
  const tReko = useTranslations("kanban.rekoMissing")
  const tRekoForm = useTranslations("kanban.rekoFormMissing")
  const tMat = useTranslations("kanban.materialDecision")

  const openAssignment = (resourceType: ResourceType, operationId: string, kind: AssignmentReturn["kind"]) => {
    controller.suspendGateForAssignment(kind, operationId)
    onOpenAssignment(resourceType, operationId)
  }

  const missingOperation = controller.missingResourcesOperation
  const missing = missingOperation ? controller.getMissingResources(missingOperation) : []
  const allFilled = missing.length === 0
  // The checklist still LISTS everything that is missing; only these hold the dispatch back.
  const blocking = missing.some((resource) => BLOCKING_RESOURCES.includes(resource))
  const missingTitleKey = allFilled
    ? "readyTitle"
    : missing.length === 1
      ? missing[0] === "crew"
        ? "titleCrewOnly"
        : missing[0] === "vehicles"
          ? "titleVehiclesOnly"
          : "titleMaterialsOnly"
      : "title"

  return (
    <>
      <AlertDialog open={!!missingOperation} onOpenChange={(open) => !open && controller.closeMissingResources()}>
        <AlertDialogContent>
          {missingOperation && (() => {
            const coverage = controller.getResourceCoverage(missingOperation)
            const rows = [
              {
                key: "crew" as const,
                icon: Users,
                filled: !missing.includes("crew"),
                summary: tMissing("personalSummary", { count: coverage.crewCount }),
              },
              {
                key: "vehicles" as const,
                icon: Truck,
                filled: !missing.includes("vehicles"),
                summary: missingOperation.zuFuss ? tCommon("zuFuss") : coverage.vehicleNames.join(", "),
              },
              {
                key: "materials" as const,
                icon: Package,
                filled: !missing.includes("materials"),
                summary: tMissing("mittelSummary", { count: coverage.materialCount }),
              },
            ]
            return (
              <>
                <AlertDialogHeader>
                  <AlertDialogTitle className="flex items-center gap-2">
                    {allFilled
                      ? <CheckCircle2 className="h-5 w-5 text-success" />
                      : <Package className="h-5 w-5 text-primary" />}
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
                  {rows.map(({ key, icon: Icon, filled, summary }) => (
                    <button
                      key={key}
                      onClick={() => openAssignment(key, missingOperation.id, "missing")}
                      className="flex w-full cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors hover:border-primary/40 hover:bg-secondary/40"
                    >
                      {filled
                        ? <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-success" />
                        : <AlertCircle className="h-4 w-4 flex-shrink-0 text-warning" />}
                      <Icon className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium">{tRes(key)}</div>
                        {filled && summary && <div className="truncate text-xs text-muted-foreground" title={summary}>{summary}</div>}
                      </div>
                      {filled ? (
                        <span className="flex flex-shrink-0 items-center gap-1 text-xs text-muted-foreground">
                          <Plus className="h-3.5 w-3.5" />
                          {tMissing("addMore")}
                        </span>
                      ) : (
                        <span className="flex-shrink-0 rounded-md bg-secondary px-2 py-1 text-xs font-medium">
                          {tCommon("assign")}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
                {/* «Trotzdem disponieren» is the override for a REAL gate, so it only appears
                    while one is closed. With just material outstanding the primary button is
                    live and says «Fertig» — no override needed for the ordinary case. */}
                <AlertDialogFooter className={blocking ? "sm:justify-between" : undefined}>
                  {blocking && (
                    <Button variant="ghost" onClick={() => controller.openDisponiert(missingOperation.id)}>
                      {tMissing("dispatchAnyway")}
                    </Button>
                  )}
                  <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                    <Button variant="outline" onClick={() => controller.cancelMissingResources()}>
                      {tCommon("cancel")}
                    </Button>
                    <Button disabled={blocking} onClick={() => controller.openDisponiert(missingOperation.id)}>
                      {tMissing("done")}
                    </Button>
                  </div>
                </AlertDialogFooter>
              </>
            )
          })()}
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!controller.returningVehicleOperation} onOpenChange={(open) => !open && controller.closeReturningVehicle()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Footprints className="h-5 w-5 text-warning" />
              {tReturning("title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {controller.returningVehicleOperation && tReturning.rich("description", {
                location: operationLabel(controller.returningVehicleOperation),
                hl: (chunks) => <span className="font-medium text-foreground">{chunks}</span>,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="sm:justify-between">
            <Button variant="ghost" onClick={controller.closeReturningVehicle}>{tReturning("endAnyway")}</Button>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="outline" onClick={controller.cancelReturningVehicle}>
                {tCommon("cancel")}
              </Button>
              <Button onClick={() => {
                const operation = controller.returningVehicleOperation
                if (operation) openAssignment("vehicles", operation.id, "returning")
              }}>
                {tReturning("assignVehicle")}
              </Button>
            </div>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!controller.rekoMissingOperation} onOpenChange={(open) => !open && controller.closeRekoMissing()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Binoculars className="h-5 w-5 text-primary" />
              {tCommon("noRekoAssigned")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {controller.rekoMissingOperation && tReko.rich("description", {
                location: operationLabel(controller.rekoMissingOperation),
                hl: (chunks) => <span className="font-medium text-foreground">{chunks}</span>,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="sm:justify-between">
            <Button variant="ghost" onClick={controller.closeRekoMissing}>{tReko("proceedAnyway")}</Button>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="outline" onClick={controller.cancelRekoMissing}>
                {tCommon("cancel")}
              </Button>
              <Button onClick={() => {
                const operation = controller.rekoMissingOperation
                if (operation) controller.openRekoAssignment(operation.id)
              }}>
                {tReko("assignReko")}
              </Button>
            </div>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!controller.rekoFormMissingOperation} onOpenChange={(open) => !open && controller.closeRekoFormMissing()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <ClipboardCheck className="h-5 w-5 text-primary" />
              {tRekoForm("title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {controller.rekoFormMissingOperation && tRekoForm.rich("description", {
                location: operationLabel(controller.rekoFormMissingOperation),
                hl: (chunks) => <span className="font-medium text-foreground">{chunks}</span>,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="sm:justify-between">
            <Button variant="ghost" onClick={controller.closeRekoFormMissing}>{tRekoForm("proceedAnyway")}</Button>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="outline" onClick={controller.cancelRekoFormMissing}>
                {tCommon("cancel")}
              </Button>
              <Button onClick={() => {
                const operation = controller.rekoFormMissingOperation
                // closeRekoFormMissing also drops the revert status — opening
                // the Reko details is a "proceed", not a cancel.
                controller.closeRekoFormMissing()
                if (operation) onOpenDetail(operation.id)
              }}>
                {tRekoForm("openReko")}
              </Button>
            </div>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!controller.materialDecisionOperation} onOpenChange={(open) => !open && controller.closeMaterialDecision()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Package className="h-5 w-5 text-primary" />
              {tMat("title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {controller.materialDecisionOperation && tMat.rich("description", {
                location: operationLabel(controller.materialDecisionOperation),
                hl: (chunks) => <span className="font-medium text-foreground">{chunks}</span>,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {controller.materialDecisionOperation && (
            <div className="max-h-64 space-y-1.5 overflow-y-auto py-1">
              {controller.materialDecisionItems.map(({ id: materialId }) => {
                const choice = controller.materialDecisions[materialId] ?? "magazin"
                const name = controller.materials.find((material) => material.id === materialId)?.name ?? materialId
                return (
                  <div key={materialId} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium" title={name}>{name}</span>
                    <div className="flex flex-shrink-0 gap-1">
                      <Button size="sm" variant={choice === "magazin" ? "default" : "outline"} className="h-7 px-2 text-xs" onClick={() => controller.setMaterialDecision(materialId, "magazin")}>
                        {tMat("toMagazinShort")}
                      </Button>
                      <Button size="sm" variant={choice === "vorort" ? "default" : "outline"} className="h-7 px-2 text-xs" onClick={() => controller.setMaterialDecision(materialId, "vorort")}>
                        {tMat("onSiteShort")}
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          <AlertDialogFooter>
            <Button variant="outline" onClick={controller.cancelMaterialDecision}>{tMat("cancel")}</Button>
            <Button onClick={() => {
              const { returned, kept } = controller.resolveMaterialDecision()
              const nameOf = (id: string) => controller.materials.find((material) => material.id === id)?.name ?? id
              const description = [
                returned.length ? `${tMat("toastToMagazin")}: ${returned.map(nameOf).join(", ")}` : null,
                kept.length ? `${tMat("toastOnSite")}: ${kept.map(nameOf).join(", ")}` : null,
              ].filter(Boolean).join(" · ")
              toast.success(returned.length ? tDash("materialReturned") : tMat("leftOnSite"), { description })
            }}>
              {tMat("confirm")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <DisponierTransitionDialog
        open={!!controller.disponiertOperation}
        onOpenChange={(open) => !open && controller.closeDisponiert()}
        operation={controller.disponiertOperation}
        materials={controller.materials}
        printerEnabled={printerEnabled}
        funkrufname={funkrufname}
        diveraEnabled={diveraEnabled}
        onSendDivera={(operation) => {
          controller.closeDisponiert()
          onSendDivera(operation)
        }}
      />

      {controller.rekoAssignmentOperation && (
        <AssignRekoDialog
          open
          onOpenChange={(open) => !open && controller.closeRekoAssignment()}
          incidentId={controller.rekoAssignmentOperation.id}
          incidentTitle={operationLabel(controller.rekoAssignmentOperation)}
          onAssigned={() => {
            void onRefresh()
            controller.closeRekoAssignment()
          }}
        />
      )}
    </>
  )
}
