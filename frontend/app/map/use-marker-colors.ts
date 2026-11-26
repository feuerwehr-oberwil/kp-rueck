import { useMemo } from "react"
import { useTranslations } from "next-intl"
import type { Operation } from "@/lib/contexts/operations/types"
import { colorGroupFor, COLOR_NONE, type ColorByDimension, type ColorGroup, type ColorGroupSource } from "@/lib/kanban-utils"

/**
 * «Färben nach» on the Lagekarte: each Einsatz id → its marker accent (`markerAccents`, none for
 * Priorität – the markers' own fill), plus the legend under the menu (`colorLegend`, with an
 * «Ohne Zuweisung» / «Ohne Auftrag» entry for Einsätze without a value). Reads the full
 * operations, which carry Reko, vehicle and type, rather than the lighter map incidents.
 */
export function useMarkerColors({
  operations,
  colorBy,
  groups,
  rekoOrder,
}: {
  operations: Operation[]
  colorBy: ColorByDimension
  groups: ColorGroupSource[]
  rekoOrder: ReadonlyMap<string, number>
}) {
  const t = useTranslations('map')
  const markerAccents = useMemo(() => {
    // Priority uses the markers' built-in priority fill — no override.
    if (colorBy === 'priority') return undefined
    const m = new Map<string, string>()
    for (const op of operations) {
      const g = colorGroupFor(op, colorBy, groups, rekoOrder)
      m.set(op.id, g ? g.color : COLOR_NONE) // grey when nothing assigned yet
    }
    return m
  }, [operations, colorBy, groups, rekoOrder])

  const colorLegend = useMemo<ColorGroup[]>(() => {
    // Priority falls back to the static legend section in MapLegend.
    if (colorBy === 'priority') return []
    const map = new Map<string, ColorGroup>()
    let hasNone = false
    for (const op of operations) {
      const g = colorGroupFor(op, colorBy, groups, rekoOrder)
      if (g) { if (!map.has(g.key)) map.set(g.key, g) }
      else hasNone = true
    }
    const arr = [...map.values()]
    // Empty/none state: surface incidents without a value in this dimension.
    if (hasNone) {
      const noneLabel = colorBy === 'auftrag' ? t('common.noAuftrag') : t('common.noAssignment')
      arr.push({ key: '__none__', label: noneLabel, color: COLOR_NONE })
    }
    return arr
  }, [operations, colorBy, groups, rekoOrder, t])

  return { markerAccents, colorLegend }
}
