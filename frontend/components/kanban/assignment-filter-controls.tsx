"use client"

import { useTranslations } from "next-intl"
import { SearchInput } from "@/components/ui/search-input"
import { Button } from "@/components/ui/button"
import { Truck, SlidersHorizontal, X } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useCompactFilters } from "@/lib/hooks/use-compact-filters"
import { cn } from "@/lib/utils"
import { MaterialTypeChips } from "@/components/kanban/material-assignment-list"
import type { AssignmentFilters, AssignmentResource } from "@/components/kanban/assignment-filters"

/** The radio value for «no filter» in the compact filter menu. */
const ALL_FILTER = "__all__"
/** Radix menus close on every pick; the filter menu stays open so two filters
 *  are two taps, not two trips. Outside / Escape still closes it. */
const keepMenuOpen = (event: Event) => event.preventDefault()

/**
 * The search and the filters above the list of `ResourceAssignmentDialog` — the same on the
 * dialog, the phone sheet and the Einsatz-Detail step. Draws `filters` from
 * `useAssignmentFilters`: chip rows on a wide screen, one «Filtern» menu where filters are
 * compact. `assignedVehicleNames` marks a material depot that is already on scene.
 */
export function AssignmentFilterControls({
  filters,
  resourceType,
  assignedVehicleNames,
}: {
  filters: AssignmentFilters
  resourceType: AssignmentResource | null
  assignedVehicleNames: string[]
}) {
  const t = useTranslations('kanban')
  const tEmpty = useTranslations('common.emptyState')
  const compactFilters = useCompactFilters()
  const {
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
    query,
    activeFilterLabels,
    filtersActive,
    filteredCount,
    emptyReason,
    resetFilters,
  } = filters

  const searchField = (
    <SearchInput
      ref={searchRef}
      containerClassName={compactFilters ? "min-w-0 flex-1" : undefined}
      placeholder={
        resourceType === 'crew' ? t('assignmentDialog.searchCrew')
          : resourceType === 'vehicles' ? t('assignmentDialog.searchVehicles')
            : resourceType === 'materials' ? t('assignmentDialog.searchMaterials')
              : t('common.search')
      }
      value={searchQuery}
      onValueChange={setSearchQuery}
      count={query && filteredCount > 0 ? t('assignmentDialog.hits', { count: filteredCount }) : undefined}
    />
  )

  // The compact «Filtern» menu (#24): the same filters as the chip rows, in
  // one place. Single-choice groups are radio groups with «Alle»; the menu
  // stays open between picks.
  const categoryGroupLabel =
    resourceType === 'crew' ? t('assignmentDialog.filterGroupRank')
      : resourceType === 'vehicles' ? t('assignmentDialog.filterGroupVehicleType')
        : t('assignmentDialog.filterGroupDepot')
  const hasFilterMenu =
    categories.length > 1 || materialTypeGroups.length > 1 || resourceType === 'vehicles'
  const filterMenu = hasFilterMenu ? (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="shrink-0 gap-1.5"
          aria-label={
            filtersActive
              ? `${t('assignmentDialog.filterButton')}, ${t('assignmentDialog.filterActiveCount', { count: activeFilterLabels.length })}`
              : t('assignmentDialog.filterButton')
          }
        >
          <SlidersHorizontal aria-hidden="true" />
          {t('assignmentDialog.filterButton')}
          {filtersActive && (
            <span
              aria-hidden="true"
              className="min-w-4 rounded-sm bg-foreground px-1 text-2xs font-bold leading-4 text-background tabular-nums"
            >
              {activeFilterLabels.length}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        {categories.length > 1 && (
          <>
            <DropdownMenuLabel className="text-xs text-muted-foreground">{categoryGroupLabel}</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={categoryFilter ?? ALL_FILTER}
              onValueChange={(value) => setCategoryFilter(value === ALL_FILTER ? null : value)}
            >
              <DropdownMenuRadioItem value={ALL_FILTER} onSelect={keepMenuOpen}>
                {t('assignmentDialog.all')}
              </DropdownMenuRadioItem>
              {categories.map((cat) => (
                <DropdownMenuRadioItem key={cat} value={cat} onSelect={keepMenuOpen}>
                  {resourceType === 'materials' && assignedVehicleNames.includes(cat) && (
                    <Truck className="h-3 w-3 text-foreground" aria-hidden="true" />
                  )}
                  {cat}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </>
        )}
        {materialTypeGroups.length > 1 && (
          <>
            {categories.length > 1 && <DropdownMenuSeparator />}
            <DropdownMenuLabel className="text-xs text-muted-foreground">{t('assignmentDialog.filterGroupMaterialType')}</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={typeFilter ?? ALL_FILTER}
              onValueChange={(value) => setTypeFilter(value === ALL_FILTER ? null : value)}
            >
              <DropdownMenuRadioItem value={ALL_FILTER} onSelect={keepMenuOpen}>
                {t('assignmentDialog.all')}
              </DropdownMenuRadioItem>
              {materialTypeGroups.map(({ type, count }) => (
                <DropdownMenuRadioItem key={type} value={type} onSelect={keepMenuOpen}>
                  {type} ({count})
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </>
        )}
        {resourceType === 'vehicles' && (
          <>
            {categories.length > 1 && <DropdownMenuSeparator />}
            <DropdownMenuLabel className="text-xs text-muted-foreground">{t('assignmentDialog.filterGroupAssignment')}</DropdownMenuLabel>
            <DropdownMenuCheckboxItem
              checked={showOnlyAssignedVehicles}
              onCheckedChange={(checked) => setShowOnlyAssignedVehicles(checked === true)}
              onSelect={keepMenuOpen}
            >
              {t('common.onlyAssignedVehicles')}
            </DropdownMenuCheckboxItem>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!filtersActive} onSelect={resetFilters}>
          <X aria-hidden="true" />
          {tEmpty('resetFilters')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ) : null

  // Search — the shared field: one focus look (the `ring` token), «Suche leeren», a hit count
  // while searching. Its own animated ring is gone.
  return (
    <>
      {compactFilters ? (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            {searchField}
            {filterMenu}
          </div>
          {filtersActive && (
            // What is filtered, readable without opening the menu, and the
            // one-step way back.
            <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground" data-testid="filter-summary">
              <span className="min-w-0 truncate">
                {t('assignmentDialog.filterSummary', { filters: activeFilterLabels.join(' · ') })}
              </span>
              {/* Not twice: an emptied list offers the same reset as its one action. */}
              {emptyReason !== 'filter' && (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="shrink-0 cursor-pointer underline underline-offset-2 decoration-muted-foreground/50 hover:text-foreground"
                >
                  {tEmpty('resetFilters')}
                </button>
              )}
            </div>
          )}
        </div>
      ) : (
        <>
      {searchField}

      {/* Quick category filter — rank (crew), depot (material), type (vehicles) */}
      {categories.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setCategoryFilter(null)}
            className={cn(
              "cursor-pointer px-2.5 py-1 rounded-full text-xs border transition-colors",
              categoryFilter === null
                ? "bg-sel-wash text-sel-foreground border-sel-edge"
                : "bg-muted/50 text-muted-foreground border-border hover:bg-muted"
            )}
          >
            {t('assignmentDialog.all')}
          </button>
          {categories.map((cat) => {
            // A material depot/location that matches an already-assigned
            // vehicle (e.g. "MoWa") — flag it so the operator sees at a glance
            // which stock is already on scene. Materials only; matched by name.
            // A fact, so ink text + truck glyph – never green (frei only).
            const vehiclePresent = resourceType === 'materials' && assignedVehicleNames.includes(cat)
            const isActive = categoryFilter === cat
            return (
              <button
                key={cat}
                onClick={() => setCategoryFilter(isActive ? null : cat)}
                title={vehiclePresent ? t('assignmentDialog.vehicleOnSceneHint', { name: cat }) : undefined}
                className={cn(
                  "inline-flex cursor-pointer items-center gap-1 px-2.5 py-1 rounded-full text-xs border transition-colors",
                  isActive
                    ? "bg-sel-wash text-sel-foreground border-sel-edge"
                    : vehiclePresent
                      ? "bg-muted/50 text-foreground border-border hover:bg-muted"
                      : "bg-muted/50 text-muted-foreground border-border hover:bg-muted"
                )}
              >
                {vehiclePresent && <Truck className="h-3 w-3 flex-shrink-0" />}
                {cat}
              </button>
            )
          })}
        </div>
      )}

      {/* Materials: second chip row — FILTER the list to one functional type
          (e.g. "Wasser") across all depots. Filters only, selects nothing. */}
      {materialTypeGroups.length > 1 && (
        <MaterialTypeChips typeGroups={materialTypeGroups} typeFilter={typeFilter} onTypeFilterChange={setTypeFilter} />
      )}

      {/* Vehicles-only quick filter: show only vehicles already assigned. */}
      {resourceType === 'vehicles' && (
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setShowOnlyAssignedVehicles((v) => !v)}
            className={cn(
              "cursor-pointer px-2.5 py-1 rounded-full text-xs border transition-colors",
              showOnlyAssignedVehicles
                ? "bg-sel-wash text-sel-foreground border-sel-edge"
                : "bg-muted/50 text-muted-foreground border-border hover:bg-muted"
            )}
          >
            {t('common.onlyAssignedVehicles')}
          </button>
        </div>
      )}

        </>
      )}
    </>
  )
}
