"use client"

import { useCallback } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { apiClient } from "@/lib/api-client"
import { useOperations, type Operation } from "@/lib/contexts/operations-context"

/**
 * Toggle a vehicle's «bleibt vor Ort» / «kehrt zurück» flag on an incident.
 *
 * The flag is not decoration: it is read out in the Funkdurchsage, printed on
 * the assignment slip and shown on the board, and it exists from the moment a
 * vehicle is assigned (defaulting to «zurück»). So every surface that assigns a
 * vehicle has to be able to set it — this used to live inline in three places
 * and was missing from the fourth, the assignment dialog, which is exactly the
 * surface a whole dispatch can be done through.
 *
 * Optimistic: the chip flips at once and reverts with a toast if the write
 * fails. The server broadcasts a dedicated «driver_stay» action, and re-applying
 * our own value is idempotent, so there is no flicker.
 */
export function useToggleDriverStay() {
  const { operations, setOperations } = useOperations()
  const t = useTranslations("kanban.common")

  return useCallback(
    (operationId: string, vehicleName: string) => {
      const operation = operations.find((op) => op.id === operationId)
      if (!operation) return
      const assignmentId = operation.vehicleAssignments.get(vehicleName)
      // No assignment id yet (the assign is still in flight) — nothing to patch.
      if (!assignmentId) return

      const previous = operation.vehicleDriverStay?.get(vehicleName) || false
      const applyStay = (value: boolean) =>
        setOperations((ops: Operation[]) =>
          ops.map((op) => {
            if (op.id !== operationId) return op
            const next = new Map(op.vehicleDriverStay)
            next.set(vehicleName, value)
            return { ...op, vehicleDriverStay: next }
          }),
        )

      applyStay(!previous)
      apiClient.updateAssignment(operationId, assignmentId, { driver_stay: !previous }).catch(() => {
        toast.error(t("updateFailed"))
        applyStay(previous)
      })
    },
    [operations, setOperations, t],
  )
}
