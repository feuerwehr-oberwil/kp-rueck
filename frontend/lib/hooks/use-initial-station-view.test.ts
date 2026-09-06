import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_CENTER_LATLNG, type LatLngPoint } from '@/lib/map-view'
import { useInitialStationView } from './use-initial-station-view'

function fakeMap(center = { lat: DEFAULT_CENTER_LATLNG[0], lng: DEFAULT_CENTER_LATLNG[1] }) {
  return { getCenter: () => center, jumpTo: vi.fn() }
}

const station: LatLngPoint = [46, 8]

describe('empty map opening view', () => {
  it('waits for station settings, then centers the empty map once', () => {
    const map = fakeMap()
    const { rerender } = renderHook(({ ready, coordinates }) => useInitialStationView(map, coordinates, ready, false), {
      initialProps: { ready: false, coordinates: DEFAULT_CENTER_LATLNG },
    })
    expect(map.jumpTo).not.toHaveBeenCalled()
    rerender({ ready: true, coordinates: station })
    expect(map.jumpTo).toHaveBeenCalledExactlyOnceWith({ center: [8, 46] })
    rerender({ ready: true, coordinates: [47, 9] })
    expect(map.jumpTo).toHaveBeenCalledOnce()
  })

  it('waits for the map if the station settings arrive first', () => {
    const map = fakeMap()
    const { rerender } = renderHook(({ loaded }) => useInitialStationView(loaded ? map : null, station, true, false), {
      initialProps: { loaded: false },
    })
    rerender({ loaded: true })
    expect(map.jumpTo).toHaveBeenCalledExactlyOnceWith({ center: [8, 46] })
  })

  it('leaves incident framing in control when there are located incidents', () => {
    const map = fakeMap()
    renderHook(() => useInitialStationView(map, station, true, true))
    expect(map.jumpTo).not.toHaveBeenCalled()
  })

  it('does not override an operator who panned before settings arrived', () => {
    const map = fakeMap({ lat: 45, lng: 7 })
    renderHook(() => useInitialStationView(map, station, true, false))
    expect(map.jumpTo).not.toHaveBeenCalled()
  })
})
