"use client"

import { useCallback, type Dispatch, type SetStateAction } from "react"
import { useTranslations } from "next-intl"
import { useMaterials, type Material } from "@/lib/contexts/materials-context"
import { materialResourceState } from "@/lib/resource-status"
import { isNavigableBinding, soleDestination, type BindingsPopoverState, type ResourceBinding } from "@/lib/board-sidebar"
import type { useResourceBindings } from "./use-resource-bindings"

interface UseMaterialClicksInput {
  resourceBindings: Pick<ReturnType<typeof useResourceBindings>, "collectMaterialBindings" | "followBinding">
  setBindingsPopover: Dispatch<SetStateAction<BindingsPopoverState | null>>
}

/**
 * What a click on a material sidebar row does: a device row, a device inside a
 * module block, an aggregate row, and «Nicht einsatzbereit» from its right-click.
 * The person rows' twin is `handlePersonClick` in use-resource-bindings.ts.
 */
export function useMaterialClicks({ resourceBindings, setBindingsPopover }: UseMaterialClicksInput) {
  const { setMaterialOutOfService } = useMaterials()
  const { collectMaterialBindings, followBinding } = resourceBindings
  const tCommon = useTranslations('kanban.common')

  /** Right-click on a sidebar row → the same `{ out_of_service }` PUT the
   *  Materialverwaltung sends. Set or not set; no reason, no cause list. */
  const handleToggleMaterialOutOfService = useCallback((material: Material, outOfService: boolean) => {
    void setMaterialOutOfService(material.id, outOfService)
  }, [setMaterialOutOfService])

  /** The device row answers the same question the person row does, including
   *  «nirgends» — a free device used to be a click into the void as well. Any
   *  device drawn as its own row comes here, a module member too (by Typ, or
   *  when its module is gone): the row is the popover's anchor. */
  const handleMaterialClick = (material: Material) => {
    const bindings = collectMaterialBindings(material)
    const popover: BindingsPopoverState = { kind: "material", id: material.id, title: material.name, subtitle: material.category, bindings }
    // A flagged device's question is «wieder einsatzbereit?», so its click always
    // opens the popover that offers it – before a binding could jump away. Its
    // dashed row is a `MaterialSidebarRow` even for a module member, so the
    // popover has an anchor.
    if (material.outOfService) {
      setBindingsPopover(popover)
      return
    }
    const only = soleDestination(bindings)
    if (only) {
      followBinding(only)
      return
    }
    setBindingsPopover(popover)
  }

  /** A device inside a module block (MaterialGroupBlock) has no anchor for the
   *  popover, so its click jumps to the first reachable binding rather than
   *  opening a list nothing could position. */
  const handleModuleMaterialClick = (material: Material) => {
    const bindings = collectMaterialBindings(material)
    const target = soleDestination(bindings) ?? bindings.find(isNavigableBinding)
    if (target) followBinding(target)
  }

  /** The aggregate row answers for the WHOLE bundle: every taken unit's
   *  bindings in one popover — «wo sind die anderen zwei Sauger?» must not
   *  need three clicks through three identical rows. */
  const handleAggregateMaterialClick = (units: Material[]) => {
    // Units share targets — two Sägen on one Auftrag are ONE place, so the
    // list carries each target once, with a ×n when several units are there.
    const merged = new Map<string, { binding: ResourceBinding; count: number }>()
    for (const binding of units.flatMap((unit) => collectMaterialBindings(unit))) {
      const entry = merged.get(binding.key)
      if (entry) entry.count += 1
      else merged.set(binding.key, { binding, count: 1 })
    }
    const bindings = [...merged.values()].map(({ binding, count }) =>
      count > 1 ? { ...binding, detail: tCommon('aggregateUnitCount', { count }) } : binding,
    )
    const free = units.filter((unit) => materialResourceState(unit) === 'available').length
    setBindingsPopover({
      kind: "material",
      id: units[0].id,
      title: units[0].name,
      subtitle: `${units[0].category} · ${tCommon('aggregateCountTitle', { free, total: units.length })}`,
      bindings,
    })
  }

  return { handleMaterialClick, handleModuleMaterialClick, handleAggregateMaterialClick, handleToggleMaterialOutOfService }
}
