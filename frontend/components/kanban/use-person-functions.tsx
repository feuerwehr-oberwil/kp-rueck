"use client"

/**
 * usePersonFunctions — a person's functions (Fahrer per vehicle, Reko, Magazin, Telefondienst,
 * Kommandoposten) and the one way to toggle them, for the right-click menu
 * (`person-context-menu.tsx`) and the person popover (`components/board/person-popover.tsx`).
 *
 * `items` comes from `personFunctionItems` (lib/person-functions.ts). `toggle(item)` takes a free
 * function (asking first when the person is on an Einsatz – every function but Reko takes them
 * off it) or ends a held one (always asking: the person drops out of Reko views / driver duty).
 * Render `dialogs` once beside the surface that calls `toggle`.
 *
 * `enabled` gates the live driver map (one fetch + socket while a menu or popover is open).
 */

import { useMemo, useState, type ReactNode } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { TransferRekoDialog } from "@/components/kanban/transfer-reko-dialog"
import { usePersonNaming } from "@/components/person-name"
import { stationFunctionLabel } from "@/components/kanban/person-function-labels"
import { ApiError, apiClient, type FunctionType } from "@/lib/api-client"
import { useEvent } from "@/lib/contexts/event-context"
import { useOperations } from "@/lib/contexts/operations-context"
import { getIncidentRefLabel } from "@/lib/incident-types"
import { useVehicleDrivers } from "@/lib/hooks/use-vehicle-drivers"
import { personFunctionItems, type PersonFunctionItem } from "@/lib/person-functions"

type Target = { functionType: FunctionType; vehicleId?: string; vehicleName?: string }

export function usePersonFunctions({
  personnelId,
  personnelName,
  enabled,
}: {
  personnelId: string
  personnelName: string
  enabled: boolean
}): { items: PersonFunctionItem[]; toggle: (item: PersonFunctionItem) => void; busy: boolean; dialogs: ReactNode } {
  const t = useTranslations("kanban")
  const { selectedEvent } = useEvent()
  const { operations, personnel, removeCrew, refreshOperations, vehicles: fleet } = useOperations()
  // «Meier Alex · 1985» when the name is not unique — the dialogs say who.
  const personLabel = usePersonNaming().inline({ name: personnelName, personnelId })
  const drivers = useVehicleDrivers(selectedEvent?.id, enabled)
  const thisPerson = personnel.find((p) => p.id === personnelId) ?? null

  // The fleet in board order, off the board sync – no fetch when the menu opens.
  const vehicles = useMemo(
    () => [...fleet].sort((a, b) => a.display_order - b.display_order).map((v) => ({ id: v.id, name: v.name })),
    [fleet],
  )
  const items = useMemo(
    () => (thisPerson ? personFunctionItems(thisPerson, vehicles, drivers) : []),
    [thisPerson, vehicles, drivers],
  )

  const [busy, setBusy] = useState(false)
  // Taking a function while on an Einsatz: release from it first?
  const [conflict, setConflict] = useState<(Target & { operations: Array<{ id: string; location: string }> }) | null>(null)
  // Ending a held function.
  const [unassign, setUnassign] = useState<Target | null>(null)
  // Reko hand-over: how much would be orphaned by dropping the role, and who could take it over.
  const [transferOpen, setTransferOpen] = useState(false)
  const rekoIncidentCount = operations.filter((op) => op.assignedReko?.id === personnelId).length
  const rekoPersonnel = personnel.filter((p) => p.isReko && p.id !== personnelId)

  const functionLabel = (functionType: FunctionType) =>
    functionType === "driver" ? t("personMenu.driver") : stationFunctionLabel(t, functionType)

  const doAssign = async ({ functionType, vehicleId }: Target) => {
    if (!selectedEvent || busy) return
    setBusy(true)
    try {
      await apiClient.assignSpecialFunction(selectedEvent.id, {
        personnel_id: personnelId,
        function_type: functionType,
        vehicle_id: vehicleId || null,
      })
      void refreshOperations()
    } catch (error) {
      console.error("Failed to assign function:", error)
      // apiClient rejects with ApiError, whose message is the backend's sentence in this locale.
      const detail = error instanceof Error ? error.message : ""
      if (error instanceof ApiError && error.code === "vehicle_has_driver") {
        toast.error(t("personMenu.vehicleTaken"), { description: t("personMenu.vehicleTakenDescription") })
      } else {
        toast.error(t("common.error"), { description: detail || t("personMenu.assignFailed") })
      }
    } finally {
      setBusy(false)
    }
  }

  const doUnassign = async ({ functionType, vehicleId }: Target) => {
    if (!selectedEvent || busy) return
    setBusy(true)
    try {
      await apiClient.unassignSpecialFunction(selectedEvent.id, {
        personnel_id: personnelId,
        function_type: functionType,
        vehicle_id: vehicleId || null,
      })
      void refreshOperations()
    } catch (error) {
      console.error("Failed to unassign function:", error)
      toast.error(t("common.error"), { description: t("personMenu.unassignFailed") })
    } finally {
      setBusy(false)
    }
  }

  const toggle = (item: PersonFunctionItem) => {
    if (!selectedEvent || busy) return
    const target: Target =
      item.kind === "driver"
        ? { functionType: "driver", vehicleId: item.vehicleId, vehicleName: item.vehicleName }
        : { functionType: item.functionType }
    if (item.held) {
      setUnassign(target)
      return
    }
    // Every role but Reko takes the person off the board's available list
    // (`operations-context.tsx` counts them as assigned), so putting somebody on
    // the phone desk while they are dispatched to a Schadenplatz is the same
    // conflict as making them a driver — and the KP should be asked, not
    // surprised. Reko stays out: a Reko trupp IS out on a Schadenplatz.
    if (target.functionType !== "reko") {
      const onIncidents = operations
        .filter((op) => op.crew.some((m) => m.personnelId === personnelId))
        .map((op) => ({ id: op.id, location: getIncidentRefLabel(op, 40) }))
      if (onIncidents.length > 0) {
        setConflict({ ...target, operations: onIncidents })
        return
      }
    }
    void doAssign(target)
  }

  const confirmConflict = async () => {
    if (!conflict) return
    // Release from every Einsatz first and wait for it: a failed release has rolled
    // back and toasted, and the function must not land on top of a double booking.
    const released = await Promise.all(conflict.operations.map((op) => removeCrew(op.id, personnelId)))
    if (released.every(Boolean)) await doAssign(conflict)
  }

  const unassignType = unassign?.functionType ?? "driver"
  const dialogs = (
    <>
      <ConfirmDialog
        open={!!conflict}
        onOpenChange={(open) => !open && setConflict(null)}
        title={t("personMenu.conflictTitle", { name: personLabel })}
        description={t.rich("personMenu.conflictDescription", {
          strong: (chunks) => <strong>{chunks}</strong>,
          name: personLabel,
          assignment:
            conflict?.operations.length === 1
              ? t("personMenu.conflictAssignedOne", { location: conflict.operations[0].location })
              : t("personMenu.conflictAssignedMany", { count: conflict?.operations.length ?? 0 }),
          function: functionLabel(conflict?.functionType ?? "driver"),
        })}
        cancelText={t("common.cancel")}
        confirmText={t("personMenu.confirmAction")}
        // A double booking is chosen by hand, never by Enter (owner pick #3, 23.11.2026).
        initialFocus="cancel"
        onConfirm={confirmConflict}
      />

      <ConfirmDialog
        open={!!unassign}
        onOpenChange={(open) => !open && setUnassign(null)}
        title={t("personMenu.unassignTitle", { function: functionLabel(unassignType) })}
        description={
          unassignType === "reko"
            ? t.rich("personMenu.unassignRekoDescription", { strong: (chunks) => <strong>{chunks}</strong>, name: personLabel })
            : unassignType === "driver"
              ? t.rich("personMenu.unassignDriverDescription", {
                  strong: (chunks) => <strong>{chunks}</strong>,
                  name: personLabel,
                  vehicle: unassign?.vehicleName ?? "",
                })
              : t.rich("personMenu.unassignMagazinDescription", { strong: (chunks) => <strong>{chunks}</strong>, name: personLabel })
        }
        cancelText={t("common.cancel")}
        confirmText={t("personMenu.unassignConfirm")}
        onConfirm={() => (unassign ? doUnassign(unassign) : undefined)}
        // Removing the Reko role from someone who still holds incidents used to
        // just orphan them — the incidents kept a Reko that no longer existed,
        // and nothing said so. Offer the hand-over first; releasing outright
        // stays available as the secondary action.
        extraAction={
          unassignType === "reko" && rekoIncidentCount > 0
            ? {
                label: t("personMenu.unassignRekoTransfer", { count: rekoIncidentCount }),
                onSelect: () => {
                  setUnassign(null)
                  setTransferOpen(true)
                },
              }
            : undefined
        }
      />

      {/* Hand the incidents to another Reko, then drop the role. */}
      <TransferRekoDialog
        open={transferOpen}
        onOpenChange={setTransferOpen}
        fromPerson={thisPerson}
        rekoPersonnel={rekoPersonnel}
        // The incidents have a new Reko; this person's role can now go without leaving anything behind.
        onTransferred={() => void doUnassign({ functionType: "reko" })}
      />
    </>
  )

  return { items, toggle, busy, dialogs }
}
