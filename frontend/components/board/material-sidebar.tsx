"use client"

/**
 * The Material-Leiste: the depots (or, sorted by Typ, the types and their
 * depots), identical devices folded into one counted row, module blocks,
 * «nicht einsatzbereit» at the bottom of each depot, the «Filter & Sortierung»
 * popover (`material-filter.tsx`, rule in `lib/material-view.ts`), the
 * «vor Ort» roll-up above the list and the availability counter at the foot.
 *
 * Presentational: the board page owns every value and handler and passes them
 * in under the names it uses itself, so this JSX is the page's, moved verbatim
 * (2026-09-23). The rows keep their own pragmatic-dnd `draggable`s on the same
 * elements as before.
 */

import { FELD_TARGET } from "@/lib/detail-target"
import { type OperationDetailTab } from "@/lib/hooks/use-operation-detail-shortcuts"
import { useMemo, useRef, type Dispatch, type SetStateAction } from "react"
import { useTranslations } from "next-intl"
import { ChevronRight, PanelRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import { ScrollEndFade } from "@/components/ui/scroll-end-fade"
import { SearchInput } from "@/components/ui/search-input"
import { ShortcutTooltip } from "@/components/ui/shortcut-tooltip"
import { MaterialGroupBlock } from "@/components/kanban/material-group-block"
import { MaterialOnSitePanel, type selectMaterialOnSite } from "@/components/kanban/material-on-site-panel"
import { useCollectMaterial } from "@/lib/hooks/use-collect-material"
import { ResourcesNotLoaded } from "@/components/board-load-error"
import {
  AggregatedMaterialRow,
  MaterialSidebarRow,
  SidebarCounter,
  SidebarEmpty,
  SidebarLoading,
} from "@/components/board/sidebar-parts"
import { MaterialFilterButton, MaterialFilterSummary, useMaterialLabels } from "@/components/board/material-filter"
import { aggregateByName, type BindingsPopoverState, type ResourceBinding } from "@/lib/board-sidebar"
import type { Material } from "@/lib/contexts/operations-context"
import type { MaterialGroup } from "@/lib/contexts/materials-context"
import {
  DEFAULT_MATERIAL_VIEW,
  materialFacets,
  materialFilterCount,
  viewMaterials,
  withoutStaleValues,
  type MaterialViewPrefs,
} from "@/lib/material-view"
import type { summarizeMaterials } from "@/lib/resource-status"

export interface MaterialSidebarProps {
  setShowRightSidebar: Dispatch<SetStateAction<boolean>>
  materialSearchQuery: string
  setMaterialSearchQuery: Dispatch<SetStateAction<string>>
  /** The board's own search — cleared when it, not the sidebar's, hides everything. */
  setSearchQuery: Dispatch<SetStateAction<string>>
  isMobile: boolean
  /** «Filter & Sortierung», remembered per browser by the board page. */
  materialView: MaterialViewPrefs
  setMaterialView: Dispatch<SetStateAction<MaterialViewPrefs>>
  materialOnSiteEntries: ReturnType<typeof selectMaterialOnSite>
  openIncidentDetail: (operationId: string, tab?: OperationDetailTab) => void
  isLoaded: boolean
  /** Loaded and failed with nothing ever shown — see `boardNeverLoaded` in the operations context. */
  boardNeverLoaded: boolean
  isEditor: boolean
  materials: Material[]
  materialGroups: MaterialGroup[]
  /** What the search left; the filters narrow this further (`viewMaterials`). */
  filteredMaterials: Material[]
  effectiveMaterialQuery: string
  /** A device drawn as its own row – the row anchors the bindings popover. */
  handleMaterialClick: (material: Material) => void
  /** A device inside a module block, which has no anchor: jumps to its first binding. */
  handleModuleMaterialClick: (material: Material) => void
  handleAggregateMaterialClick: (units: Material[]) => void
  handleToggleMaterialOutOfService: (material: Material, outOfService: boolean) => void
  bindingsPopover: BindingsPopoverState | null
  setBindingsPopover: Dispatch<SetStateAction<BindingsPopoverState | null>>
  followBinding: (binding: ResourceBinding) => void
  /** Reopen the Einsatz-Detail side panel. Passed only while it is collapsed; the button
   *  exists from SIDE_PANEL_BREAKPOINT (2xl) up, like the panel. */
  onOpenSidePanel?: () => void
  materialSummary: ReturnType<typeof summarizeMaterials>
}

export function MaterialSidebar({
  setShowRightSidebar,
  materialSearchQuery,
  setMaterialSearchQuery,
  setSearchQuery,
  isMobile,
  materialView,
  setMaterialView,
  materialOnSiteEntries,
  openIncidentDetail,
  isLoaded,
  boardNeverLoaded,
  isEditor,
  materials,
  materialGroups,
  filteredMaterials,
  effectiveMaterialQuery,
  handleMaterialClick,
  handleModuleMaterialClick,
  handleAggregateMaterialClick,
  handleToggleMaterialOutOfService,
  bindingsPopover,
  setBindingsPopover,
  followBinding,
  materialSummary,
  onOpenSidePanel,
}: MaterialSidebarProps) {
  const tCommon = useTranslations('kanban.common')
  const tDash = useTranslations('kanban.dashboard')
  const tSidePanel = useTranslations('kanban.sidePanel')
  const labels = useMaterialLabels()
  // A saved Standort or Typ the catalogue lost (a renamed depot) is dropped – once the catalogue
  // is in; while it loads every value looks gone. The popover writes this view back, so the
  // stored one is cleaned with the next change.
  const catalogueLoaded = isLoaded && !boardNeverLoaded && materials.length > 0
  const view = useMemo(
    () => (catalogueLoaded ? withoutStaleValues(materialView, materials) : materialView),
    [catalogueLoaded, materialView, materials],
  )
  const { shown, groups } = useMemo(() => viewMaterials(filteredMaterials, view), [filteredMaterials, view])
  const facets = useMemo(() => materialFacets(filteredMaterials, view), [filteredMaterials, view])
  const filtering = materialFilterCount(view) > 0
  const byType = view.sort === 'type'
  const resetView = () => setMaterialView(DEFAULT_MATERIAL_VIEW)
  const filterButtonRef = useRef<HTMLButtonElement>(null)

  /** One depot's devices: module blocks (by depot only – by Typ a module would show a
   *  fragment of itself), the folded rows, then the ones that cannot go out. */
  const placeRows = (items: Material[]) => {
    // «Nicht einsatzbereit» leaves the module blocks and the normal rows and
    // sinks to the bottom of its depot: a module whose contents are half
    // defective must not read as ready, and a dead device must not sit in the
    // middle of the pickable ones.
    const readyItems = items.filter(m => !m.outOfService)
    const outOfServiceItems = items.filter(m => m.outOfService)
    const ungroupedItems = readyItems.filter(m => byType || !m.groupId)
    const groupedItems = new Map<string, Material[]>()
    for (const m of byType ? [] : readyItems.filter(m => m.groupId)) {
      const group = materialGroups.find(g => g.id === m.groupId)
      if (group) {
        if (!groupedItems.has(group.id)) groupedItems.set(group.id, [])
        groupedItems.get(group.id)!.push(m)
      } else {
        ungroupedItems.push(m)
      }
    }
    return (
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
              onMaterialClick={handleModuleMaterialClick}
            />
          )
        })}
        {/* Ungrouped materials — identical devices fold into one counted row
            (see AggregatedMaterialRow); consumables and singletons keep their
            own row. Then the ones that cannot go out. */}
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
    )
  }

  const collectMaterial = useCollectMaterial()
  return (
      // Sized and layered by its SlideRail (app/page.tsx), as the Personen-Leiste. The detail's
      // reopen control takes 28px of the search row (below); the rail grows by them
      // (`--rail-extra`, set there) rather than clipping «Material suchen …».
      <aside className="relative w-full border-l border-border bg-card/30 flex flex-col">
        {/* Collapse handle — small chevron centered on the sidebar's inner edge. `min-w-0`
            (on all five edge tabs): the ≤768px 44px touch-target rule widened it to 44px at
            exactly 768, where the board is still the desktop board, and it lay on the
            «Depot» heading (overflow sweep, 03.10.). */}
        <ShortcutTooltip label={tDash('toggleRightSidebar')} keys={['W']} side="left">
          <button
            onClick={() => setShowRightSidebar(false)}
            className="absolute hit-area left-0 top-1/2 -translate-x-1/2 z-pinned flex h-12 w-5 min-w-0 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:bg-secondary/60 hover:text-foreground"
            aria-label={tDash('toggleRightSidebar')}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </ShortcutTooltip>
        {/* Search. While the Einsatz-Detail panel is collapsed, the control that reopens it
            leads this row, at the edge where the panel will open: it used to be a tab pinned
            over the board's top-right corner, on the header of whatever column scrolled
            under it (hill climb r18). Edge tabs are for a strip with 0px left on screen –
            this sidebar is on screen, so the control sits inside it. 24px wide (a mouse
            target); the aside grows by its room, so the field keeps «Material suchen …». */}
        <div className="flex items-center gap-1 px-2 pt-3 pb-2">
          {onOpenSidePanel && (
            <ShortcutTooltip label={tSidePanel('railLabel')} keys={['I']} side="bottom">
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={onOpenSidePanel}
                className="hidden min-w-6 w-6 shrink-0 text-muted-foreground hover:text-foreground 2xl:inline-flex"
                aria-label={tSidePanel('railLabel')}
              >
                <PanelRight className="size-4" />
              </Button>
            </ShortcutTooltip>
          )}
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
          <MaterialFilterButton
            prefs={view}
            onChange={setMaterialView}
            facets={facets}
            shown={shown.length}
            total={materials.length}
            buttonRef={filterButtonRef}
          />
        </div>
        <MaterialFilterSummary prefs={view} onReset={resetView} buttonRef={filterButtonRef} />
        {/* «Vor Ort» roll-up — above the scroll area on purpose, so neither
            the search nor the filters (Frei hides everything that is
            assigned, i.e. exactly this material) can filter the answer to
            "what is still out there" away. Renders nothing at zero. */}
        {/* A row opens Feld: «Vor Ort verblieben» in the submitted Rapport lists the unit. */}
        <MaterialOnSitePanel
          entries={materialOnSiteEntries}
          onOpenIncident={(id) => openIncidentDetail(id, FELD_TARGET.tab)}
          onCollect={isEditor ? (target) => void collectMaterial(target) : undefined}
        />
        {/* Scrollable content – ends in the `ScrollEndFade`, as the Personen-Leiste. */}
        <div className="flex-1 overflow-y-auto overscroll-y-contain pl-4 pr-2 pt-1">
          {!isLoaded ? (
            <SidebarLoading label={tDash('materialLoading')} />
          ) : boardNeverLoaded ? (
            <ResourcesNotLoaded label={tDash('notLoaded')} />
          ) : materials.length === 0 ? (
            /* A fresh station: no Gerät has ever been recorded. The same
               shape the Personal sidebar has always had for «niemand
               anwesend», down to naming the next step — the material
               sidebar used to leave a bare box here. The link is for
               editors: the section it points at is editor-only. */
            <SidebarEmpty
              message={tDash('noMaterialYet')}
              action={isEditor ? tDash('createMaterialInSettings') : undefined}
              actionHref="/settings?section=materials"
            />
          ) : shown.length === 0 ? (
            /* The search or the filters hide every device. The search goes
               first: when it alone leaves nothing, resetting the filters would
               change nothing (as the Personen-Leiste). */
            filteredMaterials.length === 0 ? (
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
                message={tDash('materialFilter.none')}
                action={tDash('sidebarFilter.resetAll')}
                onAction={resetView}
              />
            )
          ) : (
            <div className="space-y-4">
              {groups.map(({ key, places }) => (
                <div key={key}>
                  {/* Caps like every sidebar heading — a depot or Typ label
                      must not read as a device. */}
                  <h3 className="mb-1 type-label text-muted-foreground">
                    {byType ? labels.type(key) : labels.location(key)}
                  </h3>
                  {byType ? (
                    /* By Typ the depot stays a sub-heading: identical devices
                       in two depots are two rows, and which is which matters. */
                    <div className="space-y-2">
                      {places.map(({ location, items }) => (
                        <div key={location}>
                          <p className="mb-0.5 type-micro text-muted-foreground">{labels.location(location)}</p>
                          {placeRows(items)}
                        </div>
                      ))}
                    </div>
                  ) : (
                    placeRows(places[0].items)
                  )}
                </div>
              ))}
            </div>
          )}
          <ScrollEndFade surface="panel" />
        </div>
        {/* Fixed availability counter at bottom — see the left sidebar,
            including why it has three states. */}
        <div className="px-4 py-2 bg-card/50 backdrop-blur-sm">
          <p className="text-xs text-muted-foreground text-center">
            {!isLoaded || boardNeverLoaded
              ? tCommon('counterLoading')
              : effectiveMaterialQuery || filtering
                ? tCommon('visibleCounter', { shown: shown.length, total: materials.length })
                : null}
          </p>
          {/* Same helper as the list filter — see the crew footer above. */}
          {isLoaded && !boardNeverLoaded && !effectiveMaterialQuery && !filtering && (
            <SidebarCounter summary={materialSummary} />
          )}
        </div>
      </aside>
  )
}
