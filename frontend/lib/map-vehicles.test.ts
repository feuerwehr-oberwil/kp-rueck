import { describe, expect, it } from 'vitest'
import type { ApiVehiclePosition } from '@/lib/api-client'
import {
  DEFAULT_STALE_MINUTES,
  clusterVehicles,
  isStale,
  parseStaleMinutes,
  pillFace,
  placeHoverList,
  placeVehiclePills,
  reportDay,
  type PillCandidate,
} from './map-vehicles'

const NOW = Date.parse('2026-07-11T19:30:00')

function vehicle(id: number, name: string, status: string, lat: number, lng: number, extra: Partial<ApiVehiclePosition> = {}): ApiVehiclePosition {
  return {
    device_id: id,
    device_name: name,
    unique_id: `u${id}`,
    status,
    latitude: lat,
    longitude: lng,
    speed: 0,
    course: null,
    last_update: new Date(NOW - 60_000).toISOString(),
    address: null,
    ...extra,
  }
}

const ORDER: Record<string, number> = { TLF: 1, Pio: 2, Mawa: 3, Kdo: 4 }
const orderFor = (v: ApiVehiclePosition) => ORDER[v.device_name] ?? 99

describe('clusterVehicles', () => {
  const depot = [
    vehicle(1, 'TLF', 'offline', 47.51642, 7.56186),
    vehicle(2, 'Pio', 'online', 47.51635, 7.56175),
    vehicle(4, 'Kdo', 'offline', 47.51645, 7.5617),
    vehicle(3, 'Mawa', 'online', 47.5163, 7.5619),
    vehicle(7, 'Mowa', 'online', 47.5117, 7.56065),
  ]

  it('puts vehicles within ~50 m on one spot and counts online and offline', () => {
    const spots = clusterVehicles(depot, orderFor)
    expect(spots).toHaveLength(2)
    expect(spots[0]).toMatchObject({ key: '1-2-3-4', online: 2, offline: 2 })
    expect(spots[1]).toMatchObject({ key: '7', online: 1, offline: 0 })
  })

  it('lists online first, each half in fleet order', () => {
    const [home] = clusterVehicles(depot, orderFor)
    expect(home.vehicles.map((v) => v.device_name)).toEqual(['Pio', 'Mawa', 'TLF', 'Kdo'])
  })
})

describe('staleness', () => {
  it('reads the threshold from the setting, falling back to the default', () => {
    expect(parseStaleMinutes('25')).toBe(25)
    expect(parseStaleMinutes(15)).toBe(15)
    for (const raw of ['', '0', '-5', 'abc', undefined, null]) expect(parseStaleMinutes(raw)).toBe(DEFAULT_STALE_MINUTES)
  })

  it('is stale only once the last report is older than the threshold', () => {
    expect(isStale(new Date(NOW - 9 * 60_000).toISOString(), NOW, 10)).toBe(false)
    expect(isStale(new Date(NOW - 11 * 60_000).toISOString(), NOW, 10)).toBe(true)
    expect(isStale('not a date', NOW, 10)).toBe(false)
  })

  it('says whether the report was today, yesterday or before', () => {
    expect(reportDay('2026-07-11T08:30:00', NOW)).toBe('today')
    expect(reportDay('2026-07-10T20:05:00', NOW)).toBe('yesterday')
    expect(reportDay('2026-07-08T20:05:00', NOW)).toBe('earlier')
    expect(reportDay('nope', NOW)).toBeNull()
  })
})

describe('pillFace', () => {
  const name = (v: ApiVehiclePosition) => v.device_name

  it('gives a single vehicle its time only when stale', () => {
    const fresh = clusterVehicles([vehicle(1, 'TLF', 'offline', 47, 7)], orderFor)[0]
    expect(pillFace(fresh, name, NOW, 10)).toEqual({ kind: 'single', name: 'TLF', online: false, staleAt: null })
    const old = new Date(NOW - 49 * 60_000).toISOString()
    const stale = clusterVehicles([vehicle(1, 'TLF', 'offline', 47, 7, { last_update: old })], orderFor)[0]
    expect(pillFace(stale, name, NOW, 10)).toMatchObject({ staleAt: old })
    // A higher threshold keeps the same report off the pill.
    expect(pillFace(stale, name, NOW, 60)).toMatchObject({ staleAt: null })
  })

  it('splits a spot of several into online and offline', () => {
    const spot = clusterVehicles(
      [vehicle(1, 'TLF', 'offline', 47, 7), vehicle(2, 'Pio', 'online', 47, 7), vehicle(3, 'Kdo', 'offline', 47, 7)],
      orderFor,
    )[0]
    expect(pillFace(spot, name, NOW, 10)).toEqual({ kind: 'cluster', count: 3, online: 1, offline: 2 })
  })
})

describe('placeVehiclePills', () => {
  const pill = (key: string, x: number, y: number, width = 60): PillCandidate => ({ key, x, y, width, height: 20 })
  const pin = (x: number, y: number) => ({ x, y, width: 32, height: 32 })

  it('leaves a pill that touches nothing on its fix', () => {
    expect(placeVehiclePills([pill('a', 100, 100)], { obstacles: [pin(300, 300)] }).size).toBe(0)
  })

  it('steps a pill off an incident pin – below first', () => {
    const moved = placeVehiclePills([pill('a', 100, 100)], { obstacles: [pin(100, 100)] })
    expect(moved.get('a')).toEqual({ dx: 0, dy: 32 })
  })

  it('goes above when below is taken too', () => {
    const moved = placeVehiclePills([pill('a', 100, 100)], { obstacles: [pin(100, 100), pin(100, 130)] })
    expect(moved.get('a')).toEqual({ dx: 0, dy: -32 })
  })

  it('keeps two pills at one place apart', () => {
    const moved = placeVehiclePills([pill('a', 100, 100), pill('b', 100, 100)], { obstacles: [] })
    expect(moved.has('a')).toBe(false)
    expect(moved.get('b')).toEqual({ dx: 0, dy: 32 })
  })

  it('marks a pill that finds no free place as crowded, on the place that covers least', () => {
    // Pins all around the fix, near and far: every candidate touches one.
    const ring = [-120, -60, 0, 60, 120].flatMap((x) => [-80, -32, 0, 32, 80].map((y) => pin(100 + x, 100 + y)))
    const moved = placeVehiclePills([pill('a', 100, 100)], { obstacles: ring })
    expect(moved.get('a')?.crowded).toBe(true)
  })

  it('does not step off the map', () => {
    // At the bottom edge «below» would hang outside: it goes above instead.
    const moved = placeVehiclePills([pill('a', 100, 190)], { obstacles: [pin(100, 190)], viewport: { width: 400, height: 200 } })
    expect(moved.get('a')?.dy).toBeLessThan(0)
  })

  it('is deterministic whatever order the spots arrive in', () => {
    const input = [pill('b', 100, 100), pill('a', 100, 100, 80)]
    const once = placeVehiclePills(input, { obstacles: [] })
    const again = placeVehiclePills([...input].reverse(), { obstacles: [] })
    expect([...again]).toEqual([...once])
    // The wider (split) pill keeps its fix.
    expect(once.has('a')).toBe(false)
  })
})

describe('placeHoverList', () => {
  const viewport = { width: 800, height: 600 }
  const list = { width: 272, height: 190 }

  it('opens above the pill when it fits there', () => {
    expect(placeHoverList({ anchor: { x: 400, y: 300 }, pillHalfHeight: 10, list, viewport })).toEqual({ side: 'top', shiftX: 0, room: 272 })
  })

  it('opens below a pill near the top of the map', () => {
    expect(placeHoverList({ anchor: { x: 400, y: 60 }, pillHalfHeight: 10, list, viewport }).side).toBe('bottom')
  })

  it('takes the roomier side when neither fits, and says how much room there is', () => {
    // A 360px phone map, the pill at 160: 132px above, 172px below.
    const place = placeHoverList({ anchor: { x: 180, y: 160 }, pillHalfHeight: 10, list, viewport: { width: 360, height: 360 } })
    expect(place).toMatchObject({ side: 'bottom', room: 172 })
  })

  it('shifts sideways to stay inside the map', () => {
    // Centred on x=50 its left edge would sit at -86: it moves right to the 8px margin.
    expect(placeHoverList({ anchor: { x: 50, y: 300 }, pillHalfHeight: 10, list, viewport }).shiftX).toBe(94)
    expect(placeHoverList({ anchor: { x: 790, y: 300 }, pillHalfHeight: 10, list, viewport }).shiftX).toBe(-134)
  })
})
