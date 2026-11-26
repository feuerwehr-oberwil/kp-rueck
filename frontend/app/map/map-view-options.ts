import { useCallback, useEffect, useState } from "react"
import { COLOR_BY_STORAGE_KEY, type ColorByDimension } from "@/lib/kanban-utils"
import type { StatusGroup } from "@/lib/types/incidents"
import { readWeatherLayerPref, writeWeatherLayerPref } from "@/lib/weather"

/** Everything «Ansicht» on the Lagekarte decides: which Einsätze, which layers, which colours. */
export interface MapViewOptions {
  statusFilters: Record<StatusGroup, boolean>
  showLabels: boolean
  /** Zuweisungslinien and Distanz draw from vehicle GPS – the page offers them only with GPS. */
  showAssignmentLines: boolean
  showDistances: boolean
  showGroupRoutes: boolean
  /** «Wetter»: the radar layer – offered only when the backend serves weather. */
  showWeather: boolean
  colorBy: ColorByDimension
  /** Where «Färben nach» goes back to when an automatic colouring ends: «Aufträge anzeigen»
   *  colours by Auftrag, the Reko-Editor by Reko-Person. */
  colorByBefore: Record<'routes' | 'reko', ColorByDimension>
}

export const DEFAULT_MAP_VIEW_OPTIONS: MapViewOptions = {
  statusFilters: { open: true, active: true, completed: false },
  showLabels: true,
  showAssignmentLines: true,
  showDistances: false,
  showGroupRoutes: false,
  showWeather: false,
  colorBy: 'priority',
  colorByBefore: { routes: 'priority', reko: 'priority' },
}

export type MapViewChange =
  | { type: 'toggle'; option: 'showLabels' | 'showAssignmentLines' | 'showDistances' | 'showGroupRoutes' }
  | { type: 'statusGroup'; group: StatusGroup }
  /** The operator's own pick: the menu, P/K/F/T/A, the command palette. */
  | { type: 'colorBy'; colorBy: ColorByDimension }
  /** The Reko-Editor opens (colours by Reko-Person) or closes (back to the colouring before). */
  | { type: 'rekoColors'; on: boolean }
  | { type: 'weather'; on: boolean }
  /** What this device remembered, read once after mount. */
  | { type: 'restore'; colorBy: ColorByDimension | null; showWeather: boolean }

/**
 * The one way the Lagekarte's view options change (pure – `useMapViewOptions` stores and persists).
 * The couplings live here: Distanz on switches Linien on (a distance measures a line), and
 * «Aufträge anzeigen» and the Reko-Editor each colour the markers for as long as they are on.
 */
export function changeMapView(options: MapViewOptions, change: MapViewChange): MapViewOptions {
  switch (change.type) {
    case 'toggle': {
      const on = !options[change.option]
      if (change.option === 'showDistances') {
        return { ...options, showDistances: on, showAssignmentLines: on || options.showAssignmentLines }
      }
      if (change.option === 'showGroupRoutes') {
        if (on) {
          return {
            ...options,
            showGroupRoutes: true,
            colorBy: 'auftrag',
            colorByBefore: { ...options.colorByBefore, routes: options.colorBy },
          }
        }
        const colorBy = options.colorBy === 'auftrag' ? options.colorByBefore.routes : options.colorBy
        return { ...options, showGroupRoutes: false, colorBy }
      }
      return { ...options, [change.option]: on }
    }
    case 'statusGroup':
      return {
        ...options,
        statusFilters: { ...options.statusFilters, [change.group]: !options.statusFilters[change.group] },
      }
    case 'colorBy':
      return { ...options, colorBy: change.colorBy }
    case 'rekoColors':
      if (change.on) {
        return { ...options, colorBy: 'reko', colorByBefore: { ...options.colorByBefore, reko: options.colorBy } }
      }
      return { ...options, colorBy: options.colorBy === 'reko' ? options.colorByBefore.reko : options.colorBy }
    case 'weather':
      return { ...options, showWeather: change.on }
    case 'restore':
      return { ...options, colorBy: change.colorBy ?? options.colorBy, showWeather: change.showWeather }
  }
}

const COLOR_BY_DIMENSIONS: ReadonlySet<string> = new Set<ColorByDimension>(['priority', 'reko', 'vehicle', 'type', 'auftrag'])

function isColorByDimension(value: string | null): value is ColorByDimension {
  return value !== null && COLOR_BY_DIMENSIONS.has(value)
}

/**
 * The Lagekarte's view options as one state with one change function (`changeMapView`).
 * The operator's «Färben nach» pick (shared with the board, `COLOR_BY_STORAGE_KEY`) and the
 * «Wetter» switch are remembered on this device; the automatic colourings are not, so a reload
 * with the routes hidden is not stuck on Auftrag.
 */
export function useMapViewOptions() {
  const [options, setOptions] = useState(DEFAULT_MAP_VIEW_OPTIONS)
  useEffect(() => {
    const saved = localStorage.getItem(COLOR_BY_STORAGE_KEY)
    const restore: MapViewChange = {
      type: 'restore',
      colorBy: isColorByDimension(saved) ? saved : null,
      showWeather: readWeatherLayerPref(),
    }
    setOptions((current) => changeMapView(current, restore))
  }, [])
  // Stable: the page's keydown handler and the command palette close over it.
  const changeView = useCallback((change: MapViewChange) => {
    setOptions((current) => changeMapView(current, change))
    if (change.type === 'colorBy') localStorage.setItem(COLOR_BY_STORAGE_KEY, change.colorBy)
    if (change.type === 'weather') writeWeatherLayerPref(change.on)
  }, [])
  return [options, changeView] as const
}
