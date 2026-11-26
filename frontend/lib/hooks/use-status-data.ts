"use client"

import type { VehicleDriver } from "@/lib/hooks/use-vehicle-drivers"
import { useMemo } from "react"
import { useOperations, type Operation } from "@/lib/contexts/operations-context"
import { usePersonnel } from "@/lib/contexts/personnel-context"
import { useMaterials } from "@/lib/contexts/materials-context"
import type { ApiVehiclePosition } from "@/lib/api-client"
import { columns } from "@/lib/kanban-utils"
import { personResourceState } from "@/lib/resource-status"
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
  driver: VehicleDriver | null
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
  const { operations, vehicles: boardVehicles } = useOperations()
  // `isOnAuftrag` folded in by the board: five people driving a Sturm route are not «verfügbar».
  const { personnel } = usePersonnel()
  const { materials } = useMaterials()
  // The fleet off the board sync, which reloads it on every `vehicle_update` and
  // polls while the socket is down — so «Nicht einsatzbereit» set mid-shift
  // reaches the wall without a reload (a display runs for days).
  const vehicles = useMemo(
    () =>
      boardVehicles.map((veh) => ({
        id: veh.id,
        name: veh.name,
        type: veh.type,
        status: veh.status,
        outOfService: veh.out_of_service ?? false,
        displayOrder: veh.display_order,
      })),
    [boardVehicles],
  )

  // The Statusanzeige is a wall: it keeps polling while hidden (see usePolling).
  const { positions: vehiclePositions } = useVehiclePositions({ pauseWhenHidden: false })

  const stats: StatusStats = useMemo(() => {
    const byStatus: Record<string, Operation[]> = {}
    columns.forEach((col) => { byStatus[col.id] = [] })
    operations.forEach((op) => {
      const col = columns.find((c) => c.id === op.status)
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
        const assignedOp = operations.find((op) => op.vehicles.some((av) => av.vehicleId === v.id))
        const gps = vehiclePositions.find(
          (vp) => vp.device_name.toLowerCase() === v.name.toLowerCase()
        )
        const driver = personnel.find((p) => p.isDriver && p.driverVehicleId === v.id)

        return { ...v, assignedOperation: assignedOp, gps, driver: driver ? { name: driver.name, personnelId: driver.id } : null }
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
