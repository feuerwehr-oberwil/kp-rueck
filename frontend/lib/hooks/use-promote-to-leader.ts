"use client"

import { useCallback } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { apiClient } from "@/lib/api-client"
import { useOperations, type Operation } from "@/lib/contexts/operations-context"

/**
 * Promote a crew member to Einsatzleiter on a stand-alone incident.
 *
 * The backend demotes the previous holder in the same transaction, so this is
 * set-and-move in one call; the board only has to re-read who holds it
 * afterwards. Not optimistic, and no undo: the role moves between two people,
 * and a second «Als Einsatzleiter markieren» on the old holder is the way back.
 *
 * One hook because two surfaces offer it — the detail's EL stub and chip menu,
 * and (since 2026-09-23) the card's touch chip menu — and they must not drift
 * apart on what a failure says. A stop inside an Auftrag takes its leader from
 * the route (`updateGroupAssignment`), which is not this.
 */
export function usePromoteToLeader(operation: Pick<Operation, "id" | "crew">) {
  const t = useTranslations("kanban")
  const { operations, refreshOperations } = useOperations()
  const { id } = operation

  return useCallback(
    async (personnelId: string) => {
      // ⚠️ The board's copy first, the caller's as the fallback: a person added
      // optimistically gets the assignment id only once the POST answered, and
      // a memoised caller can still hold the copy from before.
      const live = operations?.find((op) => op.id === id)
      const assignmentId = (live ?? operation).crew.find((m) => m.personnelId === personnelId)?.assignmentId
      // No assignment id yet (the assign is still in flight) — nothing to patch.
      if (!assignmentId) return
      try {
        await apiClient.updateAssignment(id, assignmentId, { is_leader: true })
        await refreshOperations()
      } catch {
        toast.error(t("detail.leaderFailed"))
      }
    },
    [id, operation, operations, refreshOperations, t],
  )
}
