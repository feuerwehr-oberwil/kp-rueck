import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMapRelayout } from './use-map-relayout'

/** A map with the three members the pass uses; `fire` plays a `moveend`. */
function fakeMap(markers: HTMLElement) {
  const listeners = new Set<() => void>()
  return {
    on: vi.fn((_: string, fn: () => void) => listeners.add(fn)),
    off: vi.fn((_: string, fn: () => void) => listeners.delete(fn)),
    getCanvasContainer: () => markers,
    fire: () => listeners.forEach((fn) => fn()),
    listeners,
  }
}

describe('useMapRelayout', () => {
  let root: HTMLDivElement
  let markers: HTMLDivElement

  beforeEach(() => {
    vi.useFakeTimers()
    root = document.createElement('div')
    markers = document.createElement('div')
    root.append(markers)
    document.body.append(root)
  })
  afterEach(() => {
    vi.useRealTimers()
    root.remove()
  })

  const mount = (map: ReturnType<typeof fakeMap> | null, measure: () => void) =>
    renderHook(() => useMapRelayout(map, measure, { root: { current: root }, settleMs: 100 }))

  it('measures now and each time the map comes to rest', () => {
    const map = fakeMap(markers)
    const measure = vi.fn()
    mount(map, measure)
    expect(measure).toHaveBeenCalledTimes(1)
    map.fire()
    expect(measure).toHaveBeenCalledTimes(2)
  })

  it('measures once the chrome has settled – the legend opening – but not for marker churn', async () => {
    const map = fakeMap(markers)
    const measure = vi.fn()
    mount(map, measure)
    measure.mockClear()

    markers.append(document.createElement('span'))
    await vi.advanceTimersByTimeAsync(200)
    expect(measure).not.toHaveBeenCalled()

    root.append(document.createElement('aside'))
    await vi.advanceTimersByTimeAsync(50)
    expect(measure).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(100)
    expect(measure).toHaveBeenCalledTimes(1)
  })

  it('does nothing without a map, and lets go on unmount', () => {
    const measure = vi.fn()
    mount(null, measure)
    expect(measure).not.toHaveBeenCalled()

    const map = fakeMap(markers)
    const { unmount } = mount(map, measure)
    unmount()
    expect(map.listeners.size).toBe(0)
  })
})
