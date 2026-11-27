"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { apiClient } from "@/lib/api-client"
import type { Material, Operation, OperationStatus } from "@/lib/contexts/operations-context"
import type { IncidentGroup } from "@/lib/types/groups"
import { findAuftragForStop } from "@/lib/kanban-utils"

interface UseCompletionMaterialOptions {
  /** The completion gate's card (`gate.operationId`), and the card itself once the store has it. */
  materialDecisionOperationId: string | null
  materialDecisionOperation: Operation | null
  /** The completion waits for «Abschliessen» (`holdStatusMove`): resolving makes the move. */
  held: boolean
  /** The Auftrag runs on after this stop (`completionContinuation`): no material question. */
  midRoute: boolean
  groups: IncidentGroup[]
  materials: Material[]
  changeStatusToTop: (operationId: string, status: OperationStatus, extraUpdates?: Partial<Operation>) => void
  removeMaterial: (operationId: string, materialId: string) => unknown
  unassignGroupResource: (groupId: string, assignmentId: string) => unknown
  /** Close the completion gate once its answers are written. */
  onResolved: () => void
}

/**
 * The completion gate's material question: «Vor Ort oder ins Magazin?» per unit, prefilled from
 * the Schadenplatz-Rapport. Used by `useIncidentStatusWorkflow`, which spreads the result into
 * its controller.
 */
export function useCompletionMaterial({
  materialDecisionOperationId,
  materialDecisionOperation,
  held,
  midRoute,
  groups,
  materials,
  changeStatusToTop,
  removeMaterial,
  unassignGroupResource,
  onResolved,
}: UseCompletionMaterialOptions) {
  const [materialDecisions, setMaterialDecisions] = useState<Record<string, "magazin" | "vorort">>({})
  // What the Schadenplatz-Rapport already answered, per material id, plus who
  // answered it. The crew ticked "vor Ort verblieben" unit by unit at the
  // scene; asking the same question again at completion is asking somebody who
  // was not there to overrule somebody who was.
  const [materialAnswers, setMaterialAnswers] = useState<Record<string, "magazin" | "vorort">>({})
  const [materialRapportBy, setMaterialRapportBy] = useState<string | null>(null)
  // Was that rapport filed, or is it still a draft the crew never submitted?
  // The gate reads both (§18.23) and must say which it is reading.
  const [materialRapportIsDraft, setMaterialRapportIsDraft] = useState(false)
  // The rapport answers are on their way: «Abschliessen» waits («Rapport wird geladen …»).
  const [materialAnswersLoading, setMaterialAnswersLoading] = useState(false)

  // Prefill the gate from a submitted rapport instead of asking from scratch.
  // The fetch lives here rather than in `promptMaterialDecision` so the trigger
  // stays synchronous — the gate must open the instant the card moves, and the
  // crew's answers land in it a moment later rather than delaying it.
  useEffect(() => {
    setMaterialDecisions({})
    setMaterialAnswers({})
    setMaterialRapportBy(null)
    setMaterialRapportIsDraft(false)
    setMaterialAnswersLoading(false)
    if (!materialDecisionOperationId) return

    let cancelled = false
    setMaterialAnswersLoading(true)
    void (async () => {
      try {
        // `includeDraft` (§18.23): a crew that filled the checklist and never
        // pressed *Rapport abschliessen* on a phone in the rain has answered
        // the question anyway, and asking the operator from scratch is exactly
        // the complaint. Nothing is auto-applied — the operator still confirms,
        // which is what makes reading a draft safe here. The release list in
        // the incident detail does NOT pass it: its click releases assignments.
        const data = await apiClient.getRapportMaterialReturn(materialDecisionOperationId, { includeDraft: true })
        if (cancelled) return
        const answers: Record<string, "magazin" | "vorort"> = {}
        // `returned` also carries the units nobody answered — those are still
        // open questions and must stay unmarked, or the gate would claim the
        // crew said "Magazin" about a unit it never looked at.
        for (const unit of data.returned) {
          if (unit.answered && unit.material_id) answers[unit.material_id] = "magazin"
        }
        // `left_on_site` needs no `answered` check: saying where a unit stays
        // IS the answer. `used: null` next to `left_on_site: true` is the crew
        // answering one question and not the other, not an untouched row.
        for (const unit of data.left_on_site) {
          if (unit.material_id) answers[unit.material_id] = "vorort"
        }
        setMaterialAnswers(answers)
        const hasAnswers = Object.keys(answers).length > 0
        setMaterialRapportBy(hasAnswers ? data.rapport_by : null)
        setMaterialRapportIsDraft(hasAnswers && data.rapport_is_draft)
      } catch (error) {
        // A gate that fails open is right here: no prefill, ask everything, the
        // way it worked before the rapport existed.
        console.error("Failed to load rapport material answers:", error)
      } finally {
        if (!cancelled) setMaterialAnswersLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [materialDecisionOperationId])

  const materialDecisionItems = useMemo(() => {
    if (!materialDecisionOperation) return []
    // Mid-route there is nothing to decide — see `asksAboutMaterial`. Empty
    // here is what makes that true rather than merely written down:
    // `resolveMaterialDecision` iterates this list, so an empty one returns
    // and unassigns nothing, and the route's Geräte stay on the route.
    if (midRoute) return []
    // A stop's Geräte are its Auftrag's (`auftragResources`, resolved through the routes'
    // stopIds – a just-added stop has not been told about its group yet).
    const route = materialDecisionOperation.auftragResources
    const rows = route
      ? route.materials.map((material) => ({
          id: material.resourceId,
          assignmentId: material.assignmentId,
        }))
      : materialDecisionOperation.materials.map((id) => ({ id, assignmentId: null }))

    return rows.map((row) => {
      // A consumable has no "vor Ort" state at all — it was used or it was not,
      // and either way it does not come back (decision 26). So it is never an
      // open question, and it must not be one of the answers the operator is
      // asked to give.
      const consumable = Boolean(materials.find((material) => material.id === row.id)?.consumable)
      const answer = consumable ? "magazin" : materialAnswers[row.id]
      return {
        ...row,
        consumable,
        answer: answer ?? null,
        source: consumable ? ("consumable" as const) : answer ? ("rapport" as const) : null,
      }
    })
  }, [materialAnswers, materialDecisionOperation, materials, midRoute])

  /** How many units the operator genuinely still has to decide. */
  const materialDecisionOpenCount = materialDecisionItems.filter((item) => item.source === null).length

  /** The operator's own click wins; the rapport answers what they left alone. Null = nobody
   *  answered: never «Magazin» by default (hunt 2026-11-24) – a pump still running at a
   *  Schadenplatz must not be booked as returned because nobody asked. */
  const materialChoice = useCallback(
    (item: { id: string; answer: "magazin" | "vorort" | null }): "magazin" | "vorort" | null =>
      materialDecisions[item.id] ?? item.answer ?? null,
    [materialDecisions],
  )
  /** Units with no answer yet – «Abschliessen» waits for them (and for the rapport read). */
  const materialUnanswered = materialDecisionItems.filter((item) => materialChoice(item) === null).length

  const resolveMaterialDecision = useCallback(() => {
    if (!materialDecisionOperation) return { returned: [] as string[], kept: [] as string[] }
    // A held completion happens now: the status first (the server frees crew and
    // vehicles in that write), then the material answers below.
    if (held) changeStatusToTop(materialDecisionOperation.id, "complete")
    const returnedItems = materialDecisionItems.filter((item) => materialChoice(item) === "magazin")
    const kept = materialDecisionItems
      .filter((item) => materialChoice(item) === "vorort")
      .map((item) => item.id)

    // Write the confirmed answers back into the rapport: «Vor Ort» persists as
    // `left_on_site` (so the Restliste / Abholliste show the unit), «Magazin»
    // clears a crew's earlier tick. Fire-and-forget on purpose — an incident
    // that never had a rapport has nothing to record (the server answers
    // `applied: false`), and the board release below is independent of it.
    // Consumables are excluded the same way the dialog excludes them: a used
    // consumable is gone and can never be "vor Ort".
    const rapportDecisions = materialDecisionItems
      .filter((item) => !item.consumable && materialChoice(item) !== null)
      .map((item) => ({ material_id: item.id, left_on_site: materialChoice(item) === "vorort" }))
    if (rapportDecisions.length > 0) {
      void apiClient
        .applyRapportMaterialDecisions(materialDecisionOperation.id, rapportDecisions)
        .catch((error) => console.error("Failed to write material decisions back to the rapport:", error))
    }

    // Route-owned units are released from the ROUTE — and the route is the one
    // `materialDecisionItems` listed them from, so it is resolved the same way.
    const auftrag = findAuftragForStop(groups, materialDecisionOperation)
    for (const item of returnedItems) {
      if (item.assignmentId && auftrag) {
        void unassignGroupResource(auftrag.id, item.assignmentId)
      } else {
        void removeMaterial(materialDecisionOperation.id, item.id)
      }
    }
    onResolved()
    return { returned: returnedItems.map((item) => item.id), kept }
  }, [changeStatusToTop, groups, held, materialChoice, materialDecisionItems, materialDecisionOperation, onResolved, removeMaterial, unassignGroupResource])

  return {
    /** Units nobody answered yet, and whether the rapport read is still out: both make
     *  «Abschliessen» wait. */
    materialUnanswered,
    materialAnswersLoading,
    // Confirming the completion gate goes through `resolveMaterialDecision`,
    // which closes the gate itself (`onResolved`). Dismissing is a cancel.
    materialDecisionItems,
    materialDecisions,
    /** Who filed the rapport the prefilled answers come from; null when none did. */
    materialRapportBy,
    /** …and whether that rapport is still a draft, which the dialog must say. */
    materialRapportIsDraft,
    /** Units the operator genuinely still has to decide (0 = a pure confirmation). */
    materialDecisionOpenCount,
    materialChoice,
    setMaterialDecision: (materialId: string, decision: "magazin" | "vorort") => {
      setMaterialDecisions((current) => ({ ...current, [materialId]: decision }))
    },
    resolveMaterialDecision,
  }
}
