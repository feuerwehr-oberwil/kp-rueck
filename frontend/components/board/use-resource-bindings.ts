"use client"

import { useCallback } from "react"
import { useTranslations } from "next-intl"
import { type Person, type Operation, type Material } from "@/lib/contexts/operations-context"
import { type OperationDetailSection, type OperationDetailTab } from "@/lib/hooks/use-operation-detail-shortcuts"
import { getIncidentRefLabel } from "@/lib/incident-types"
import { soleDestination, type BindingsPopoverState, type ResourceBinding } from "@/lib/board-sidebar"
import { type FooterSheet } from "@/components/board/board-footer"
import type { GroupResources, IncidentGroup } from "@/lib/types/groups"
import type { Dispatch, SetStateAction } from "react"

export interface UseResourceBindingsInput {
  operations: Operation[]
  getGroupResources: (groupId: string) => GroupResources
  groups: IncidentGroup[]
  scrollToCard: (operationId: string) => void
  setSearchQuery: Dispatch<SetStateAction<string>>
  openIncidentDetail: (operationId: string, tab?: OperationDetailTab, section?: OperationDetailSection, options?: { allowModal?: boolean; }) => void
  setActiveFooterSheet: Dispatch<SetStateAction<FooterSheet | null>>
  setAuftraegeFocusGroupId: Dispatch<SetStateAction<string | null>>
  setBindingsPopover: Dispatch<SetStateAction<BindingsPopoverState | null>>
  groupNames: Map<string, string>
  filteredOperations: Operation[]
}

/**
 * Where a person or a unit of material is held (incident, Auftrag, special
 * function) and following one of those bindings from the sidebar. Moved verbatim
 * out of app/page.tsx.
 */
export function useResourceBindings(input: UseResourceBindingsInput) {
  const {
    operations,
    getGroupResources,
    groups,
    scrollToCard,
    setSearchQuery,
    openIncidentDetail,
    setActiveFooterSheet,
    setAuftraegeFocusGroupId,
    setBindingsPopover,
    groupNames,
    filteredOperations,
  } = input
  const tCommon = useTranslations('kanban.common')

  /**
   * Everywhere this person is held — all of it, not the first hit.
   *
   * `filter`, not `find`: after a double booking the second incident used to be
   * unreachable from the sidebar, because a second click resolved to the same
   * first match. The special functions come straight out of the context (they
   * are already on the person) instead of a per-click API fetch that only ever
   * looked at `driver`.
   */
  const collectPersonBindings = useCallback((person: Person): ResourceBinding[] => {
    const bindings: ResourceBinding[] = []
    for (const op of operations) {
      if (op.crew.includes(person.name)) {
        bindings.push({
          key: `incident-${op.id}`,
          kind: "incident",
          targetId: op.id,
          label: getIncidentRefLabel(op, 60),
          detail: op.groupId ? groupNames.get(op.groupId) ?? "" : "",
        })
      }
      if (op.assignedReko?.id === person.id) {
        bindings.push({
          key: `reko-${op.id}`,
          kind: "incident",
          targetId: op.id,
          label: getIncidentRefLabel(op, 60),
          detail: tCommon('reko'),
        })
      }
    }
    for (const group of groups) {
      if (getGroupResources(group.id).personnel.some((p) => p.name === person.name)) {
        bindings.push({ key: `route-${group.id}`, kind: "route", targetId: group.id, label: group.name, detail: "" })
      }
    }
    // Reko is an Ereignis-level function first and an incident assignment second:
    // `isReko` is set from the event's special functions, while `assignedReko`
    // needs an assignment row on a specific incident. A Reko-Offizier who has not
    // been sent anywhere yet has the flag and no incident — and produced exactly
    // nothing when clicked, because the loop above found no binding to list.
    // Same shape as the Fahrer below: the incident when there is one, the bare
    // function when there is not.
    if (person.isReko && !bindings.some((b) => b.key.startsWith("reko-"))) {
      bindings.push({
        key: "fn-reko",
        kind: "function",
        targetId: null,
        label: tCommon('reko'),
        detail: tCommon('specialFunctionNoIncident'),
      })
    }
    // Station functions. They bind a person as hard as an incident does, and
    // they are exactly the rows whose click used to do nothing at all.
    if (person.isDriver) {
      const drivenOp = person.driverVehicleName
        ? operations.find((op) => op.vehicles.includes(person.driverVehicleName!))
        : undefined
      bindings.push({
        key: "fn-driver",
        kind: drivenOp ? "incident" : "function",
        targetId: drivenOp?.id ?? null,
        label: person.driverVehicleName || tCommon('driver'),
        detail: drivenOp ? getIncidentRefLabel(drivenOp, 60) : tCommon('specialFunctionNoIncident'),
      })
    }
    if (person.isMagazin) bindings.push({ key: "fn-magazin", kind: "function", targetId: null, label: tCommon('magazin'), detail: tCommon('specialFunctionNoIncident') })
    if (person.isTelefondienst) bindings.push({ key: "fn-telefon", kind: "function", targetId: null, label: tCommon('telefondienst'), detail: tCommon('specialFunctionNoIncident') })
    if (person.isKommandoposten) bindings.push({ key: "fn-kp", kind: "function", targetId: null, label: tCommon('kommandoposten'), detail: tCommon('specialFunctionNoIncident') })
    return bindings
  }, [operations, groups, getGroupResources, groupNames, tCommon])

  const collectMaterialBindings = useCallback((material: Material): ResourceBinding[] => {
    const bindings: ResourceBinding[] = []
    // ONE row per Auftrag, like the person rows: an engagement anywhere inside
    // a route — the route owning the unit, or a direct assignment to one of
    // its stops — reads as «Auftrag X», once. Only incidents outside every
    // Auftrag keep their own row.
    const routeGroupIds = new Set<string>()
    for (const group of groups) {
      if (getGroupResources(group.id).materials.some((m) => m.resourceId === material.id)) {
        routeGroupIds.add(group.id)
      }
    }
    for (const op of operations) {
      if (!op.materials.includes(material.id)) continue
      if (op.groupId) {
        routeGroupIds.add(op.groupId)
        continue
      }
      bindings.push({
        key: `incident-${op.id}`,
        kind: "incident",
        targetId: op.id,
        label: getIncidentRefLabel(op, 60),
        detail: "",
      })
    }
    for (const group of groups) {
      if (routeGroupIds.has(group.id)) {
        bindings.push({ key: `route-${group.id}`, kind: "route", targetId: group.id, label: group.name, detail: "" })
      }
    }
    return bindings
  }, [operations, groups, getGroupResources])

  /**
   * Follow one binding: a card to scroll to, or the Auftrag sheet to open.
   *
   * A card the board's own search is currently hiding is not there to be scrolled
   * to, and `scrollToCard` would quietly find nothing — so the query that hides it
   * is cleared first. The rest of the "nothing happens" cases are gone at the
   * source: a binding that cannot be followed is not offered as a button.
   */
  const followBinding = useCallback((binding: ResourceBinding) => {
    if (binding.kind === "incident" && binding.targetId) {
      if (!filteredOperations.some((op) => op.id === binding.targetId)) setSearchQuery('')
      scrollToCard(binding.targetId)
      // …and open it. «Wo ist die Motorsäge?» is answered by the card, but the
      // operator asked in order to look at it. No modal on a narrow viewport:
      // that would cover the resource list they are working through.
      openIncidentDetail(binding.targetId, undefined, undefined, { allowModal: false })
    } else if (binding.kind === "route" && binding.targetId) {
      setAuftraegeFocusGroupId(binding.targetId)
      setActiveFooterSheet('auftraege')
    }
  }, [scrollToCard, filteredOperations, setSearchQuery, openIncidentDetail, setActiveFooterSheet, setAuftraegeFocusGroupId])

  /**
   * A sidebar person row answers «wo ist diese Person?» — always.
   *
   * Every early return here used to be a click that did nothing: a free person
   * failed the occupancy gate, and an occupied one with no listable binding (the
   * Reko-Offizier who is not on an incident yet) fell through the second. The
   * popover now opens in both cases and says so in words; only the one-incident
   * shortcut still jumps straight to the card, which is what operators know.
   */
  const handlePersonClick = (person: Person) => {
    const bindings = collectPersonBindings(person)
    const only = soleDestination(bindings)
    if (only) {
      followBinding(only)
      return
    }
    setBindingsPopover({
      kind: "person",
      id: person.id,
      title: person.name,
      subtitle: person.role ?? "",
      bindings,
    })
  }

  return {
    collectPersonBindings,
    collectMaterialBindings,
    followBinding,
    handlePersonClick,
  }
}
