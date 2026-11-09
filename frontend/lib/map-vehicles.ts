/**
 * The Lagekarte's vehicle pills, as pure geometry and rules (owner pick r28 1A, «Die Pille sagt
 * ihren Zustand und weicht aus»). The markers themselves are `components/map/vehicle-marker.tsx`.
 *
 * - A GPS spot is one vehicle, or several within ~50 m of each other (`clusterVehicles`).
 * - online = a solid blue pill, offline = a hollow dashed grey one; a spot of several is ONE split
 *   pill «6 Fahrzeuge | 4 offline» – only the part that applies.
 * - A pill wears its last-report time only when that report is older than the station's threshold
 *   (`gps.stale_after_minutes`, Einstellungen → GPS); the hover list always says it.
 * - A pill that would lie on an incident pin or count bubble steps aside (`placeVehiclePills`) and
 *   keeps a thin leader to a dot at the real fix; the incident labels then avoid the pills
 *   (`lib/map-labels.ts`, as obstacles).
 *
 * No React in here; everything is computed when the map comes to rest, never per frame.
 */

import type { ApiVehiclePosition } from '@/lib/api-client'
import { measureTextWidth } from '@/lib/map-labels'

/** The settings key of the staleness threshold, and its default (minutes). */
export const GPS_STALE_SETTING = 'gps.stale_after_minutes'
export const DEFAULT_STALE_MINUTES = 10

/** The threshold as a settings value says it; anything that is not a positive number is the default. */
export function parseStaleMinutes(raw: string | number | null | undefined): number {
  const value = typeof raw === 'number' ? raw : Number.parseFloat(raw ?? '')
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_STALE_MINUTES
}

/** Traccar's own device state: only `online` counts as reporting. */
export function isOnline(vehicle: Pick<ApiVehiclePosition, 'status'>): boolean {
  return vehicle.status === 'online'
}

/** Milliseconds since the fix, or null when its timestamp does not parse. */
export function reportAgeMs(lastUpdate: string, now: number): number | null {
  const at = Date.parse(lastUpdate)
  return Number.isFinite(at) ? now - at : null
}

/** Is the last report older than the threshold? An unreadable timestamp is not stale – there is no
 *  time to show. */
export function isStale(lastUpdate: string, now: number, staleMinutes: number): boolean {
  const age = reportAgeMs(lastUpdate, now)
  return age !== null && age > staleMinutes * 60_000
}

/** When the last report was, as the pill and the list say it: today «18:41», yesterday
 *  «gestern 20:05» (the caller words `yesterday`), before that «09.11. 20:05». */
export type ReportDay = 'today' | 'yesterday' | 'earlier'

export function reportDay(lastUpdate: string, now: number): ReportDay | null {
  const at = new Date(lastUpdate)
  if (Number.isNaN(at.getTime())) return null
  const startOfToday = new Date(now)
  startOfToday.setHours(0, 0, 0, 0)
  if (at >= startOfToday) return 'today'
  const startOfYesterday = new Date(startOfToday)
  startOfYesterday.setDate(startOfYesterday.getDate() - 1)
  return at >= startOfYesterday ? 'yesterday' : 'earlier'
}

/** Vehicles closer than this (degrees, ≈ 50 m) share one spot – well below a depot yard. */
export const VEHICLE_SPOT_EPSILON = 0.0005

/** One GPS spot on the map: one vehicle or several, at their mean position. */
export interface VehicleSpot {
  /** Stable while the same vehicles share it: their device ids. */
  key: string
  latitude: number
  longitude: number
  /** Online first, each half in fleet order (`display_order`) – the hover list's order. */
  vehicles: ApiVehiclePosition[]
  online: number
  offline: number
}

/**
 * Greedy spots: each vehicle joins the first earlier vehicle within `VEHICLE_SPOT_EPSILON` on both
 * axes. `orderFor` is the fleet order (kanban, vehicle sheet, settings) a spot's list follows.
 */
export function clusterVehicles(
  positions: readonly ApiVehiclePosition[],
  orderFor: (vehicle: ApiVehiclePosition) => number,
): VehicleSpot[] {
  const used = new Set<number>()
  const spots: VehicleSpot[] = []
  for (let i = 0; i < positions.length; i++) {
    if (used.has(i)) continue
    const group = [positions[i]]
    used.add(i)
    for (let j = i + 1; j < positions.length; j++) {
      if (used.has(j)) continue
      if (
        Math.abs(positions[i].latitude - positions[j].latitude) < VEHICLE_SPOT_EPSILON &&
        Math.abs(positions[i].longitude - positions[j].longitude) < VEHICLE_SPOT_EPSILON
      ) {
        group.push(positions[j])
        used.add(j)
      }
    }
    group.sort((a, b) => Number(isOnline(b)) - Number(isOnline(a)) || orderFor(a) - orderFor(b))
    const online = group.filter(isOnline).length
    spots.push({
      key: group.map((vehicle) => vehicle.device_id).sort((a, b) => a - b).join('-'),
      latitude: group.reduce((sum, vehicle) => sum + vehicle.latitude, 0) / group.length,
      longitude: group.reduce((sum, vehicle) => sum + vehicle.longitude, 0) / group.length,
      vehicles: group,
      online,
      offline: group.length - online,
    })
  }
  return spots
}

/**
 * What a spot's pill says. A single vehicle: its name, solid when online, hollow when not, plus the
 * time when stale. Several: the count, split off a hollow «m offline» part when some are offline
 * and some online; all offline = one hollow pill.
 */
export type PillFace =
  | { kind: 'single'; name: string; online: boolean; staleAt: string | null }
  | { kind: 'cluster'; count: number; online: number; offline: number }

export function pillFace(
  spot: VehicleSpot,
  nameFor: (vehicle: ApiVehiclePosition) => string,
  now: number,
  staleMinutes: number,
): PillFace {
  if (spot.vehicles.length > 1) {
    return { kind: 'cluster', count: spot.vehicles.length, online: spot.online, offline: spot.offline }
  }
  const vehicle = spot.vehicles[0]
  return {
    kind: 'single',
    name: nameFor(vehicle),
    online: isOnline(vehicle),
    staleAt: isStale(vehicle.last_update, now, staleMinutes) ? vehicle.last_update : null,
  }
}

// --- Pill geometry (unscaled px; components/map/vehicle-marker.tsx draws exactly this) -------

export const PILL_HEIGHT = 24
/** Border 2px each side + 8px padding each side. */
const PILL_CHROME = 2 * 2 + 2 * 8
/** The stale time beside the name: 5px gap + 11px mono. */
const STALE_GAP = 5

/** Width of a pill as drawn, for the collision passes – measured on a canvas where one exists. */
export function estimatePillWidth(face: PillFace, texts: { primary: string; secondary?: string; time?: string }): number {
  const primary = measureTextWidth(texts.primary, { weight: 700, size: 13 })
  if (face.kind === 'single') {
    const time = texts.time ? STALE_GAP + measureTextWidth(texts.time, { weight: 500, size: 11, mono: true }) : 0
    return Math.ceil(PILL_CHROME + primary + time)
  }
  // The split pill: the count part, then a hollow part of 7px padding + 12px/600 text.
  const secondary = texts.secondary ? 2 * 7 + 1 + 2 + measureTextWidth(texts.secondary, { weight: 600, size: 12 }) : 0
  return Math.ceil(PILL_CHROME + primary + secondary)
}

/**
 * How big the pills are at a zoom: full size from street level (15), 0.8 at the Lagekarte's
 * default (13) – still readable next to a 32px pin – and down to 0.6 zoomed far out, so a depot
 * full of them does not blanket the town.
 */
export function vehicleStackScale(zoom: number): number {
  if (zoom >= 15) return 1
  if (zoom <= 11) return 0.6
  return 0.6 + ((zoom - 11) / 4) * 0.4
}

// --- Stepping aside ---------------------------------------------------------------------------

/** A pill to place: the fix on screen (px) and the pill's drawn (scaled) size. */
export interface PillCandidate {
  key: string
  x: number
  y: number
  width: number
  height: number
}

/** A mark a pill must not lie on: centre + box, px (incident pins, count bubbles). */
export interface ScreenBox {
  x: number
  y: number
  width: number
  height: number
}

/** Where a pill's centre sits relative to its fix, px. {0, 0} = on the fix, no leader.
 *  `crowded`: no free place was found – it lies on what covers it least, and is drawn above the
 *  pins there (readable and tappable) rather than under them. */
export interface PillOffset {
  dx: number
  dy: number
  crowded?: boolean
}

/** Clear space a stepped-aside pill keeps from what it avoids. */
const PILL_GAP = 4

interface Rect {
  left: number
  top: number
  right: number
  bottom: number
}

const rectOf = (x: number, y: number, width: number, height: number): Rect => ({
  left: x - width / 2,
  top: y - height / 2,
  right: x + width / 2,
  bottom: y + height / 2,
})

/** Overlapping area of two rects, the second grown by the gap – 0 when they stay clear. */
function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.right, b.right + PILL_GAP) - Math.max(a.left, b.left - PILL_GAP)
  const h = Math.min(a.bottom, b.bottom + PILL_GAP) - Math.max(a.top, b.top - PILL_GAP)
  return w > 0 && h > 0 ? w * h : 0
}

/** The pill's area outside the map – a pill half off the edge says nothing, so this weighs
 *  `OUTSIDE_WEIGHT` times what lying under a pin does (a pin hides a corner; the edge cuts words). */
const OUTSIDE_WEIGHT = 4

function outside(r: Rect, viewport?: { width: number; height: number }): number {
  if (!viewport) return 0
  const w = r.right - r.left
  const h = r.bottom - r.top
  const inW = Math.max(0, Math.min(r.right, viewport.width) - Math.max(r.left, 0))
  const inH = Math.max(0, Math.min(r.bottom, viewport.height) - Math.max(r.top, 0))
  return (w * h - inW * inH) * OUTSIDE_WEIGHT
}

/** Where a pill may go, in order of preference: on its fix, then just below, above, right, left –
 *  each far enough to clear the 32px pin under the fix – then the four diagonals, then a step
 *  further out (past a 44px count bubble or a neighbouring pin). Shortest leader first: the fix
 *  should stay obvious, and a crowded spot still finds a free place. */
function candidateOffsets(width: number, height: number): PillOffset[] {
  const near = height / 2 + 22
  const far = height + 36
  const side = width / 2 + 22
  const wide = width + 30
  return [
    { dx: 0, dy: 0 },
    { dx: 0, dy: near },
    { dx: 0, dy: -near },
    { dx: side, dy: 0 },
    { dx: -side, dy: 0 },
    { dx: side, dy: near },
    { dx: -side, dy: near },
    { dx: side, dy: -near },
    { dx: -side, dy: -near },
    { dx: 0, dy: far },
    { dx: 0, dy: -far },
    { dx: wide, dy: 0 },
    { dx: -wide, dy: 0 },
    { dx: side, dy: far },
    { dx: -side, dy: far },
    { dx: side, dy: -far },
    { dx: -side, dy: -far },
  ]
}

/**
 * Step pills off the incident pins and bubbles (`obstacles`), off what floats over the map
 * (`chrome`: its buttons, the legend, the chip row – they hide a pill entirely, so lying under
 * them weighs like the edge) and off each other. Greedy and deterministic: the widest pill first
 * (a depot's split pill), then by key; each takes the first candidate that touches nothing and
 * stays on the map, else the one that covers least (marked `crowded`). Returns an entry only for
 * the pills that move or are crowded.
 */
export function placeVehiclePills(
  pills: readonly PillCandidate[],
  {
    obstacles,
    chrome = [],
    viewport,
  }: { obstacles: readonly ScreenBox[]; chrome?: readonly ScreenBox[]; viewport?: { width: number; height: number } },
): Map<string, PillOffset> {
  const blocked = obstacles.map((o) => rectOf(o.x, o.y, o.width, o.height))
  const covering = chrome.map((o) => rectOf(o.x, o.y, o.width, o.height))
  const placed: Rect[] = []
  const moved = new Map<string, PillOffset>()
  const order = [...pills].sort((a, b) => b.width - a.width || a.key.localeCompare(b.key))
  for (const pill of order) {
    let best: { offset: PillOffset; rect: Rect; cost: number } | null = null
    for (const offset of candidateOffsets(pill.width, pill.height)) {
      const rect = rectOf(pill.x + offset.dx, pill.y + offset.dy, pill.width, pill.height)
      const cost =
        [...blocked, ...placed].reduce((sum, other) => sum + overlap(rect, other), 0) +
        covering.reduce((sum, other) => sum + overlap(rect, other) * OUTSIDE_WEIGHT, 0) +
        outside(rect, viewport)
      if (!best || cost < best.cost) best = { offset, rect, cost }
      if (cost === 0) break
    }
    if (!best) continue
    placed.push(best.rect)
    if (best.cost > 0) moved.set(pill.key, { ...best.offset, crowded: true })
    else if (best.offset.dx !== 0 || best.offset.dy !== 0) moved.set(pill.key, best.offset)
  }
  return moved
}

// --- The hover list ---------------------------------------------------------------------------

/** The list shows this many rows, then scrolls. */
export const LIST_VISIBLE_ROWS = 5
/** One row, px (`VehicleList` in components/map/vehicle-marker.tsx). */
export const LIST_ROW_HEIGHT = 28

/**
 * Which side of its pill the hover list opens on, how far it shifts sideways to stay inside the
 * map, and how tall it may be there (`room`): above when it fits there, else below (whichever has
 * more room when neither fits – the list then shows fewer rows and scrolls), never past an edge.
 * It slides sideways off the map's own buttons and chrome (`chrome`), which draw above it, when
 * the map is wide enough for that; else it stays centred under its pill.
 */
export function placeHoverList({
  anchor,
  pillHalfHeight,
  list,
  viewport,
  chrome = [],
  gap = 10,
  margin = 8,
}: {
  /** The pill's centre on the map, px. */
  anchor: { x: number; y: number }
  pillHalfHeight: number
  list: { width: number; height: number }
  viewport: { width: number; height: number }
  chrome?: readonly ScreenBox[]
  gap?: number
  margin?: number
}): { side: 'top' | 'bottom'; shiftX: number; room: number } {
  const above = anchor.y - pillHalfHeight - gap - margin
  const below = viewport.height - (anchor.y + pillHalfHeight + gap) - margin
  const side = above >= list.height || above >= below ? 'top' : 'bottom'
  const room = Math.max(0, Math.floor(side === 'top' ? above : below))
  const height = Math.min(list.height, room)
  const top = side === 'top' ? anchor.y - pillHalfHeight - gap - height : anchor.y + pillHalfHeight + gap
  const left = anchor.x - list.width / 2
  const maxLeft = viewport.width - margin - list.width
  const clamp = (x: number) => Math.max(margin, Math.min(x, maxLeft))
  const boxes = chrome.map((o) => rectOf(o.x, o.y, o.width, o.height))
  const clear = (x: number) =>
    boxes.every((b) => overlap({ left: x, right: x + list.width, top, bottom: top + height }, b) === 0)
  // Centred first, then flush beside each piece of chrome it would lie under.
  const tries = [clamp(left), ...boxes.flatMap((b) => [clamp(b.right + margin), clamp(b.left - margin - list.width)])]
  const chosen = tries.find(clear) ?? tries[0]
  return { side, shiftX: Math.round(chosen - left), room }
}
