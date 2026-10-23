"use client"

import { useMemo } from "react"
import { useOperations, type Operation } from "@/lib/contexts/operations-context"
import { usePersonnel } from "@/lib/contexts/personnel-context"
import { useGroups } from "@/lib/contexts/groups-context"
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
  const { operations, vehicles: boardVehicles } = useOperations()
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
