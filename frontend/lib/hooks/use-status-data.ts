"use client"

import { useState, useMemo, useEffect, useCallback } from "react"
import { useOperations, type Operation } from "@/lib/contexts/operations-context"
import { usePersonnel } from "@/lib/contexts/personnel-context"
import { useGroups } from "@/lib/contexts/groups-context"
import { useMaterials } from "@/lib/contexts/materials-context"
import { apiClient, type ApiVehiclePosition } from "@/lib/api-client"
import { columns } from "@/lib/kanban-utils"
import { personResourceState } from "@/lib/resource-status"
import { wsClient, type WebSocketStatus } from "@/lib/websocket-client"
import { useVehiclePositions } from "@/lib/hooks/use-vehicle-positions"

export interface VehicleWithStatus {
  id: string
  name: string
  type: string
  /** LEGACY mirror of `outOfService`, kept in lockstep server-side. Read
   *  `outOfService` for readiness — see lib/resource-status.ts. */
  status: string
  /** «Nicht einsatzbereit» — beats deployment, which beats «verfügbar». */
  outOfService: boolean
  displayOrder: number
  assignedOperation: Operation | undefined
  gps: ApiVehiclePosition | undefined
  driverName: string | null
}

export interface StatusStats {
  byStatus: Record<string, Operation[]>
  totalOperations: number
  activeOperations: number
  incomingCount: number
  completedCount: number
  personnelTotal: number
  personnelAssigned: number
  personnelAvailable: number
}

export function useStatusData() {
  const { operations } = useOperations()
  const { personnel: rosterPersonnel } = usePersonnel()
  const { occupiedResourceIds } = useGroups()
  const { materials } = useMaterials()

  /**
   * The roster with «steht auf einem Auftrag» folded in — the same enrichment the
   * board does, for the same reason.
   *
   * A route's crew lives on the group, and `GroupsProvider` sits inside
   * `OperationsProvider`, so the reconciliation that sets `status` cannot see it.
   * Without this the Statusanzeige on the wall read «5 verfügbar / 0 im Einsatz»
   * for five people driving a Sturm route, while the board in the same room had
   * them greyed out — the one number a Kommandant reads off that wall, wrong.
   */
  const personnel = useMemo(
    () =>
      rosterPersonnel.map((person) =>
        occupiedResourceIds.personnel.has(person.id) ? { ...person, isOnAuftrag: true } : person,
      ),
    [rosterPersonnel, occupiedResourceIds],
  )
  const [vehicles, setVehicles] = useState<Array<Omit<VehicleWithStatus, 'assignedOperation' | 'gps' | 'driverName'>>>([])

  const fetchVehicles = useCallback(async () => {
    try {
      const v = await apiClient.getVehicles()
      setVehicles(v.map((veh) => ({
        id: veh.id,
        name: veh.name,
        type: veh.type,
        status: veh.status,
        outOfService: veh.out_of_service ?? false,
        displayOrder: veh.display_order,
      })))
    } catch { /* silent */ }
  }, [])

  // Load the fleet and KEEP it fresh. This used to be a mount-only fetch, so
  // «Nicht einsatzbereit» set or cleared mid-shift never reached the wall
  // display until somebody reloaded it — and a display runs for days.
  // `vehicle_update` (room "operations", joined on connect) fires on every
  // fleet change; its payload varies by action (full vehicle on update, bare
  // id on delete), so refetch the list instead of patching it. While the
  // socket is down, a slow poll covers the gap — at a wall-display pace
  // instead of GPS pace.
  useEffect(() => {
    let pollInterval: NodeJS.Timeout | undefined

    fetchVehicles()
    const unsubscribeUpdate = wsClient.on('vehicle_update', () => {
      void fetchVehicles()
    })
    const unsubscribeStatus = wsClient.onStatusChange((wsStatus: WebSocketStatus) => {
      if (wsStatus === 'disconnected' || wsStatus === 'error') {
        if (!pollInterval) {
          pollInterval = setInterval(() => void fetchVehicles(), 30000)
        }
      } else if (wsStatus === 'connected') {
        if (pollInterval) {
          clearInterval(pollInterval)
          pollInterval = undefined
        }
      }
    })

    return () => {
      if (pollInterval) clearInterval(pollInterval)
      unsubscribeUpdate()
      unsubscribeStatus()
    }
  }, [fetchVehicles])

  // The Statusanzeige is a wall: it keeps polling while hidden (see usePolling).
  const { positions: vehiclePositions } = useVehiclePositions({ pauseWhenHidden: false })

  const stats: StatusStats = useMemo(() => {
    const byStatus: Record<string, Operation[]> = {}
    columns.forEach((col) => { byStatus[col.id] = [] })
    operations.forEach((op) => {
      const col = columns.find((c) => c.status.includes(op.status))
      if (col) byStatus[col.id].push(op)
    })

    // via personResourceState so somebody out on a Reko — or on an Auftrag —
    // is not counted as free
    const assigned = personnel.filter((p) => personResourceState(p) === "assigned")
    const available = personnel.filter((p) => personResourceState(p) === "available")
    const activeOps = operations.filter((op) => op.status !== "complete")

    return {
      byStatus,
      totalOperations: operations.length,
      activeOperations: activeOps.length,
      incomingCount: byStatus["incoming"]?.length || 0,
      completedCount: byStatus["complete"]?.length || 0,
      personnelTotal: personnel.length,
      personnelAssigned: assigned.length,
      personnelAvailable: available.length,
    }
  }, [operations, personnel])

  const vehicleStatus: VehicleWithStatus[] = useMemo(() => {
    return vehicles
      .map((v) => {
        const assignedOp = operations.find((op) =>
          op.vehicles.some((vName) => vName.toLowerCase() === v.name.toLowerCase())
        )
        const gps = vehiclePositions.find(
          (vp) => vp.device_name.toLowerCase() === v.name.toLowerCase()
        )
        const driver = personnel.find((p) => p.isDriver && p.driverVehicleName?.toLowerCase() === v.name.toLowerCase())

        return { ...v, assignedOperation: assignedOp, gps, driverName: driver?.name || null }
      })
      .sort((a, b) => a.displayOrder - b.displayOrder)
  }, [vehicles, operations, vehiclePositions, personnel])

  const recentActivity: Operation[] = useMemo(() => {
    return [...operations]
      .sort((a, b) => {
        const aTime = a.statusChangedAt?.getTime() || a.dispatchTime.getTime() || 0
        const bTime = b.statusChangedAt?.getTime() || b.dispatchTime.getTime() || 0
        return bTime - aTime
      })
      .slice(0, 12)
  }, [operations])

  return { operations, personnel, materials, stats, vehicleStatus, recentActivity }
}
