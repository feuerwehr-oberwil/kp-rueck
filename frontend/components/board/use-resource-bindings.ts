"use client"

import { useCallback } from "react"
import { useTranslations } from "next-intl"
import { type Person, type Operation, type Material } from "@/lib/contexts/operations-context"
import { type OperationDetailSection, type OperationDetailTab } from "@/lib/hooks/use-operation-detail-shortcuts"
import { getIncidentRefLabel } from "@/lib/incident-types"
import { type BindingsPopoverState, type ResourceBinding } from "@/lib/board-sidebar"
import { REKO_TARGET, RESOURCES_TARGET, type PersonNowLink } from "@/lib/detail-target"
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
  const tPopover = useTranslations('kanban.personPopover')
  const tLeader = useTranslations('kanban.leader')

  /**
   * The Einsätze (crew or Reko) and Aufträge this person is on — all of them, not the
   * first hit. The person popover's place rows (`person-popover.tsx`); its functions
   * come from `personFunctionItems`.
   *
   * `filter`, not `find`: after a double booking the second incident used to be
   * unreachable from the sidebar, because a second click resolved to the same
   * first match.
   */
  const collectPersonPlaces = useCallback((person: Pick<Person, "id">): ResourceBinding[] => {
    const bindings: ResourceBinding[] = []
    // The role the card shows: «EL» for the Einsatz's leader, else «Mannschaft».
    const crewDetail = (op: Operation) =>
      [op.leaderId === person.id ? tLeader('abbr') : tPopover('crew'), op.groupId ? groupNames.get(op.groupId) : undefined]
        .filter(Boolean)
        .join(' · ')
    for (const op of operations) {
      if (op.crew.some((m) => m.personnelId === person.id)) {
        bindings.push({
          key: `incident-${op.id}`,
          kind: "incident",
          targetId: op.id,
          label: getIncidentRefLabel(op, 60),
          detail: crewDetail(op),
          target: RESOURCES_TARGET,
        })
      }
      if (op.assignedReko?.id === person.id) {
        // A crew row drawn as Reko says «Mannschaft»: its tick releases that row (S3).
        const purpose = op.assignedReko.purpose ?? "reko"
        bindings.push({
          key: `reko-${op.id}`,
          kind: "incident",
          targetId: op.id,
          label: getIncidentRefLabel(op, 60),
          detail: purpose === "crew" ? crewDetail(op) : tCommon('reko'),
          target: REKO_TARGET,
          purpose,
        })
      }
    }
    for (const group of groups) {
      const member = getGroupResources(group.id).personnel.find((p) => p.resourceId === person.id)
      if (member) {
        const detail = member.isLeader ? `${tPopover('auftrag')} · ${tLeader('abbr')}` : tPopover('auftrag')
        bindings.push({ key: `route-${group.id}`, kind: "route", targetId: group.id, label: group.name, detail })
      }
    }
    return bindings
  }, [operations, groups, getGroupResources, groupNames, tCommon, tPopover, tLeader])

  /**
   * Everywhere this person is held, functions included — what ⌘K decides with: one place to
   * go jumps there (`soleDestination`), anything else opens the sidebar on the person. The
   * special functions come straight out of the context (they are already on
   * the person) instead of a per-click API fetch.
   */
  const collectPersonBindings = useCallback((person: Person): ResourceBinding[] => {
    const bindings = collectPersonPlaces(person)
    // Reko is an Ereignis-level function first and an incident assignment second:
    // `isReko` is set from the event's special functions, while `assignedReko`
    // needs an assignment row on a specific incident. A Reko-Person who has not
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
      const drivenOp = person.driverVehicleId
        ? operations.find((op) => op.vehicles.some((v) => v.vehicleId === person.driverVehicleId))
        : undefined
      bindings.push({
        key: "fn-driver",
        kind: drivenOp ? "incident" : "function",
        targetId: drivenOp?.id ?? null,
        label: person.driverVehicleName || tCommon('driver'),
        detail: drivenOp ? getIncidentRefLabel(drivenOp, 60) : tCommon('specialFunctionNoIncident'),
        target: drivenOp ? RESOURCES_TARGET : undefined,
      })
    }
    if (person.isMagazin) bindings.push({ key: "fn-magazin", kind: "function", targetId: null, label: tCommon('magazin'), detail: tCommon('specialFunctionNoIncident') })
    if (person.isTelefondienst) bindings.push({ key: "fn-telefon", kind: "function", targetId: null, label: tCommon('telefondienst'), detail: tCommon('specialFunctionNoIncident') })
    if (person.isKommandoposten) bindings.push({ key: "fn-kp", kind: "function", targetId: null, label: tCommon('kommandoposten'), detail: tCommon('specialFunctionNoIncident') })
    return bindings
  }, [collectPersonPlaces, operations, tCommon])

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
        target: RESOURCES_TARGET,
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
  const followBinding = useCallback((binding: Pick<ResourceBinding, "kind" | "targetId" | "target">, { allowModal = false }: { allowModal?: boolean } = {}) => {
    if (binding.kind === "incident" && binding.targetId) {
      if (!filteredOperations.some((op) => op.id === binding.targetId)) setSearchQuery('')
      scrollToCard(binding.targetId)
      // …and open it, on the tab of the binding's role. «Wo ist die Motorsäge?»
      // is answered by the card, but the operator asked in order to look at it.
      // No modal on a narrow viewport unless the caller allows it: from the
      // sidebar it would cover the resource list they are working through.
      openIncidentDetail(binding.targetId, binding.target?.tab, binding.target?.section, { allowModal })
    } else if (binding.kind === "route" && binding.targetId) {
      setAuftraegeFocusGroupId(binding.targetId)
      setActiveFooterSheet('auftraege')
    }
  }, [scrollToCard, filteredOperations, setSearchQuery, openIncidentDetail, setActiveFooterSheet, setAuftraegeFocusGroupId])

  /**
   * A sidebar person row answers «wo ist diese Person?» — always.
   *
   * The click always opens the person popover, one place or many (owner pick A,
   * 24.11.2026): the one-place shortcut jumped to the card and skipped what the popover
   * offers (functions, Abmelden). The popover's place row still links
   * to the card. Material rows keep their jump (`handleMaterialClick` in use-material-clicks.ts).
   */
  const handlePersonClick = (person: Pick<Person, "id">) => {
    setBindingsPopover({ kind: "person", id: person.id })
  }

  /**
   * Dienstzeiten «Jetzt» (UX.14): follow the place that line names (`personNowLink`). The sheet
   * closes, so the modal may open on a narrow desktop: there is no list left to cover.
   */
  const followPersonNow = useCallback((link: PersonNowLink) => {
    setActiveFooterSheet(null)
    followBinding(link, { allowModal: true })
  }, [followBinding, setActiveFooterSheet])

  return {
    collectPersonPlaces,
    collectPersonBindings,
    collectMaterialBindings,
    followBinding,
    followPersonNow,
    handlePersonClick,
  }
}
