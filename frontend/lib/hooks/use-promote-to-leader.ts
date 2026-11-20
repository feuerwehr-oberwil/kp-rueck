"use client"

import { useCallback } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { apiClient } from "@/lib/api-client"
import { useGroups } from "@/lib/contexts/groups-context"
import { useOperations, type Operation } from "@/lib/contexts/operations-context"

/**
 * Promote a crew member to Einsatzleiter on a stand-alone incident:
 * `promote(operation, personnelId)`.
 *
 * The backend demotes the previous holder in the same transaction, so this is
 * set-and-move in one call; the board only has to re-read who holds it
 * afterwards. Not optimistic, and no undo: the role moves between two people,
 * and a second «Als Einsatzleiter markieren» on the old holder is the way back.
 *
 * One hook because several surfaces offer it — the detail's EL stub and chip
 * menu, the card's touch chip menu, and the dispatch gate's crew chips — and
 * they must not drift apart on what a failure says. A stop inside an Auftrag
 * takes its leader from the route: that is `usePromoteRouteLeader`.
 */
export function usePromoteToLeader() {
  const t = useTranslations("kanban")
  const { operations, refreshOperations } = useOperations()

  return useCallback(
    async (operation: Pick<Operation, "id" | "crew">, personnelId: string) => {
      // ⚠️ The board's copy first, the caller's as the fallback: a person added
      // optimistically gets the assignment id only once the POST answered, and
      // a memoised caller can still hold the copy from before.
      const live = operations?.find((op) => op.id === operation.id)
      const assignmentId = (live ?? operation).crew.find((m) => m.personnelId === personnelId)?.assignmentId
      // No assignment id yet (the assign is still in flight) — nothing to patch.
      if (!assignmentId) return
      try {
        await apiClient.updateAssignment(operation.id, assignmentId, { is_leader: true })
        await refreshOperations()
      } catch {
        toast.error(t("detail.leaderFailed"))
      }
    },
    [operations, refreshOperations, t],
  )
}

/**
 * Promote one of an Auftrag's crew to the route's Einsatzleiter:
 * `promote(groupId, assignmentId)`. The route-level twin of `usePromoteToLeader`
 * (same failure toast) – the Aufträge sheet, the detail's route block and the
 * dispatch gate.
 */
export function usePromoteRouteLeader() {
  const t = useTranslations("kanban")
  const { refreshGroups } = useGroups()

  return useCallback(
    async (groupId: string, assignmentId: string) => {
      try {
        await apiClient.updateGroupAssignment(groupId, assignmentId, { is_leader: true })
        await refreshGroups()
      } catch {
        toast.error(t("detail.leaderFailed"))
      }
    },
    [refreshGroups, t],
  )
}
