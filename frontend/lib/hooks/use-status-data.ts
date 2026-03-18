"use client"

import { useState, useMemo, useEffect, useCallback } from "react"
import { useOperations, type Operation } from "@/lib/contexts/operations-context"
import { usePersonnel, type Person } from "@/lib/contexts/personnel-context"
import { apiClient, type ApiVehiclePosition } from "@/lib/api-client"
import { columns } from "@/lib/kanban-utils"

export interface VehicleWithStatus {
  id: string
  name: string
  type: string
  status: string
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
  const { personnel } = usePersonnel()
  const [vehiclePositions, setVehiclePositions] = useState<ApiVehiclePosition[]>([])
  const [vehicles, setVehicles] = useState<Array<{ id: string; name: string; type: string; status: string }>>([])

  useEffect(() => {
    const load = async () => {
      try {
        const v = await apiClient.getVehicles()
        setVehicles(v.map((veh) => ({ id: veh.id, name: veh.name, type: veh.type, status: veh.status })))
      } catch { /* silent */ }
    }
    load()
  }, [])

  const fetchPositions = useCallback(async () => {
    try {
      const positions = await apiClient.getVehiclePositions()
      setVehiclePositions(positions)
    } catch { /* silent */ }
  }, [])

  useEffect(() => {
    const init = async () => {
      try {
        const status = await apiClient.getTraccarStatus()
        if (status.configured) {
          fetchPositions()
          const interval = setInterval(fetchPositions, 10000)
          return () => clearInterval(interval)
        }
      } catch { /* silent */ }
    }
    const cleanup = init()
    return () => { cleanup.then((fn) => fn?.()) }
  }, [fetchPositions])

  const stats: StatusStats = useMemo(() => {
    const byStatus: Record<string, Operation[]> = {}
    columns.forEach((col) => { byStatus[col.id] = [] })
    operations.forEach((op) => {
      const col = columns.find((c) => c.status.includes(op.status))
      if (col) byStatus[col.id].push(op)
    })

    const assigned = personnel.filter((p) => p.status === "assigned")
    const available = personnel.filter((p) => p.status === "available")
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
    return vehicles.map((v) => {
      const assignedOp = operations.find((op) =>
        op.vehicles.some((vName) => vName.toLowerCase() === v.name.toLowerCase())
      )
      const gps = vehiclePositions.find(
        (vp) => vp.device_name.toLowerCase() === v.name.toLowerCase()
      )
      const driver = personnel.find((p) => p.isDriver && p.driverVehicleName?.toLowerCase() === v.name.toLowerCase())

      return { ...v, assignedOperation: assignedOp, gps, driverName: driver?.name || null }
    })
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

  return { operations, personnel, stats, vehicleStatus, recentActivity }
}
