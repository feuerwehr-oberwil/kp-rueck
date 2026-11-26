"use client"

import { useCallback, useMemo, useRef } from "react"
import { useOperations } from "@/lib/contexts/operations-context"
import { useGroups } from "@/lib/contexts/groups-context"
import { getIncidentRefParts } from "@/lib/incident-types"
import { planNext } from "@/lib/planned-actions"
import type { Binding } from "@/components/kanban/assignment-occupancy"

/**
 * The Doppelbelegung path of `ResourceAssignmentDialog`: `askConflict` when the operator ticks
 * a resource held elsewhere, `releaseStaged` per ticked resource at «Fertig», and
 * `clearStagedMoves` when the dialog opens.
 *
 * «Jetzt verschieben» answered in the prompt, per resource id: the holders it leaves. Staged
 * like the tick – «Fertig» frees them and then assigns, closing without «Fertig» changes
 * neither side. Read only at «Fertig», so a ref.
 */
export function useStagedMoves({
  assignTarget,
  operationId,
  routeName,
}: {
  assignTarget: 'incident' | 'route'
  operationId: string | null
  routeName?: string
}) {
  const { operations, requestResourceConflict, removeCrew, removeMaterial } = useOperations()
  const { groups, unassignResource } = useGroups()
  const stagedMoves = useRef(new Map<string, Binding[]>())
  const clearStagedMoves = useCallback(() => stagedMoves.current.clear(), [])

  /** The conflict prompt's target card — where the resource is heading. */
  const targetLabel = useMemo(() => {
    if (assignTarget === 'route') return routeName ?? ''
    const op = operations.find((o) => o.id === operationId)
    return op ? getIncidentRefParts(op).head : ''
  }, [assignTarget, routeName, operations, operationId])

  /**
   * Hand the double-booking question to the ONE dialog that asks it.
   *
   * This dialog used to ask it a second time itself, with two of the three
   * answers: «Trotzdem zuweisen» or nothing, no «Verschieben». Same question,
   * same answers – «Jetzt verschieben», «Danach vormerken», Abbrechen – whichever way the
   * assignment started.
   *
   * «Jetzt verschieben» only ticks the resource; the move is staged in `stagedMoves` and
   * happens together with the assign at «Fertig» (`releaseStaged`). «Danach vormerken» plans
   * it at once and leaves it unticked – nothing is assigned now.
   */
  const askConflict = (
    resourceType: 'personnel' | 'material',
    resourceId: string,
    resourceName: string,
    bindings: Binding[],
    proceed: () => void,
  ) => {
    requestResourceConflict({
      resourceType,
      resourceId,
      resourceName,
      targetOperationId: operationId ?? '',
      targetOperationLabel: targetLabel,
      conflicts: bindings.map((b) => ({ operationId: b.id, operationLabel: b.head })),
      customResolve: async (action) => {
        if (action === 'plan') {
          stagedMoves.current.delete(resourceId)
          // operationId holds the GROUP id for a route target.
          await planNext(resourceType, resourceId, resourceName, {
            kind: assignTarget === 'route' ? 'group' : 'incident',
            id: operationId ?? '',
            label: targetLabel,
          })
          return
        }
        // A copy: `releaseStaged` drops each holder from it once it is freed.
        stagedMoves.current.set(resourceId, [...bindings])
        proceed()
      },
    })
  }

  /**
   * «Fertig» for one ticked resource: free it from the holders a staged move leaves. Resolves
   * false when a release fails (its context toasts it): the caller then skips the assign, so
   * «Jetzt verschieben» never ends as a double booking, and the holders not yet freed stay
   * staged for the next «Fertig». A holder that no longer holds it (released elsewhere since
   * the prompt; an Auftrag release the server answers 404) counts as freed – no new question.
   */
  const releaseStaged = async (resourceType: 'personnel' | 'material', resourceId: string): Promise<boolean> => {
    const bindings = stagedMoves.current.get(resourceId)
    if (!bindings) return true
    // Sequentially: two releases of the same person racing each other
    // reconcile against each other's stale snapshot.
    while (bindings.length > 0) {
      const binding = bindings[0]
      const freed =
        !stillHeld(binding, resourceType, resourceId) ||
        (binding.kind === 'incident'
          ? resourceType === 'material'
            ? await removeMaterial(binding.id, resourceId)
            : await removeCrew(binding.id, resourceId)
          : binding.assignmentId
            ? await unassignResource(binding.id, binding.assignmentId)
            : true)
      if (!freed) return false
      bindings.shift()
    }
    stagedMoves.current.delete(resourceId)
    return true
  }
  /** Whether the board still shows `binding` holding the resource. */
  const stillHeld = (binding: Binding, resourceType: 'personnel' | 'material', resourceId: string): boolean => {
    if (binding.kind === 'route') {
      return groups.some((g) => g.id === binding.id && g.assignments.some((a) => a.id === binding.assignmentId))
    }
    const op = operations.find((o) => o.id === binding.id)
    if (!op) return false
    return resourceType === 'material'
      ? op.materialAssignments.has(resourceId)
      : op.crew.some((m) => m.personnelId === resourceId)
  }

  return { askConflict, releaseStaged, clearStagedMoves }
}
