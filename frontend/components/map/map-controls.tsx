/** The Lagekarte's own controls over the map, laid out by MapView: fit-all and the
 *  «ohne Koordinaten» chip. */

import type { Map as MlMap } from "maplibre-gl"
import { AlertTriangle, ChevronDown, Maximize } from "lucide-react"
import { useTranslations } from "next-intl"
import type { MapIncident } from "@/lib/map-incident"
import { fitTo } from "@/lib/map-view"
import { Reveal } from "@/components/ui/reveal"
import { locatedPoints, type FitPadding } from "./use-map-camera"

/**
 * «Alle Einsätze einpassen» — the one map control that was missing.
 *
 * The map auto-fits ONCE on mount (see useFitBoundsOnce) and then never again, so the moment a
 * new incident comes in outside the current view, or somebody pans away, getting back to «show me
 * everything» meant pinching around until it looked right.
 *
 * Positioned over the map like the legend. Pointer events are stopped so pressing it never
 * doubles as a map drag.
 */
export function FitAllButton({
  map,
  incidents,
  padding,
  floating,
}: {
  map: MlMap | null
  incidents: MapIncident[]
  padding: FitPadding
  /** The phone Lagekarte: under the zoom buttons on the RIGHT, in the floating family's shape. */
  floating: boolean
}) {
  const t = useTranslations('map')
  const points = locatedPoints(incidents)
  if (!map || points.length === 0) return null
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        // padding keeps a marker's label off the edge; maxZoom stops a single incident from
        // slamming to street level, which loses all context
        fitTo(map, points, { padding: padding(60), maxZoom: 16, duration: 600 })
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      // Under the zoom buttons, which are 44px tall each on a touch screen (top-[106px]). It sat
      // at 88px over the «−» for as long as nobody saw it: the button never rendered until the
      // map fired `load`, and that never happened before the worker fix (base-map.tsx).
      className={`absolute z-map-control flex items-center justify-center rounded-md border border-border bg-card/95 shadow-md backdrop-blur-sm hover:bg-card ${
        floating ? `right-2.5 top-[158px] size-11` : 'left-3 top-[88px] h-9 w-9 pointer-coarse:top-[106px] pointer-coarse:size-11'
      }`}
      title={t('fitAll')}
      aria-label={t('fitAll')}
    >
      <Maximize className="h-4 w-4 text-foreground" aria-hidden="true" />
    </button>
  )
}

/**
 * Incidents without valid coordinates: a compact chip in the map's top-right corner.
 *
 * It used to be a centred amber banner that wrapped to three lines on a phone and sat over the
 * middle of the map – exactly where the markers are (owner, iPhone, 02.10.2026). Now one line:
 * the amber glyph carries the tone (the surface stays neutral, like every message surface), the
 * count and «ohne Koordinaten» say what it is, and a tap opens the same list as before. The zoom
 * buttons own the top-left corner, the ⓘ and the legend the bottom-right.
 */
export function MissingLocationsWarning({
  incidents,
  onIncidentClick,
  isExpanded,
  setIsExpanded,
  alignStart,
}: {
  incidents: MapIncident[]
  onIncidentClick?: (incidentId: string) => void
  /** The chip stands at the row's start (the phone Lagekarte): its list hangs to the right. */
  alignStart: boolean
  /** Owned by MapView: while the list is open the legend folds to its pill (owner pick r28 2A). */
  isExpanded: boolean
  setIsExpanded: (open: boolean) => void
}) {
  const t = useTranslations('map')

  if (incidents.length === 0) return null

  return (
    // Not positioned itself: it is one item of the map's top-right control row (see MapView), so
    // a page's own controls sit beside it instead of on top of it. The list hangs below the chip.
    <div className={`relative flex flex-col ${alignStart ? 'items-start' : 'items-end'}`}>
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        aria-expanded={isExpanded}
        aria-label={t('view.missingCoordsAria', { count: incidents.length })}
        title={t('view.missingCoordsAria', { count: incidents.length })}
        className="flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-card/95 pl-2.5 pr-2 text-xs font-medium text-foreground shadow-md backdrop-blur-sm hover:bg-card pointer-coarse:h-9"
      >
        <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" aria-hidden="true" />
        <span className="tabular-nums">{t('view.missingCoordsChip', { count: incidents.length })}</span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${isExpanded ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>

      {/* Slides open/closed (Reveal) — the list used to pop in at full height. */}
      <Reveal open={isExpanded} className={`absolute top-full w-max min-w-48 max-w-[min(18rem,calc(100vw-5rem))] ${alignStart ? 'left-0' : 'right-0'}`}>
        <ul data-map-chrome className="mt-1.5 w-full max-h-60 space-y-0.5 overflow-y-auto rounded-lg border border-border bg-card/95 p-1 text-sm text-foreground shadow-md backdrop-blur-sm">
          {incidents.map((incident) => (
            <li key={incident.id}>
              <button
                type="button"
                className="w-full min-w-0 break-words rounded px-2 py-1.5 text-left font-medium transition-colors hover:bg-muted"
                onClick={(e) => {
                  e.stopPropagation()
                  onIncidentClick?.(incident.id)
                }}
                title={t('view.clickToNavigate')}
              >
                {incident.title}
              </button>
            </li>
          ))}
        </ul>
      </Reveal>
    </div>
  )
}
