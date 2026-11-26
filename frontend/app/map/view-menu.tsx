"use client"

import { useTranslations } from "next-intl"
import { Check, ChevronDown, Layers } from "lucide-react"
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Kbd } from "@/components/ui/kbd"
import type { ColorByDimension, ColorGroup } from "@/lib/kanban-utils"
import type { StatusGroup } from "@/lib/types/incidents"
import type { MapViewChange, MapViewOptions } from "./map-view-options"

/**
 * Plain-letter shortcuts for «Färben nach», German mnemonics: P­riorität,
 * Re**k**o-Person, F­ahrzeug, Einsatzart (= T­yp), A­uftrag. Ordered — the
 * Ansicht menu maps over this list, so the menu and the keys can't drift.
 * The letters s/z/e/r/l/i/g are already taken by other map shortcuts.
 */
export const COLOR_BY_SHORTCUTS: ReadonlyArray<readonly [key: string, dim: ColorByDimension]> = [
  ['p', 'priority'],
  ['k', 'reko'],
  ['f', 'vehicle'],
  ['t', 'type'],
  ['a', 'auftrag'],
]

/** The rail's tool buttons («Ansicht», «Auftrags-Editor», «Reko-Editor»): 28px, 12/500,
 *  `rounded-sm` like every control under 32px. The phone overrides height and type. */
export const RAIL_TOOL = 'flex h-7 items-center gap-1.5 rounded-sm border px-2.5 text-xs font-medium transition-colors'

/**
 * Ansicht — every map display option in one popover, on the desk's rail heading and beside the
 * phone's search. While any option differs from the defaults the button wears the selection
 * (wash + edge, as `variant="selected"`). Desktop: on the heading's row, right-aligned (the view
 * options of the list below it), so the tool row under it holds only the two editor modes and
 * never wraps 2 + 1 inside the 320px rail (hill climb r19). Phone: beside the search, floating
 * over the map in the floating family's card surface (the wash over it when changed) – the muted
 * tool wash beside a white field read as pressed (hill climb r21). 28px tall off the phone
 * (`rounded-sm`: controls under 32px), 44px on it. The phone's menu also holds the status groups
 * (the desk's are the rail's section headings).
 */
export function MapViewMenu({
  options,
  changeView,
  gpsAvailable,
  weatherAvailable,
  isMobile,
  statusGroupCounts,
  colorLegend,
}: {
  options: MapViewOptions
  changeView: (change: MapViewChange) => void
  gpsAvailable: boolean
  weatherAvailable: boolean
  isMobile: boolean
  statusGroupCounts: Record<StatusGroup, number>
  colorLegend: ColorGroup[]
}) {
  const t = useTranslations('map')
  const { statusFilters, showLabels, showAssignmentLines, showDistances, showGroupRoutes, showWeather, colorBy } = options
  const statusFiltered = isMobile && (!statusFilters.open || !statusFilters.active || statusFilters.completed)
  const viewChanged =
    !showLabels || (gpsAvailable && (!showAssignmentLines || showDistances)) || showGroupRoutes || colorBy !== 'priority' || (weatherAvailable && showWeather) || statusFiltered
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={`${RAIL_TOOL} max-md:h-11 max-md:shrink-0 max-md:rounded-md max-md:px-3 max-md:text-sm max-md:shadow-md max-md:backdrop-blur-sm ${
            viewChanged
              ? 'border-sel-edge bg-sel-wash text-sel-foreground max-md:bg-card max-md:bg-[image:linear-gradient(var(--sel-wash),var(--sel-wash))]'
              : 'bg-muted/50 text-muted-foreground border-border hover:bg-muted max-md:bg-card/95 max-md:text-foreground'
          }`}
          title={t('page.viewMenuLabel')}
        >
          <Layers className="h-3 w-3" />
          {t('page.view')}
          <ChevronDown className="h-3 w-3 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={isMobile ? 'start' : 'end'} collisionPadding={8} className="w-60">
        {/* The phone has no rail, so its status groups are here: which Einsätze the map shows. */}
        {isMobile && (
          <>
            <DropdownMenuLabel>{t('page.showGroups')}</DropdownMenuLabel>
            {(['open', 'active', 'completed'] as StatusGroup[]).map((group) => (
              <DropdownMenuCheckboxItem
                key={group}
                checked={statusFilters[group]}
                onSelect={(e) => { e.preventDefault(); changeView({ type: 'statusGroup', group }) }}
              >
                <span className="flex-1">{t(`statusGroups.${group}`)}</span>
                <span className="text-xs tabular-nums text-muted-foreground">{statusGroupCounts[group]}</span>
              </DropdownMenuCheckboxItem>
            ))}
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuLabel>{t('page.viewMenuLabel')}</DropdownMenuLabel>
        {/* e.preventDefault keeps the menu open so several options can
            be flipped in one visit (and the legend updates live). */}
        <DropdownMenuCheckboxItem
          checked={showLabels}
          onSelect={(e) => { e.preventDefault(); changeView({ type: 'toggle', option: 'showLabels' }) }}
        >
          <span className="flex-1">{t('page.labels')}</span>
          {!isMobile && <Kbd className="text-2xs">L</Kbd>}
        </DropdownMenuCheckboxItem>
        {/* Both are drawn from vehicle GPS — without it they are dead
            switches, so they only exist when GPS does. */}
        {gpsAvailable && (
          <>
            <DropdownMenuCheckboxItem
              checked={showAssignmentLines}
              onSelect={(e) => { e.preventDefault(); changeView({ type: 'toggle', option: 'showAssignmentLines' }) }}
            >
              <span className="flex-1">{t('page.lines')}</span>
              {!isMobile && <Kbd className="text-2xs">I</Kbd>}
            </DropdownMenuCheckboxItem>
            {/* Switching Distanz on switches «Linien» on too (changeMapView). */}
            <DropdownMenuCheckboxItem
              checked={showDistances}
              onSelect={(e) => { e.preventDefault(); changeView({ type: 'toggle', option: 'showDistances' }) }}
            >
              <span className="flex-1">{t('page.distance')}</span>
            </DropdownMenuCheckboxItem>
          </>
        )}
        {/* Switching this on also forces "Färben nach" to Auftrag.
            Silently taking over another control is the kind of thing
            that reads as a bug at 3am, so both ends say so: the cause
            here, the effect under the Färben-nach label below. */}
        <DropdownMenuCheckboxItem
          checked={showGroupRoutes}
          onSelect={(e) => { e.preventDefault(); changeView({ type: 'toggle', option: 'showGroupRoutes' }) }}
          className="items-start"
        >
          <span className="flex-1">
            {t('page.groupRoutes')}
            <span className="block text-[11px] leading-snug text-muted-foreground">
              {t('page.groupRoutesColorHint')}
            </span>
          </span>
        </DropdownMenuCheckboxItem>
        {weatherAvailable && (
          <DropdownMenuCheckboxItem
            checked={showWeather}
            onSelect={(e) => { e.preventDefault(); changeView({ type: 'weather', on: !showWeather }) }}
            className="items-start"
          >
            <span className="flex-1">
              {t('weather.layer')}
              <span className="block text-[11px] leading-snug text-muted-foreground">
                {t('weather.layerHint')}
              </span>
            </span>
          </DropdownMenuCheckboxItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{t('common.colorByMenuLabel')}</DropdownMenuLabel>
        {showGroupRoutes && colorBy === 'auftrag' && (
          <p className="px-2 pb-1.5 text-[11px] leading-snug text-muted-foreground">
            {t('page.colorByRoutesOverride')}
          </p>
        )}
        {COLOR_BY_SHORTCUTS.map(([key, dim]) => (
          <DropdownMenuItem
            key={dim}
            onSelect={(e) => { e.preventDefault(); changeView({ type: 'colorBy', colorBy: dim }) }}
            className="cursor-pointer"
          >
            <span className="flex-1">{t(`colorBy.${dim}`)}</span>
            {colorBy === dim && <Check className="h-3.5 w-3.5" />}
            {!isMobile && <Kbd className="text-2xs">{key.toUpperCase()}</Kbd>}
          </DropdownMenuItem>
        ))}
        {colorLegend.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <div className="px-2 py-1.5 space-y-1 max-h-48 overflow-y-auto overscroll-contain">
              {colorLegend.map((g) => (
                <div key={g.key} className="flex items-center gap-2 text-xs">
                  <span className="h-3 w-3 rounded-sm flex-shrink-0" style={{ backgroundColor: g.color }} />
                  <span className="truncate">{g.label}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
