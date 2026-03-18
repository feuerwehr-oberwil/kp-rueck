"use client"

import { useState, useMemo, useEffect, useCallback } from "react"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useOperations, type Operation } from "@/lib/contexts/operations-context"
import { usePersonnel, type Person } from "@/lib/contexts/personnel-context"
import { useAuth } from "@/lib/contexts/auth-context"
import { apiClient, type ApiVehiclePosition } from "@/lib/api-client"
import { columns, getTimeSince } from "@/lib/kanban-utils"
import { Truck, Users, Siren, AlertTriangle, CheckCircle, Clock } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * /display/status — Glanceable KPI dashboard for command post monitors.
 * Large numbers, vehicle grid, personnel summary, activity feed.
 */
export default function DisplayStatusPage() {
  const { isAuthenticated } = useAuth()

  if (!isAuthenticated) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Bitte melden Sie sich an für die Status-Anzeige.
      </div>
    )
  }

  return <StatusDashboard />
}

function StatusDashboard() {
  const { operations } = useOperations()
  const { personnel } = usePersonnel()
  const [vehiclePositions, setVehiclePositions] = useState<ApiVehiclePosition[]>([])
  const [vehicles, setVehicles] = useState<Array<{ id: string; name: string; type: string; status: string }>>([])

  // Load vehicles
  useEffect(() => {
    const load = async () => {
      try {
        const v = await apiClient.getVehicles()
        setVehicles(v.map((veh) => ({ id: veh.id, name: veh.name, type: veh.type, status: veh.status })))
      } catch {
        // silent
      }
    }
    load()
  }, [])

  // Poll GPS positions
  const fetchPositions = useCallback(async () => {
    try {
      const positions = await apiClient.getVehiclePositions()
      setVehiclePositions(positions)
    } catch {
      // silent
    }
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
      } catch {
        // silent
      }
    }
    const cleanup = init()
    return () => { cleanup.then((fn) => fn?.()) }
  }, [fetchPositions])

  // Compute stats
  const stats = useMemo(() => {
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
      personnelTotal: personnel.length,
      personnelAssigned: assigned.length,
      personnelAvailable: available.length,
    }
  }, [operations, personnel])

  // Build vehicle status from operations
  const vehicleStatus = useMemo(() => {
    return vehicles.map((v) => {
      // Find which operation this vehicle is assigned to
      const assignedOp = operations.find((op) =>
        op.vehicles.some((vName) => vName.toLowerCase() === v.name.toLowerCase())
      )
      // Find GPS position
      const gps = vehiclePositions.find(
        (vp) => vp.device_name.toLowerCase() === v.name.toLowerCase()
      )
      // Find driver
      const driver = personnel.find((p) => p.isDriver && p.driverVehicleName?.toLowerCase() === v.name.toLowerCase())

      return {
        ...v,
        assignedOperation: assignedOp,
        gps,
        driverName: driver?.name || null,
      }
    })
  }, [vehicles, operations, vehiclePositions, personnel])

  // Recent activity (last 10 operations sorted by status change)
  const recentActivity = useMemo(() => {
    return [...operations]
      .sort((a, b) => {
        const aTime = a.statusChangedAt?.getTime() || a.dispatchTime.getTime() || 0
        const bTime = b.statusChangedAt?.getTime() || b.dispatchTime.getTime() || 0
        return bTime - aTime
      })
      .slice(0, 8)
  }, [operations])

  return (
    <div className="grid h-full grid-rows-[auto_1fr] gap-3 p-4">
      {/* Top row: KPI cards */}
      <div className="grid grid-cols-4 gap-3">
        <KpiCard
          label="Aktive Einsätze"
          value={stats.activeOperations}
          icon={<Siren className="h-5 w-5" />}
          accent={stats.activeOperations > 0 ? "text-orange-500" : "text-muted-foreground"}
        />
        <KpiCard
          label="Eingegangen"
          value={stats.incomingCount}
          icon={<AlertTriangle className="h-5 w-5" />}
          accent={stats.incomingCount > 0 ? "text-red-500" : "text-muted-foreground"}
        />
        <KpiCard
          label="Personal verfügbar"
          value={`${stats.personnelAvailable} / ${stats.personnelTotal}`}
          icon={<Users className="h-5 w-5" />}
          accent={stats.personnelAvailable === 0 && stats.personnelTotal > 0 ? "text-red-500" : "text-muted-foreground"}
        />
        <KpiCard
          label="Abgeschlossen"
          value={stats.byStatus["complete"]?.length || 0}
          icon={<CheckCircle className="h-5 w-5" />}
          accent="text-emerald-500"
        />
      </div>

      {/* Bottom row: Vehicle grid + Activity feed */}
      <div className="grid grid-cols-[2fr_1fr] gap-3 overflow-hidden">
        {/* Vehicle grid */}
        <Card className="p-4 overflow-y-auto">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Fahrzeuge
          </h2>
          <div className="grid grid-cols-2 xl:grid-cols-3 gap-2">
            {vehicleStatus.map((v) => (
              <div
                key={v.id}
                className={cn(
                  "rounded-lg border p-3 transition-all",
                  v.assignedOperation
                    ? "border-orange-500/50 bg-orange-500/5"
                    : "border-border bg-card/50"
                )}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <Truck className="h-4 w-4 text-muted-foreground" />
                    <span className="font-bold text-sm">{v.name}</span>
                  </div>
                  {v.gps && (
                    <div
                      className={cn(
                        "h-2 w-2 rounded-full",
                        v.gps.status === "online" ? "bg-emerald-500" : "bg-gray-400"
                      )}
                      title={v.gps.status === "online" ? "GPS online" : "GPS offline"}
                    />
                  )}
                </div>

                {v.driverName && (
                  <p className="text-xs text-muted-foreground mb-1">
                    Fahrer: {v.driverName}
                  </p>
                )}

                {v.assignedOperation ? (
                  <div className="text-xs">
                    <p className="font-medium text-orange-600 dark:text-orange-400 truncate">
                      {v.assignedOperation.location}
                    </p>
                    <p className="text-muted-foreground mt-0.5">
                      seit {getTimeSince(v.assignedOperation.statusChangedAt || v.assignedOperation.dispatchTime)}
                    </p>
                  </div>
                ) : (
                  <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                    Verfügbar
                  </p>
                )}

                {v.gps && v.gps.speed !== null && v.gps.speed > 1 && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {Math.round(v.gps.speed)} km/h
                  </p>
                )}
              </div>
            ))}
          </div>
        </Card>

        {/* Activity feed */}
        <Card className="p-4 overflow-y-auto">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Letzte Aktivität
          </h2>
          <div className="space-y-2">
            {recentActivity.map((op) => {
              const colDef = columns.find((c) => c.status.includes(op.status))
              return (
                <div key={op.id} className="flex items-start gap-2 py-2 border-b border-border/50 last:border-0">
                  <div className="flex-shrink-0 mt-0.5">
                    <div
                      className={cn(
                        "h-2 w-2 rounded-full",
                        op.priority === "high" ? "bg-red-500" : op.priority === "medium" ? "bg-yellow-500" : "bg-green-500"
                      )}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium truncate">
                      {op.location}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <Badge variant="outline" className="text-[10px] px-1 py-0">
                        {colDef?.title || op.status}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground font-mono">
                        {getTimeSince(op.statusChangedAt || op.dispatchTime)}
                      </span>
                    </div>
                    {op.vehicles.length > 0 && (
                      <div className="flex gap-1 mt-1">
                        {op.vehicles.map((v, i) => (
                          <span key={i} className="text-[10px] text-muted-foreground bg-muted px-1 rounded">
                            {v}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}

            {recentActivity.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">
                Keine Aktivität
              </p>
            )}
          </div>
        </Card>
      </div>
    </div>
  )
}

function KpiCard({
  label,
  value,
  icon,
  accent,
}: {
  label: string
  value: number | string
  icon: React.ReactNode
  accent: string
}) {
  return (
    <Card className="p-4 flex items-center gap-4">
      <div className={cn("flex-shrink-0", accent)}>{icon}</div>
      <div>
        <p className="text-2xl font-bold tabular-nums">{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
    </Card>
  )
}
