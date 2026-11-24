"use client"

import { useCallback } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { apiClient, ApiError } from "@/lib/api-client"
import { useOperations } from "@/lib/contexts/operations-context"
import { undoToast } from "@/lib/toast-undo"

/** One unit left on site, as the «Gerät vor Ort» roll-up names it. */
export interface CollectTarget {
  incidentId: string
  assignmentId: string
  name: string
}

/**
 * «Abgeholt – freigeben» (owner pick 6A, 24.11.2026): releases exactly this unit's
 * assignment, records «Abgeholt» in the Verlauf and the Chronik (the server writes both), and
 * offers «Rückgängig». The undo re-opens the SAME assignment on the server (the rapport's «vor
 * Ort verblieben» points at it) – only this release, named by the time the server answered,
 * and refused when the unit is archived or on another Einsatz or Auftrag by now. Resolves true
 * when the release went through.
 */
export function useCollectMaterial() {
  const t = useTranslations("kanban.dashboard.materialOnSite")
  const { refreshOperations } = useOperations()

  return useCallback(
    async ({ incidentId, assignmentId, name }: CollectTarget): Promise<boolean> => {
      const collected = await apiClient.collectMaterial(incidentId, assignmentId).catch((error: unknown) => {
        toast.error(t("collectFailed", { name }), { description: error instanceof ApiError ? error.message : undefined })
        return null
      })
      await refreshOperations()
      if (!collected) return false
      undoToast(t("collectedToast", { name }), {
        key: `collected:${assignmentId}`,
        onUndo: async () => {
          try {
            await apiClient.undoCollectMaterial(incidentId, assignmentId, collected.released_at)
          } catch (error) {
            toast.error(t("undoFailed", { name }), { description: error instanceof ApiError ? error.message : undefined })
          }
          await refreshOperations()
        },
      })
      return true
    },
    [refreshOperations, t],
  )
}
