"use client"

/**
 * The Material-Leiste: the depots, identical devices folded into one counted
 * row, module blocks, «nicht einsatzbereit» at the bottom of each depot, the
 * «vor Ort» roll-up above the list and the availability counter at the foot.
 *
 * Presentational: the board page owns every value and handler and passes them
 * in under the names it uses itself, so this JSX is the page's, moved verbatim
 * (2026-09-23). The rows keep their own pragmatic-dnd `draggable`s on the same
 * elements as before.
 */

import type { Dispatch, SetStateAction } from "react"
import { useTranslations } from "next-intl"
import { Check, ChevronRight } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Kbd } from "@/components/ui/kbd"
import { SearchInput } from "@/components/ui/search-input"
import { MaterialGroupBlock } from "@/components/kanban/material-group-block"
import { MaterialOnSitePanel, type selectMaterialOnSite } from "@/components/kanban/material-on-site-panel"
import { ResourcesNotLoaded } from "@/components/board-load-error"
import {
  AggregatedMaterialRow,
  AvailableOnlyToggle,
  MaterialSidebarRow,
  SidebarEmpty,
  SidebarLoading,
} from "@/components/board/sidebar-parts"
import { aggregateByName, type BindingsPopoverState, type ResourceBinding } from "@/lib/board-sidebar"
import type { Material } from "@/lib/contexts/operations-context"
import type { MaterialGroup } from "@/lib/contexts/materials-context"
import type { useResourceFiltering } from "@/lib/hooks/use-resource-filtering"
import type { summarizeMaterials } from "@/lib/resource-status"

export interface MaterialSidebarProps {
  setShowRightSidebar: Dispatch<SetStateAction<boolean>>
  materialSearchQuery: string
  setMaterialSearchQuery: Dispatch<SetStateAction<string>>
  /** The board's own search — cleared when it, not the sidebar's, hides everything. */
  setSearchQuery: Dispatch<SetStateAction<string>>
  isMobile: boolean
  materialsAvailableOnly: boolean
  setMaterialsAvailableOnly: Dispatch<SetStateAction<boolean>>
  materialOnSiteEntries: ReturnType<typeof selectMaterialOnSite>
  openIncidentDetail: (operationId: string) => void
  isLoaded: boolean
  /** Loaded and failed with nothing ever shown — see `boardNeverLoaded` in the operations context. */
  boardNeverLoaded: boolean
  isEditor: boolean
  materials: Material[]
  materialGroups: MaterialGroup[]
  groupedMaterials: ReturnType<typeof useResourceFiltering>["groupedMaterials"]
  filteredMaterials: Material[]
  effectiveMaterialQuery: string
  handleMaterialClick: (material: Material) => void
  handleAggregateMaterialClick: (units: Material[]) => void
  handleToggleMaterialOutOfService: (material: Material, outOfService: boolean) => void
  bindingsPopover: BindingsPopoverState | null
  setBindingsPopover: Dispatch<SetStateAction<BindingsPopoverState | null>>
  followBinding: (binding: ResourceBinding) => void
  materialSummary: ReturnType<typeof summarizeMaterials>
}

export function MaterialSidebar({
  setShowRightSidebar,
  materialSearchQuery,
  setMaterialSearchQuery,
  setSearchQuery,
  isMobile,
  materialsAvailableOnly,
  setMaterialsAvailableOnly,
  materialOnSiteEntries,
  openIncidentDetail,
  isLoaded,
  boardNeverLoaded,
  isEditor,
  materials,
  materialGroups,
  groupedMaterials,
  filteredMaterials,
  effectiveMaterialQuery,
  handleMaterialClick,
  handleAggregateMaterialClick,
  handleToggleMaterialOutOfService,
  bindingsPopover,
  setBindingsPopover,
  followBinding,
  materialSummary,
}: MaterialSidebarProps) {
  const tCommon = useTranslations('kanban.common')
  const tDash = useTranslations('kanban.dashboard')
  return (
      <aside className="relative z-10 w-64 border-l border-border bg-card/30 backdrop-blur-sm flex flex-col">
        {/* Collapse handle — small chevron centered on the sidebar's inner edge */}
        <button
          onClick={() => setShowRightSidebar(false)}
          className="absolute left-0 top-1/2 -translate-x-1/2 z-20 flex h-12 w-5 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:bg-secondary/60 hover:text-foreground"
          title={`${tDash('toggleRightSidebar')} (])`}
          aria-label={tDash('toggleRightSidebar')}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        {/* Search */}
        <div className="flex items-center gap-1.5 px-3 pt-3 pb-2">
          <SearchInput
            id="material-search-input"
            size="sm"
            containerClassName="flex-1 min-w-0"
            placeholder={tDash('materialSearch')}
            value={materialSearchQuery}
            onValueChange={setMaterialSearchQuery}
            className="h-8 text-sm"
            hint={!isMobile ? <Kbd>M</Kbd> : undefined}
          />
          <AvailableOnlyToggle
            active={materialsAvailableOnly}
            onToggle={() => setMaterialsAvailableOnly((v) => !v)}
            label={materialsAvailableOnly ? tDash('showAll') : tDash('showAvailableOnly')}
          />
        </div>
        {/* «Vor Ort» roll-up — above the scroll area on purpose, so neither
            the search nor «nur verfügbare» (which hides everything that is
            assigned, i.e. exactly this material) can filter the answer to
            "what is still out there" away. Renders nothing at zero. */}
        <MaterialOnSitePanel entries={materialOnSiteEntries} onOpenIncident={openIncidentDetail} />
        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto overscroll-y-contain pl-4 pr-2 pt-1 pb-3">
          {!isLoaded ? (
            <SidebarLoading label={tDash('materialLoading')} />
          ) : boardNeverLoaded ? (
            <ResourcesNotLoaded label={tDash('notLoaded')} />
          ) : materials.length === 0 ? (
            /* A fresh station: no Gerät has ever been recorded. The same
               shape the Personal sidebar has always had for «niemand
               angemeldet», down to naming the next step — the material
               sidebar used to leave a bare box here. The link is for
               editors: the section it points at is editor-only. */
            <SidebarEmpty
              message={tDash('noMaterialYet')}
              action={isEditor ? tDash('createMaterialInSettings') : undefined}
              actionHref="/settings?section=materials"
            />
          ) : Object.keys(groupedMaterials).length === 0 ? (
            effectiveMaterialQuery ? (
              <SidebarEmpty
                message={tDash.rich('noMaterialMatch', {
                  query: effectiveMaterialQuery,
                  term: (chunks) => <span className="text-foreground">{chunks}</span>,
                })}
                action={tDash('resetSearch')}
                onAction={() => {
                  if (materialSearchQuery) setMaterialSearchQuery('')
                  else setSearchQuery('')
                }}
              />
            ) : (
              <SidebarEmpty
                message={tDash('noneAvailableFiltered')}
                action={tDash('showAll')}
                onAction={() => setMaterialsAvailableOnly(false)}
              />
            )
          ) : (
            <div className="space-y-4 animate-in fade-in duration-300">
              {Object.entries(groupedMaterials).map(([category, items]) => {
                // «Nicht einsatzbereit» leaves the module blocks and the
                // normal rows and sinks to the bottom of its depot: a
                // module whose contents are half defective must not read
                // as ready, and a dead device must not sit in the middle
                // of the pickable ones.
                const readyItems = items.filter(m => !m.outOfService)
                const outOfServiceItems = items.filter(m => m.outOfService)
                const ungroupedItems = readyItems.filter(m => !m.groupId)
                const groupedItems = new Map<string, Material[]>()
                for (const m of readyItems.filter(m => m.groupId)) {
                  const group = materialGroups.find(g => g.id === m.groupId)
                  if (group) {
                    if (!groupedItems.has(group.id)) groupedItems.set(group.id, [])
                    groupedItems.get(group.id)!.push(m)
                  } else {
                    ungroupedItems.push(m)
                  }
                }
                return (
                  <div key={category}>
                    {/* Caps like every sidebar heading — a depot label
                        must not read as a device. */}
                    <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{category}</h3>
                    <div className="space-y-0.5">
                      {/* Material groups/blocks */}
                      {Array.from(groupedItems.entries()).map(([groupId, groupMaterials]) => {
                        const group = materialGroups.find(g => g.id === groupId)!
                        const allAvailable = groupMaterials.every(m => m.status === 'available')
                        const someAssigned = groupMaterials.some(m => m.status === 'assigned')
                        const allAssigned = groupMaterials.every(m => m.status === 'assigned')
                        return (
                          <MaterialGroupBlock
                            key={groupId}
                            group={group}
                            materials={groupMaterials}
                            allAvailable={allAvailable}
                            someAssigned={someAssigned}
                            allAssigned={allAssigned}
                            onMaterialClick={handleMaterialClick}
                          />
                        )
                      })}
                      {/* Ungrouped materials — identical devices fold
                          into one counted row (see AggregatedMaterialRow);
                          consumables and singletons keep their own row.
                          Then the ones that cannot go out. */}
                      {aggregateByName(ungroupedItems).map((bundle) =>
                        bundle.length > 1 ? (
                          <AggregatedMaterialRow
                            key={bundle[0].id}
                            units={bundle}
                            onOpenBindings={handleAggregateMaterialClick}
                            onToggleOutOfService={handleToggleMaterialOutOfService}
                            bindingsPopover={bindingsPopover}
                            onCloseBindings={() => setBindingsPopover(null)}
                            onGoBinding={followBinding}
                          />
                        ) : (
                          <MaterialSidebarRow
                            key={bundle[0].id}
                            material={bundle[0]}
                            onClick={() => handleMaterialClick(bundle[0])}
                            onToggleOutOfService={handleToggleMaterialOutOfService}
                            bindingsPopover={bindingsPopover}
                            onCloseBindings={() => setBindingsPopover(null)}
                            onGoBinding={followBinding}
                          />
                        ),
                      )}
                      {outOfServiceItems.map((material) => (
                        <MaterialSidebarRow
                          key={material.id}
                          material={material}
                          onClick={() => handleMaterialClick(material)}
                          onToggleOutOfService={handleToggleMaterialOutOfService}
                          bindingsPopover={bindingsPopover}
                          onCloseBindings={() => setBindingsPopover(null)}
                          onGoBinding={followBinding}
                        />
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
        {/* Fixed availability counter at bottom — see the left sidebar,
            including why it has three states. */}
        <div className="px-4 py-2 bg-card/50 backdrop-blur-sm">
          <p className="text-xs text-muted-foreground text-center">
            {!isLoaded || boardNeverLoaded
              ? tCommon('counterLoading')
              : effectiveMaterialQuery
                ? tCommon('visibleCounter', { shown: filteredMaterials.length, total: materials.length })
                : null}
          </p>
          {/* Same helper as the list filter — see the crew footer above. */}
          {isLoaded && !boardNeverLoaded && !effectiveMaterialQuery && (
            <div className="flex items-center justify-center gap-2 text-xs">
              <span className="inline-flex items-center gap-1 font-semibold text-emerald-600 dark:text-emerald-400">
                <Check className="size-3.5" />
                {tCommon('rosterFree', { count: materialSummary.free })}
              </span>
              <span className="text-muted-foreground">{tCommon('rosterOf', { total: materialSummary.total })}</span>
              {materialSummary.bound > 0 && (
                <Badge variant="outline" className="border-amber-200 text-amber-700 dark:border-amber-800/50 dark:text-amber-400">
                  {tCommon('rosterBound', { count: materialSummary.bound })}
                </Badge>
              )}
            </div>
          )}
        </div>
      </aside>
  )
}
