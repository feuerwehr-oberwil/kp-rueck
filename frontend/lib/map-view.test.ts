import { describe, expect, it, vi } from 'vitest'
import type { Map as MlMap } from 'maplibre-gl'
import { boundsOfLatLng, fitTo, type LatLngPoint } from './map-view'

// The one fit shared by the Lagekarte, the print page and the two Auftrag dialogs. Worth
// pinning because all four hand it `[lat, lng]` while MapLibre answers in `[lng, lat]` — a
// silent swap puts a Basel-Landschaft board somewhere in Somalia — and because the surfaces
// disagree about what ONE point means (a centre at their own zoom, not a zero-size box).

const OBERWIL: LatLngPoint = [47.5163, 7.5618]
const BASEL: LatLngPoint = [47.5596, 7.5886]

/** Just enough of a map to record what a fit asked for. */
const fakeMap = () =>
  ({
    fitBounds: vi.fn(),
    jumpTo: vi.fn(),
    flyTo: vi.fn(),
  }) as unknown as MlMap & {
    fitBounds: ReturnType<typeof vi.fn>
    jumpTo: ReturnType<typeof vi.fn>
    flyTo: ReturnType<typeof vi.fn>
  }

describe('boundsOfLatLng', () => {
  it('returns the west/south + east/north corners, in MapLibre order', () => {
    expect(boundsOfLatLng([OBERWIL, BASEL])).toEqual([
      [7.5618, 47.5163],
      [7.5886, 47.5596],
    ])
  })

  it('has nothing to frame without points', () => {
    expect(boundsOfLatLng([])).toBeNull()
  })
})

describe('fitTo', () => {
  it('leaves the map alone when there is nothing to frame', () => {
    const map = fakeMap()
    fitTo(map, [], { padding: 40, maxZoom: 15 })
    expect(map.fitBounds).not.toHaveBeenCalled()
    expect(map.jumpTo).not.toHaveBeenCalled()
  })

  it('centres a single point at singleZoom instead of fitting a zero-size box', () => {
    const map = fakeMap()
    fitTo(map, [OBERWIL], { padding: 48, maxZoom: 16, duration: 0, singleZoom: 15 })
    expect(map.jumpTo).toHaveBeenCalledWith({ center: [7.5618, 47.5163], zoom: 15 })
    expect(map.fitBounds).not.toHaveBeenCalled()
  })

  it('fits a single point like any other box when no singleZoom is given', () => {
    const map = fakeMap()
    fitTo(map, [OBERWIL], { padding: 40, maxZoom: 15 })
    expect(map.fitBounds).toHaveBeenCalledOnce()
    expect(map.jumpTo).not.toHaveBeenCalled()
  })

  it('passes the caller’s own padding, maxZoom and duration through untouched', () => {
    const map = fakeMap()
    fitTo(map, [OBERWIL, BASEL], { padding: 60, maxZoom: 16, duration: 600, singleZoom: 15 })
    expect(map.fitBounds).toHaveBeenCalledWith(
      [
        [7.5618, 47.5163],
        [7.5886, 47.5596],
      ],
      { padding: 60, maxZoom: 16, duration: 600 },
    )
  })
})
