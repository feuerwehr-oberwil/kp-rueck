"use client"

import { useTranslations } from "next-intl"
import { Badge } from "@/components/ui/badge"
import { Reveal } from "@/components/ui/reveal"
import { ListSection } from "@/components/kanban/assignment-list-section"
import { CheckCircle, Circle, Layers, ChevronDown, ChevronRight, Siren, Ban, Truck } from "lucide-react"
import { type Material } from "@/lib/contexts/operations-context"
import { materialResourceState } from "@/lib/resource-status"
import { getActiveLocale } from "@/lib/i18n-messages"
import { cn } from "@/lib/utils"

/*
 * The material half of `ResourceAssignmentDialog`: the list (module groups with
 * expand + select-all, then the ungrouped free / spoken-for blocks), its tile,
 * the type chip row, and the pure helpers that sort, group and count the list.
 *
 * The dialog frame keeps the state (search, depot filter, the ticked set, the
 * confirm prompts, the 1–9 keys) because those are shared with crew and
 * vehicles; it feeds these pieces with what they draw and the handlers they
 * call. Nothing here is memoised — it re-renders with the dialog.
 */

/** Search over name, depot (`category`) and module name. */
export const materialMatchesQuery = (m: Material, raw: string, groups: { id: string; name: string }[]) => {
  const query = raw.trim().toLowerCase()
  if (!query) return true
  // Match material name or category
  if (m.name.toLowerCase().includes(query) || m.category.toLowerCase().includes(query)) return true
  // Match group name
  if (m.groupId) {
    const group = groups.find(g => g.id === m.groupId)
    if (group?.name.toLowerCase().includes(query)) return true
  }
  return false
}

/** The type chip row's options: every functional type («Wasser») with its
 *  count across ALL listed materials, occupied or not. */
export function materialTypeCounts(materials: Material[]): { type: string; count: number }[] {
  const byType = new Map<string, number>()
  for (const m of materials) {
    if (!m.type) continue
    byType.set(m.type, (byType.get(m.type) ?? 0) + 1)
  }
  return [...byType.entries()]
    .map(([type, count]) => ({ type, count }))
    // Inventory data — de-CH collation whatever the UI language, like every
    // roster sort (see roster-order).
    .sort((a, b) => a.type.localeCompare(b.type, 'de-CH'))
}

/** Category sort order, then assigned-first, then name — feeds the group split
 *  so order within each group respects the setting. */
export function sortMaterialsForAssignment(materials: Material[]): Material[] {
  return [...materials].sort((a, b) => {
    if (a.category !== b.category) {
      if (a.categorySortOrder !== b.categorySortOrder) return (a.categorySortOrder ?? 0) - (b.categorySortOrder ?? 0)
      return (a.category ?? "").localeCompare(b.category ?? "", getActiveLocale())
    }
    if (a.status !== b.status) return a.status === "assigned" ? -1 : 1
    return (a.name ?? "").localeCompare(b.name ?? "", getActiveLocale())
  })
}

export interface MaterialAssignmentGroup {
  groupId: string
  groupName: string
  materials: Material[]
}

/** Split the (sorted) list into module groups, in first-seen order, and the
 *  materials that belong to no known module. */
export function groupMaterialsForAssignment(
  sortedMaterials: Material[],
  materialGroups: { id: string; name: string }[],
): { groups: MaterialAssignmentGroup[]; ungrouped: Material[] } {
  const groups: MaterialAssignmentGroup[] = []
  const ungrouped: Material[] = []

  // Collect materials by group
  const groupMap = new Map<string, Material[]>()
  for (const m of sortedMaterials) {
    const groupId = m.groupId
    const group = groupId ? materialGroups.find(g => g.id === groupId) : null
    if (group) {
      if (!groupMap.has(group.id)) groupMap.set(group.id, [])
      groupMap.get(group.id)!.push(m)
    } else {
      ungrouped.push(m)
    }
  }

  for (const [groupId, mats] of groupMap) {
    const group = materialGroups.find(g => g.id === groupId)!
    groups.push({ groupId, groupName: group.name, materials: mats })
  }

  return { groups, ungrouped }
}

interface MaterialTypeChipsProps {
  typeGroups: { type: string; count: number }[]
  typeFilter: string | null
  onTypeFilterChange: (type: string | null) => void
}

/** The second chip row (wide layout): FILTER the list to one functional type
 *  across all depots. Filters only, selects nothing. The frame renders it
 *  under the depot chips when there is more than one type. */
export function MaterialTypeChips({ typeGroups, typeFilter, onTypeFilterChange }: MaterialTypeChipsProps) {
  const t = useTranslations('kanban')
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-0.5 text-xs text-muted-foreground">{t('assignmentDialog.quickSelectByType')}</span>
      {typeGroups.map(({ type, count }) => {
        const isActive = typeFilter === type
        return (
          <button
            key={type}
            onClick={() => onTypeFilterChange(isActive ? null : type)}
            className={cn(
              "cursor-pointer px-2.5 py-1 rounded-full text-xs border transition-colors",
              isActive
                ? "bg-sel-wash text-sel-foreground border-sel-edge"
                : "bg-muted/50 text-muted-foreground border-border hover:bg-muted"
            )}
          >
            {type} ({count})
          </button>
        )
      })}
    </div>
  )
}

interface MaterialAssignmentListProps {
  /** Module groups (drawn whole, on top) and the ungrouped free / spoken-for
   *  blocks — the frame computes them because the 1–9 keys index the same order. */
  groups: MaterialAssignmentGroup[]
  ungroupedFree: Material[]
  ungroupedBusy: Material[]
  /** Nothing free, something spoken for: say so where the free block would be. */
  allBusy: boolean
  /** Ticked in the dialog (not yet committed). */
  selectedMaterials: ReadonlySet<string>
  occupiedElsewhereMaterialIds: ReadonlySet<string>
  /** Where a material is held elsewhere, or null when free / on this target. */
  materialElsewhereLabel: (material: Material) => { short: string; full: string } | null
  /** Vehicle names on this target — a depot that IS one of them is on scene. */
  assignedVehicles: string[]
  /** Id of the tile (or `group-<first id>`) whose tick just appeared. */
  justAssigned: string | null
  expandedGroups: ReadonlySet<string>
  onToggleExpanded: (groupId: string) => void
  onToggleMaterial: (material: Material) => void
  /** Select-all on a module header: FREE ids only. */
  onToggleGroup: (freeMaterialIds: string[]) => void
}

/** The material list inside the dialog's scroll area. */
export function MaterialAssignmentList({
  groups,
  ungroupedFree,
  ungroupedBusy,
  allBusy,
  selectedMaterials,
  occupiedElsewhereMaterialIds,
  materialElsewhereLabel,
  assignedVehicles,
  justAssigned,
  expandedGroups,
  onToggleExpanded,
  onToggleMaterial,
  onToggleGroup,
}: MaterialAssignmentListProps) {
  const t = useTranslations('kanban')
  const isMaterialSelected = (materialId: string) => selectedMaterials.has(materialId)
  const allBusyText = t('assignmentDialog.allBusyMaterials')

/** One material tile — shared by the free block, the spoken-for block and
 *  the expanded module groups. */
const renderMaterialTile = (material: Material) => {
  const isSelected = isMaterialSelected(material.id)
  const wasJustAssigned = justAssigned === material.id
  const elsewhere = materialElsewhereLabel(material)
  // Readiness beats deployment — see materialResourceState. A device recorded
  // as defective is shown, named as such, and cannot be ticked.
  const isOutOfService = materialResourceState(material) === 'unavailable' && !isSelected
  // This material's depot IS a vehicle already assigned to the target (e.g.
  // Mowa): its stock is on scene. Emphasis only — nothing gets preselected.
  const vehicleOnScene = !elsewhere && assignedVehicles.includes(material.category)
  return (
    <button
      key={material.id}
      onClick={() => onToggleMaterial(material)}
      disabled={isOutOfService}
      className={cn(
        "flex items-center gap-2.5 p-2.5 rounded-lg border border-border/50 transition-all text-left",
        isOutOfService ? "cursor-not-allowed border-dashed opacity-60" : "cursor-pointer hover:border-sel-edge hover:bg-secondary/30 hover-delight",
        isSelected && "border-sel-edge bg-sel-wash",
        vehicleOnScene && !isSelected && "border-emerald-500/30"
      )}
    >
      {isOutOfService ? (
        <Ban className="h-5 w-5 flex-shrink-0 text-muted-foreground" />
      ) : isSelected ? (
        <CheckCircle className={cn(
          "h-5 w-5 text-sel-foreground flex-shrink-0",
          wasJustAssigned && "animate-check-appear"
        )} />
      ) : (
        <Circle className="h-5 w-5 text-muted-foreground flex-shrink-0" />
      )}
      <div className="min-w-0">
        <p className={cn("font-medium text-sm truncate", isOutOfService && "text-muted-foreground")} title={material.name}>{material.name}</p>
        {isOutOfService ? (
          <p className="truncate text-2xs font-medium text-muted-foreground">
            {t('assignmentDialog.outOfService')}
          </p>
        ) : elsewhere ? (
          <span
            title={elsewhere.full}
            className="mt-0.5 inline-flex max-w-full items-center gap-1 truncate text-2xs font-medium text-amber-700 dark:text-amber-400"
          >
            <Siren className="h-3 w-3 flex-shrink-0" />
            <span className="truncate">{elsewhere.short}</span>
          </span>
        ) : vehicleOnScene ? (
          <span
            title={t('assignmentDialog.vehicleOnSceneHint', { name: material.category })}
            className="mt-0.5 inline-flex max-w-full items-center gap-1 truncate text-2xs font-medium text-emerald-700 dark:text-emerald-400"
          >
            <Truck className="h-3 w-3 flex-shrink-0" />
            <span className="truncate">{material.category}</span>
          </span>
        ) : (
          <p className="text-xs text-muted-foreground truncate">{material.category}</p>
        )}
      </div>
    </button>
  )
}

  return (
    <>
      {/* Material groups */}
      {groups.map(({ groupId, groupName, materials: groupMats }) => {
        // Only FREE items count towards select-all / "Alle" — a module
        // reads complete without its occupied-elsewhere items, which
        // must be picked individually (with confirm).
        const freeGroupMatIds = groupMats.filter(m => !occupiedElsewhereMaterialIds.has(m.id)).map(m => m.id)
        const allSelected = freeGroupMatIds.length > 0 && freeGroupMatIds.every(id => selectedMaterials.has(id))
        const selectedCount = groupMats.filter(m => selectedMaterials.has(m.id)).length
        const someSelected = selectedCount > 0
        const isExpanded = expandedGroups.has(groupId)
        const wasJustAssigned = justAssigned === `group-${freeGroupMatIds[0]}`
        // Origin(s) of the module's items — distinct depots/locations.
        const groupOrigins = [...new Set(groupMats.map(m => m.category).filter(Boolean))].join(", ")
        return (
          <div key={`group-${groupId}`}>
            {/* Group header row */}
            <div className={cn(
              "flex items-center rounded-lg border border-border/50 transition-all hover:border-sel-edge hover:bg-secondary/30",
              allSelected && "border-sel-edge bg-sel-wash"
            )}>
              {/* Expand/collapse toggle */}
              <button
                onClick={() => onToggleExpanded(groupId)}
                className="cursor-pointer px-2 py-3"
              >
                {isExpanded
                  ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  : <ChevronRight className="h-4 w-4 text-muted-foreground" />
                }
              </button>
              {/* Select all toggle */}
              <button
                onClick={() => onToggleGroup(freeGroupMatIds)}
                className="flex-1 flex cursor-pointer items-center justify-between py-3 pr-3 text-left"
              >
                <div className="flex items-center gap-3">
                  {allSelected ? (
                    <CheckCircle className={cn(
                      "h-5 w-5 text-sel-foreground flex-shrink-0",
                      wasJustAssigned && "animate-check-appear"
                    )} />
                  ) : someSelected ? (
                    <CheckCircle className="h-5 w-5 text-sel-foreground/50 flex-shrink-0" />
                  ) : (
                    <Circle className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                  )}
                  <div>
                    <p className="font-medium text-sm flex items-center gap-1.5">
                      <Layers className="h-3.5 w-3.5 text-muted-foreground" />
                      {groupName}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {groupOrigins && <span>{groupOrigins} · </span>}
                      {t('assignmentDialog.groupSelected', { selected: selectedCount, total: groupMats.length })}
                    </p>
                  </div>
                </div>
                {allSelected && (
                  <Badge variant="secondary" className="text-xs animate-scale-in">{t('assignmentDialog.all')}</Badge>
                )}
                {someSelected && !allSelected && (
                  <Badge variant="secondary" className="text-xs animate-scale-in">{t('assignmentDialog.partial')}</Badge>
                )}
              </button>
            </div>
            {/* Expanded individual materials — the same tile as
                ungrouped items, slightly inset so they read as the
                module's contents. */}
            {/* Slides open (Reveal); the 4px gap under the header
                is padding inside the clip, so nothing snaps. */}
            <Reveal open={isExpanded} innerClassName="pt-1">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pl-4 border-l-2 border-border/40 ml-3">
                {groupMats.map(renderMaterialTile)}
              </div>
            </Reveal>
          </div>
        )
      })}
      {/* Ungrouped materials — free first, spoken-for underneath.
          Module groups above stay whole: a module is a unit. */}
      {allBusy && (
        <ListSection tone="free" label={t('assignmentDialog.sectionFree', { count: 0 })}>
          <p className="text-sm text-muted-foreground">{allBusyText}</p>
        </ListSection>
      )}
      {ungroupedFree.length > 0 && (
        <ListSection tone="free" label={t('assignmentDialog.sectionFree', { count: ungroupedFree.length })}>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {ungroupedFree.map(renderMaterialTile)}
          </div>
        </ListSection>
      )}
      {ungroupedBusy.length > 0 && (
        <ListSection tone="busy" label={t('assignmentDialog.sectionBusy', { count: ungroupedBusy.length })}>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {ungroupedBusy.map(renderMaterialTile)}
          </div>
        </ListSection>
      )}
    </>
  )
}
