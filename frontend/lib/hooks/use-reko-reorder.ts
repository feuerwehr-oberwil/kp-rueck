"use client"

/**
 * `useRekoReorder()` – the Reko-Editor drag: put one Reko person's open Rekos in a new order.
 *
 * Returns `reorder(personId, nextOpenIds)`. It shows the new numbers at once (each operation's
 * `rekoPosition`), then sends the person's WHOLE list (`mergeOpenOrder`, `lib/reko-order.ts`)
 * with the set it was made from as `expected_ids`. A 409 – somebody added, released or handed
 * over one of their Rekos meanwhile – says so and reloads the board; nothing is resent. Drags of
 * one person go out one at a time (`KeyedSerialQueue`), so the server sees them in order.
 */

import { useCallback, useRef } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { ApiError, apiClient } from "@/lib/api-client"
import { useEvent } from "@/lib/contexts/event-context"
import { useOperations } from "@/lib/contexts/operations-context"
import { isOpenReko, mergeOpenOrder, rekosOf } from "@/lib/reko-order"
import { KeyedSerialQueue } from "@/lib/update-batcher"

export function useRekoReorder() {
  const t = useTranslations("map.rekoMode")
  const { selectedEvent } = useEvent()
  const { operations, setOperations, refreshOperations } = useOperations()
  const queue = useRef(new KeyedSerialQueue())

  return useCallback(
    async (personId: string, nextOpenIds: string[]): Promise<void> => {
      if (!selectedEvent) return
      const all = rekosOf(operations, personId)
      const allIds = all.map((op) => op.id)
      const next = mergeOpenOrder(allIds, all.filter(isOpenReko).map((op) => op.id), nextOpenIds)
      if (!next) return

      const position = new Map(next.map((id, index) => [id, index]))
      setOperations((ops) =>
        ops.map((op) =>
          op.assignedReko?.id === personId && position.has(op.id) ? { ...op, rekoPosition: position.get(op.id) } : op,
        ),
      )
      try {
        await queue.current.run(personId, () =>
          apiClient.reorderRekoAssignments(personId, selectedEvent.id, next, allIds),
        )
      } catch (error) {
        if (ApiError.isConflictError(error)) {
          toast.error(t("orderChangedTitle"), { description: t("orderChangedDescription") })
        } else {
          console.error("Failed to reorder Rekos:", error)
          toast.error(t("orderFailedTitle"), { description: t("orderFailedDescription") })
        }
        await refreshOperations()
      }
    },
    [selectedEvent, operations, setOperations, refreshOperations, t],
  )
}
