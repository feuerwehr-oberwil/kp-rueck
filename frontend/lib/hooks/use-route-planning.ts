"use client"

/**
 * useRoutePlanning — shared Auftrag (incident group) routing logic for both the
 * Routen-Editor modal (Phase 2) and the `/map` Routenplanung mode (Phase 3).
 *
 * Leaflet-free by design (only pure geo helpers), so it can live in any client
 * component without dragging leaflet into an SSR path.
 *
 * Exposes, for one group:
 * - `group`, `stopIds`, `orderedStops` (id + resolved Operation in group order)
 * - `addStopAtLatLng(lat, lng)` — reverse-geocode a clicked point, create an
 *   incident already attached to the group (streamlined "+ Stop" path), refresh.
 * - `reorder(orderedIds)` — persist a new stop order via `reorderGroupStops`.
 * - `optimize(start)` — client-side greedy nearest-neighbour over located stops
 *   from a start point ('magazin' | 'vehicle' | 'first'); returns the proposed
 *   ordered ids for preview (caller confirms → `reorder`). Unlocated stops sink to
 *   the end preserving their relative order.
 * - `magazinCoords`, `vehicleStart` — resolved start anchors (null when unknown).
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import { reverseGeocode } from "@/lib/geocoding"
import { apiClient, type ApiVehiclePosition } from "@/lib/api-client"
import { useGroups } from "@/lib/contexts/groups-context"
import { useOperations, type Operation } from "@/lib/contexts/operations-context"
import { haversineKm, isLocated } from "@/lib/utils/route-geo"

export type RouteStartMode = "magazin" | "vehicle" | "first"

// Basel-Landschaft fallback base — mirrors map-view.tsx's default firestation
// coordinates. Used so the "Magazin" start anchor is normally resolvable even
// when no gps.station_* / firestation_* settings are configured yet.
const DEFAULT_STATION: [number, number] = [47.51637699933488, 7.561800450458299]

export interface OrderedStop {
  id: string
  op: Operation | undefined
}

/** Match a vehicle name against a Traccar device name (mirrors assignment-lines). */
function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[\s\-_.]+/g, "")
}

function findVehiclePosition(vehicleName: string, positions: ApiVehiclePosition[]): ApiVehiclePosition | undefined {
  const target = normalizeName(vehicleName)
  const exact = positions.find((p) => p.device_name.toLowerCase() === vehicleName.toLowerCase())
  if (exact) return exact
  const normalized = positions.find((p) => normalizeName(p.device_name) === target)
  if (normalized) return normalized
  return positions.find((p) => {
    const dev = normalizeName(p.device_name)
    return dev.includes(target) || target.includes(dev)
  })
}

export function useRoutePlanning(groupId: string | null | undefined) {
  const { groups, reorderGroupStops, refreshGroups } = useGroups()
  const { operations, createOperation, refreshOperations } = useOperations()

  const [magazinCoords, setMagazinCoords] = useState<[number, number] | null>(null)
  const [vehiclePositions, setVehiclePositions] = useState<ApiVehiclePosition[]>([])
  const [isAddingStop, setIsAddingStop] = useState(false)

  const group = useMemo(() => groups.find((g) => g.id === groupId), [groups, groupId])

  const operationsById = useMemo(() => new Map(operations.map((o) => [o.id, o] as const)), [operations])

  const orderedStops = useMemo<OrderedStop[]>(
    () => (group ? group.stopIds.map((id) => ({ id, op: operationsById.get(id) })) : []),
    [group, operationsById],
  )

  /** Located Operations in group order (used by nearest-neighbour + the map). */
  const stops = useMemo<Operation[]>(
    () => orderedStops.map((s) => s.op).filter(isLocated),
    [orderedStops],
  )

  // Load Magazin/home anchor + live vehicle GPS (used for optimize starts). Only
  // once a group is actually being planned — the modal stays mounted while closed.
  useEffect(() => {
    if (!groupId) return
    let cancelled = false
    void (async () => {
      try {
        const settings = await apiClient.getAllSettings()
        if (cancelled) return
        const lat = parseFloat(settings["gps.station_lat"] ?? settings.firestation_latitude ?? "")
        const lng = parseFloat(settings["gps.station_lng"] ?? settings.firestation_longitude ?? "")
        if (Number.isFinite(lat) && Number.isFinite(lng)) setMagazinCoords([lat, lng])
        // Fall back to the same default base map-view uses so "Magazin" stays a
        // usable start anchor even before any station coords are configured.
        else setMagazinCoords(DEFAULT_STATION)
      } catch {
        // Non-fatal: keep the default base so "Magazin" remains selectable.
        setMagazinCoords(DEFAULT_STATION)
      }
      try {
        const positions = await apiClient.getVehiclePositions()
        if (!cancelled) setVehiclePositions(positions)
      } catch {
        // Non-fatal: the "Fahrzeug-GPS" start option is simply unavailable.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [groupId])

  // The squad's live GPS anchor: the source stop's first vehicle, matched by name.
  const vehicleStart = useMemo<[number, number] | null>(() => {
    const source = group?.stopIds.length ? operationsById.get(group.stopIds[0]) : undefined
    const vehicleName = source?.vehicles[0]
    if (!vehicleName) return null
    const vp = findVehiclePosition(vehicleName, vehiclePositions)
    return vp ? [vp.latitude, vp.longitude] : null
  }, [group, operationsById, vehiclePositions])

  const addStopAtLatLng = useCallback(
    async (lat: number, lng: number): Promise<void> => {
      if (!group) return
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return
      setIsAddingStop(true)
      try {
        const address = (await reverseGeocode(lat, lng)) ?? `${lat.toFixed(6)}, ${lng.toFixed(6)}`
        // createOperation with a preset groupId attaches the new incident to the
        // Auftrag at creation (backend stamps group_position) — the streamlined
        // "+ Stop" path. Its declared return type is void but the runtime value is
        // the underlying Promise, so awaiting it genuinely blocks on the POST.
        await (createOperation({
          location: address,
          vehicle: null,
          vehicles: [],
          incidentType: "elementarereignis",
          crew: [],
          priority: "medium",
          status: "incoming",
          coordinates: [lat, lng],
          materials: [],
          notes: "",
          contact: "",
          contactPhone: "",
          internalNotes: "",
          nachbarhilfe: false,
          nachbarhilfeNote: "",
          amWarten: false,
          amWartenNote: "",
          zuFuss: false,
          groupId: group.id,
          groupPosition: 0,
          statusChangedAt: null,
          hasCompletedReko: false,
          rekoArrivedAt: null,
          rekoSummary: null,
          assignedReko: null,
          crewAssignments: new Map(),
          materialAssignments: new Map(),
          vehicleAssignments: new Map(),
          vehicleCallsigns: new Map(),
          vehicleDriverStay: new Map(),
        }) as unknown as Promise<void>)
        // The new stop rides the incident WS path into operations-context; pull the
        // group so its stopIds pick up the freshly-attached member.
        await Promise.all([refreshGroups(), refreshOperations()])
      } finally {
        setIsAddingStop(false)
      }
    },
    [group, createOperation, refreshGroups, refreshOperations],
  )

  const reorder = useCallback(
    async (orderedIds: string[]): Promise<void> => {
      if (!group) return
      await reorderGroupStops(group.id, orderedIds)
    },
    [group, reorderGroupStops],
  )

  /**
   * Greedy nearest-neighbour over located stops from the chosen start anchor.
   * Returns proposed ordered ids (located first, then unlocated stops in their
   * original relative order). Pure — the caller previews then confirms via reorder.
   */
  const optimize = useCallback(
    (start: RouteStartMode): string[] => {
      if (!group) return []

      const located = orderedStops.filter((s) => isLocated(s.op)) as { id: string; op: Operation }[]
      const unlocated = orderedStops.filter((s) => !isLocated(s.op))

      if (located.length <= 1) return group.stopIds

      let anchor: [number, number] | null =
        start === "magazin" ? magazinCoords : start === "vehicle" ? vehicleStart : located[0].op.coordinates
      // Fall back to the first located stop when the requested anchor is unknown.
      if (!anchor) anchor = located[0].op.coordinates

      const remaining = [...located]
      const ordered: { id: string; op: Operation }[] = []
      let current: [number, number] = anchor
      while (remaining.length > 0) {
        let bestIdx = 0
        let bestDist = Infinity
        for (let i = 0; i < remaining.length; i++) {
          const d = haversineKm(current, remaining[i].op.coordinates)
          if (d < bestDist) {
            bestDist = d
            bestIdx = i
          }
        }
        const [next] = remaining.splice(bestIdx, 1)
        ordered.push(next)
        current = next.op.coordinates
      }

      return [...ordered.map((s) => s.id), ...unlocated.map((s) => s.id)]
    },
    [group, orderedStops, magazinCoords, vehicleStart],
  )

  return {
    group,
    stopIds: group?.stopIds ?? [],
    orderedStops,
    stops,
    operationsById,
    addStopAtLatLng,
    isAddingStop,
    reorder,
    optimize,
    magazinCoords,
    vehicleStart,
  }
}
