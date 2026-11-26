import { useEffect, useState, type RefObject } from "react"
import type { Map as MlMap } from "maplibre-gl"
import { PILL_HEIGHT, placeVehiclePills, vehicleStackScale, type PillOffset, type ScreenBox } from "@/lib/map-vehicles"
import { REVEAL_MS } from "@/components/ui/reveal"
import { CLUSTER_BUBBLE_SIZE } from "./cluster-bubble"
import type { IncidentCluster } from "./use-pin-clusters"

/** A vehicle pill as the passes need it: its fix, its drawn size at the current zoom (unscaled ×
 *  `vehicleStackScale`) and where it stepped to. */
export interface PlacedPill {
  key: string
  latitude: number
  longitude: number
  /** Unscaled px (`estimatePillWidth`, `PILL_HEIGHT`). */
  width: number
  offset: PillOffset | undefined
}

/** The pills' boxes on screen now: fix + offset, scaled. */
export function pillBoxes(map: MlMap, pills: PlacedPill[]): ScreenBox[] {
  const scale = vehicleStackScale(map.getZoom())
  return pills.map((pill) => {
    const fix = map.project([pill.longitude, pill.latitude])
    return {
      x: fix.x + (pill.offset?.dx ?? 0),
      y: fix.y + (pill.offset?.dy ?? 0),
      width: pill.width * scale,
      height: PILL_HEIGHT * scale,
    }
  })
}

const NO_OFFSETS: ReadonlyMap<string, PillOffset> = new Map()

/** Everything that floats over the map: MapLibre's controls and our own map chrome – which all
 *  stands on `z-map-chrome` / `z-map-control` – but of the top-right row only its items (the row
 *  itself spans the map's width), plus what folds out of them (`data-map-chrome`, e.g. the open
 *  «ohne Koordinaten» list). */
const MAP_CHROME =
  ".maplibregl-ctrl, [data-map-top-row] > *, [data-map-chrome], " +
  ":is(.z-map-chrome, .z-map-control):not([data-map-top-row])"

/** The map chrome under `root` (`MAP_CHROME`) as boxes in the map container's px – what a vehicle
 *  pill and its list keep clear of, because it draws above them. */
export function mapChromeBoxes(root: HTMLElement | null, container: HTMLElement): ScreenBox[] {
  if (!root) return []
  const origin = container.getBoundingClientRect()
  return [...root.querySelectorAll(MAP_CHROME)].flatMap((element) => {
    const r = element.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) return []
    return [{ x: r.left - origin.left + r.width / 2, y: r.top - origin.top + r.height / 2, width: r.width, height: r.height }]
  })
}

/**
 * Where each vehicle pill stands (`placeVehiclePills`): off the incident pins (`pins`, one per
 * visible spot) and the count bubbles, out from under the map chrome (`chrome`), and off each
 * other. Recomputed when the map comes to rest, like the labels – the pills ride along with their
 * fixes while it moves – and when the chrome under `root` changes without a move (the legend
 * opens, the «ohne Koordinaten» list folds out), once its motion has settled.
 */
export function useVehiclePlacement(
  map: MlMap | null,
  pills: PlacedPill[],
  pins: { latitude: number; longitude: number; size: number }[],
  bubbles: IncidentCluster[],
  chrome: () => ScreenBox[],
  root: RefObject<HTMLElement | null>,
): ReadonlyMap<string, PillOffset> {
  const [offsets, setOffsets] = useState<ReadonlyMap<string, PillOffset>>(NO_OFFSETS)
  useEffect(() => {
    if (!map) return
    const compute = () => {
      const container = map.getContainer()
      const scale = vehicleStackScale(map.getZoom())
      const box = (latitude: number, longitude: number, size: number): ScreenBox => ({
        ...map.project([longitude, latitude]),
        width: size,
        height: size,
      })
      const next = placeVehiclePills(
        pills.map((pill) => ({
          key: pill.key,
          ...map.project([pill.longitude, pill.latitude]),
          width: pill.width * scale,
          height: PILL_HEIGHT * scale,
        })),
        {
          obstacles: [
            ...pins.map((pin) => box(pin.latitude, pin.longitude, pin.size)),
            ...bubbles.map((bubble) => box(bubble.latitude, bubble.longitude, CLUSTER_BUBBLE_SIZE)),
          ],
          chrome: chrome(),
          viewport: { width: container.clientWidth, height: container.clientHeight },
        },
      )
      // Same answer, same object – positions arrive as a new array every poll.
      setOffsets((previous) =>
        previous.size === next.size &&
        [...next].every(([key, o]) => {
          const before = previous.get(key)
          return before?.dx === o.dx && before.dy === o.dy && before.crowded === o.crowded
        })
          ? previous
          : next.size === 0 ? NO_OFFSETS : next,
      )
    }
    compute()
    map.on("moveend", compute)
    // The markers live in the canvas container and change with every frame: not chrome.
    const markers = map.getCanvasContainer()
    let settle: ReturnType<typeof setTimeout> | undefined
    const observer = new MutationObserver((records) => {
      if (records.every((record) => markers.contains(record.target))) return
      clearTimeout(settle)
      settle = setTimeout(compute, REVEAL_MS + 50)
    })
    if (root.current) observer.observe(root.current, { childList: true, subtree: true, attributes: true })
    return () => {
      map.off("moveend", compute)
      observer.disconnect()
      clearTimeout(settle)
    }
  }, [map, pills, pins, bubbles, chrome, root])
  return offsets
}
