"use client"

import { useCallback } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { apiClient } from "@/lib/api-client"
import type { ApiFieldReportUpdate } from "@/lib/api/types"
import { useOperations } from "@/lib/contexts/operations-context"

/**
 * The KP's two settable Funkmeldungen, written once for every surface that sets them: the
 * switches on the Reko and Feld tabs (`FieldReportsRow`) and the card's right-click menu
 * (owner pick 4A, 24.11.2026). Each write reloads the board and toasts on failure; it
 * resolves true when the server took it.
 *
 * - `saveRekoArrived(id, at)`: «Reko vor Ort» – `undefined` = now, `null` = clear, or an ISO time.
 * - `saveFieldReport(id, update)`: «Abholung nötig» (`pickup_needed`, `pickup_note`, time).
 */
export function useFieldReportWrites() {
  const t = useTranslations("feld.kp")
  const { refreshOperations } = useOperations()

  const run = useCallback(
    async (write: () => Promise<unknown>, what: string): Promise<boolean> => {
      try {
        await write()
        await refreshOperations()
        return true
      } catch (error) {
        console.error(`Failed to save ${what}:`, error)
        toast.error(t("saveFailed"))
        return false
      }
    },
    [refreshOperations, t],
  )

  const saveRekoArrived = useCallback(
    (incidentId: string, at: string | null | undefined) =>
      run(() => apiClient.setRekoArrived(incidentId, at), "reko arrival"),
    [run],
  )
  const saveFieldReport = useCallback(
    (incidentId: string, update: ApiFieldReportUpdate) =>
      run(() => apiClient.setIncidentFieldReport(incidentId, update), "field report"),
    [run],
  )
  return { saveRekoArrived, saveFieldReport }
}
