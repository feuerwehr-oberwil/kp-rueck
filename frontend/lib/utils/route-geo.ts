/**
 * Leaflet-free geo helpers shared by the Auftrag routing hook and the
 * `group-routes.tsx` overlay. Kept in its own module so `use-route-planning.ts`
 * (which runs in SSR-reachable client components) never pulls in leaflet.
 */

import type { Operation } from "@/lib/contexts/operations-context"

/**
 * The firestation-centre sentinel that operations-context assigns to incidents
 * without real coordinates (see `apiIncidentToOperation`). A stop sitting exactly
 * on it is treated as "unlocated" — kept off the route line and sunk to the end
 * when optimizing.
 */
export const UNLOCATED_SENTINEL: readonly [number, number] = [47.51637699933488, 7.561800450458299]

export function isLocated(op: Operation | undefined): op is Operation {
  if (!op) return false
  if (!Array.isArray(op.coordinates)) return false
  const [lat, lng] = op.coordinates
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false
  return !(lat === UNLOCATED_SENTINEL[0] && lng === UNLOCATED_SENTINEL[1])
}

/** Great-circle distance in kilometres (same haversine as assignment-lines.tsx). */
export function haversineKm(a: [number, number], b: [number, number]): number {
  const R = 6371
  const dLat = ((b[0] - a[0]) * Math.PI) / 180
  const dLng = ((b[1] - a[1]) * Math.PI) / 180
  const s =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((a[0] * Math.PI) / 180) * Math.cos((b[0] * Math.PI) / 180) * Math.sin(dLng / 2) * Math.sin(dLng / 2)
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s))
}
