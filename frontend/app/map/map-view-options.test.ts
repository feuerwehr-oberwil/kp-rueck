import { describe, expect, it } from "vitest"
import { act, renderHook } from "@testing-library/react"
import { COLOR_BY_STORAGE_KEY } from "@/lib/kanban-utils"
import { WEATHER_LAYER_STORAGE_KEY } from "@/lib/weather"
import { changeMapView, DEFAULT_MAP_VIEW_OPTIONS, useMapViewOptions, type MapViewChange } from "./map-view-options"

const apply = (...changes: MapViewChange[]) => changes.reduce(changeMapView, DEFAULT_MAP_VIEW_OPTIONS)

describe("changeMapView", () => {
  it("colours by Auftrag while the routes show, then goes back to the pick before", () => {
    const routesOn = apply({ type: 'colorBy', colorBy: 'vehicle' }, { type: 'toggle', option: 'showGroupRoutes' })
    expect(routesOn).toMatchObject({ showGroupRoutes: true, colorBy: 'auftrag' })
    expect(changeMapView(routesOn, { type: 'toggle', option: 'showGroupRoutes' })).toMatchObject({ showGroupRoutes: false, colorBy: 'vehicle' })
    // A colour the operator picked meanwhile stays.
    const repicked = changeMapView(routesOn, { type: 'colorBy', colorBy: 'type' })
    expect(changeMapView(repicked, { type: 'toggle', option: 'showGroupRoutes' }).colorBy).toBe('type')
  })

  it("unwinds the Reko-Editor's colouring inside the routes' one", () => {
    const options = apply(
      { type: 'toggle', option: 'showGroupRoutes' },
      { type: 'rekoColors', on: true },
    )
    expect(options.colorBy).toBe('reko')
    const rekoOff = changeMapView(options, { type: 'rekoColors', on: false })
    expect(rekoOff.colorBy).toBe('auftrag')
    expect(changeMapView(rekoOff, { type: 'toggle', option: 'showGroupRoutes' }).colorBy).toBe('priority')
  })

  it("switches Linien on with Distanz, and leaves them on when Distanz goes off", () => {
    const distanceOn = apply({ type: 'toggle', option: 'showAssignmentLines' }, { type: 'toggle', option: 'showDistances' })
    expect(distanceOn).toMatchObject({ showDistances: true, showAssignmentLines: true })
    expect(changeMapView(distanceOn, { type: 'toggle', option: 'showDistances' })).toMatchObject({ showDistances: false, showAssignmentLines: true })
  })
})

describe("useMapViewOptions", () => {
  it("restores this device's picks and remembers the operator's, never the automatic colourings", () => {
    localStorage.setItem(COLOR_BY_STORAGE_KEY, 'vehicle')
    localStorage.setItem(WEATHER_LAYER_STORAGE_KEY, '1')
    const { result } = renderHook(() => useMapViewOptions())
    expect(result.current[0]).toMatchObject({ colorBy: 'vehicle', showWeather: true })

    act(() => result.current[1]({ type: 'toggle', option: 'showGroupRoutes' }))
    act(() => result.current[1]({ type: 'rekoColors', on: true }))
    expect(result.current[0].colorBy).toBe('reko')
    expect(localStorage.getItem(COLOR_BY_STORAGE_KEY)).toBe('vehicle')

    act(() => result.current[1]({ type: 'colorBy', colorBy: 'type' }))
    act(() => result.current[1]({ type: 'weather', on: false }))
    expect(localStorage.getItem(COLOR_BY_STORAGE_KEY)).toBe('type')
    expect(localStorage.getItem(WEATHER_LAYER_STORAGE_KEY)).toBe('0')
  })
})
