"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { type Person, type Material } from "@/lib/contexts/operations-context"
import { useMaterials } from "@/lib/contexts/materials-context"
import { usePersonMatcher } from "@/lib/hooks/use-person-matcher"
import { compareByName, compareByRankThenName } from "@/lib/roster-order"
import {
  groupMaterialsForAssignment,
  materialMatchesQuery,
  materialTypeCounts,
  sortMaterialsForAssignment,
} from "@/components/kanban/material-assignment-list"

/** The three lists `ResourceAssignmentDialog` assigns from. */
export type AssignmentResource = 'crew' | 'vehicles' | 'materials'

/** What `useAssignmentFilters` returns – `AssignmentFilterControls` and `AssignmentEmptyState` draw from it. */
export type AssignmentFilters = ReturnType<typeof useAssignmentFilters>

const vehicleMatchesQuery = (v: { name: string; type: string }, query: string) => {
  const q = query.trim().toLowerCase()
  return !q || v.name.toLowerCase().includes(q) || v.type.toLowerCase().includes(q)
}

/**
 * The search and the quick filters of `ResourceAssignmentDialog`, and the lists they leave: the
 * state, the reset on close and on a resource change, the filtered and sorted lists, and why a
 * list came out empty (`emptyReason`). The dialog calls it once per render with its pools.
 */
export function useAssignmentFilters({
  open,
  resourceType,
  personnel,
  vehicles,
  materials,
  assignedVehicleIds,
}: {
  open: boolean
  resourceType: AssignmentResource | null
  personnel: Person[]
  vehicles: Array<{ id: string; name: string; type: string; outOfService: boolean }>
  materials: Material[]
  assignedVehicleIds: string[]
}) {
  const t = useTranslations('kanban')
  const { materialGroups } = useMaterials()
  const matchesPerson = usePersonMatcher()
  const searchRef = useRef<HTMLInputElement>(null)
  const [searchQuery, setSearchQuery] = useState("")
  // Quick category filter (null = all): rank for crew, depot/location for
  // material, type for vehicles. Sits as chips below the search.
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null)
  // Vehicles-only quick filter: when on, show only vehicles already assigned to
  // this incident.
  const [showOnlyAssignedVehicles, setShowOnlyAssignedVehicles] = useState(false)
  // Materials-only quick filter: functional type (e.g. "Wasser") — narrows the
  // visible list like the depot chips, never pre-selects anything.
  const [typeFilter, setTypeFilter] = useState<string | null>(null)

  // Reset search + category filter on close, and clear the category filter
  // whenever the resource type changes (its categories no longer apply).
  useEffect(() => {
    if (!open) {
      setSearchQuery("")
      setCategoryFilter(null)
      setTypeFilter(null)
      setShowOnlyAssignedVehicles(false)
    }
  }, [open])
  useEffect(() => {
    setCategoryFilter(null)
    setTypeFilter(null)
    setShowOnlyAssignedVehicles(false)
  }, [resourceType])

  // Quick-filter categories for the active resource type (rank / location / type).
  const categories = useMemo(() => {
    const source =
      resourceType === 'crew'
        ? personnel.map(p => p.role).filter((r): r is string => Boolean(r))
        : resourceType === 'vehicles'
          ? vehicles.map(v => v.type)
          : resourceType === 'materials'
            ? materials.map(m => m.category)
            : []
    // Ranks keep the station's OWN order (the same `role_sort_order` the list
    // below them uses); everything else is alphabetical. Sorting the rank chips
    // alphabetically made the chip row read «AdF · Gruppenführer · Offizier»
    // over a list that runs the other way round — two orders for one thing, on
    // one screen.
    if (resourceType === 'crew') {
      const seen = new Set<string>()
      const ranks: string[] = []
      for (const person of [...personnel].sort(compareByRankThenName)) {
        const rank = person.role
        if (!rank || seen.has(rank)) continue
        seen.add(rank)
        ranks.push(rank)
      }
      return ranks
    }
    // Ranks and categories are roster/inventory data: de-CH whatever the UI
    // language, like every roster sort (see roster-order).
    return [...new Set(source)].sort((a, b) => a.localeCompare(b, 'de-CH'))
  }, [resourceType, personnel, vehicles, materials])

  // Second chip row for materials: functional type (e.g. "Wasser") as a quick
  // FILTER across depots — narrows the visible list like the depot chips,
  // selects nothing. Counts ALL listed materials of the type, occupied or not.
  // Empty for crew and vehicles, so `materialTypeGroups.length > 1` alone
  // already means «materials, with more than one type».
  const materialTypeGroups = useMemo(() => {
    if (resourceType !== 'materials') return [] as { type: string; count: number }[]
    return materialTypeCounts(materials)
  }, [resourceType, materials])

  // Filter resources by search query + quick category filter. The shared
  // matcher also finds people by their special function ("telefondienst",
  // "kommandoposten", a driver's vehicle name) and by where they are now
  // (Einsatz number, address, Auftrag) — see lib/resource-status.ts.
  const filteredPersonnel = useMemo(() => {
    return personnel.filter(p =>
      matchesPerson(p, searchQuery) &&
      (!categoryFilter || p.role === categoryFilter)
    )
  }, [personnel, searchQuery, categoryFilter, matchesPerson])

  /**
   * Rank first, assigned-first inside a rank, then the name.
   *
   * The rank legs used to collate with `getActiveLocale()` — the UI language —
   * so a French-speaking operator got a different sequence than the board next
   * to them. Names and rank labels are roster data (`lib/roster-order.ts`), not
   * interface copy. The assigned-first leg stays in the middle: it is about
   * this dialog, not about the roster.
   */
  const sortedFilteredPersonnel = useMemo(() => {
    return [...filteredPersonnel].sort((a, b) => {
      if (a.role !== b.role) return compareByRankThenName(a, b)
      if (a.status !== b.status) return a.status === "assigned" ? -1 : 1
      return compareByName(a, b)
    })
  }, [filteredPersonnel])

  const filteredVehicles = useMemo(() => {
    return vehicles.filter(v =>
      vehicleMatchesQuery(v, searchQuery) &&
      (!categoryFilter || v.type === categoryFilter) &&
      (!showOnlyAssignedVehicles || assignedVehicleIds.includes(v.id))
    )
  }, [vehicles, searchQuery, categoryFilter, showOnlyAssignedVehicles, assignedVehicleIds])

  const filteredMaterials = useMemo(() => {
    return materials.filter(m => {
      if (categoryFilter && m.category !== categoryFilter) return false
      if (typeFilter && m.type !== typeFilter) return false
      return materialMatchesQuery(m, searchQuery, materialGroups)
    })
  }, [materials, searchQuery, materialGroups, categoryFilter, typeFilter])

  /**
   * WHY the list is empty — the four answers are four different sentences
   * (see components/ui/empty-state.tsx). The old code knew only «there is a
   * search» and «everything is assigned», so «Nur zugewiesene» on an Einsatz
   * without a vehicle claimed «Alle Fahrzeuge sind bereits zugewiesen».
   *
   * - `none`:   the pool itself is empty (nobody checked in, no fleet entered)
   * - `search`: the search alone matches nothing — filters or not
   * - `filter`: the search (if any) has hits, an active filter hides them
   */
  const query = searchQuery.trim()
  const activeFilterLabels = [
    ...(categoryFilter ? [categoryFilter] : []),
    ...(resourceType === 'materials' && typeFilter ? [typeFilter] : []),
    ...(resourceType === 'vehicles' && showOnlyAssignedVehicles ? [t('common.onlyAssignedVehicles')] : []),
  ]
  const filtersActive = activeFilterLabels.length > 0
  const poolCount =
    resourceType === 'crew' ? personnel.length
      : resourceType === 'vehicles' ? vehicles.length
        : resourceType === 'materials' ? materials.length
          : 0
  const filteredCount =
    resourceType === 'crew' ? filteredPersonnel.length
      : resourceType === 'vehicles' ? filteredVehicles.length
        : resourceType === 'materials' ? filteredMaterials.length
          : 0
  const searchHitCount = !query
    ? poolCount
    : resourceType === 'crew' ? personnel.filter((p) => matchesPerson(p, query)).length
      : resourceType === 'vehicles' ? vehicles.filter((v) => vehicleMatchesQuery(v, query)).length
        : resourceType === 'materials' ? materials.filter((m) => materialMatchesQuery(m, query, materialGroups)).length
          : 0
  const emptyReason: 'none' | 'search' | 'filter' | null =
    !resourceType || filteredCount > 0 ? null
      : poolCount === 0 ? 'none'
        : query && searchHitCount === 0 ? 'search'
          : filtersActive ? 'filter'
            : 'search'

  /** «Filter zurücksetzen»: the filters only — the search and every tick stay. */
  const resetFilters = () => {
    setCategoryFilter(null)
    setTypeFilter(null)
    setShowOnlyAssignedVehicles(false)
  }
  /** «Suche leeren»: the query only, and the cursor stays in the field. */
  const clearSearch = () => {
    setSearchQuery("")
    searchRef.current?.focus()
  }

  // Sort the material list by category sort order, then assigned-first, then
  // name — feeds the group split so order within each group respects the setting.
  const sortedFilteredMaterials = useMemo(() => sortMaterialsForAssignment(filteredMaterials), [filteredMaterials])

  // Build grouped + ungrouped structure for material display
  const groupedFilteredMaterials = useMemo(
    () => groupMaterialsForAssignment(sortedFilteredMaterials, materialGroups),
    [sortedFilteredMaterials, materialGroups],
  )

  return {
    searchRef,
    searchQuery,
    setSearchQuery,
    categoryFilter,
    setCategoryFilter,
    typeFilter,
    setTypeFilter,
    showOnlyAssignedVehicles,
    setShowOnlyAssignedVehicles,
    categories,
    materialTypeGroups,
    sortedFilteredPersonnel,
    filteredVehicles,
    groupedFilteredMaterials,
    query,
    activeFilterLabels,
    filtersActive,
    filteredCount,
    emptyReason,
    resetFilters,
    clearSearch,
  }
}
