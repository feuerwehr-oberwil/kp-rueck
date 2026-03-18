"use client"

import { useState, useMemo, useEffect, useCallback } from "react"
import { Badge } from "@/components/ui/badge"
import { useOperations, type Operation } from "@/lib/contexts/operations-context"
import { usePersonnel } from "@/lib/contexts/personnel-context"
import { useAuth } from "@/lib/contexts/auth-context"
import { apiClient, type ApiVehiclePosition } from "@/lib/api-client"
import { columns, getTimeSince } from "@/lib/kanban-utils"
import { getIncidentTypeLabel } from "@/lib/incident-types"
import { Truck, Users, Siren, AlertTriangle, CheckCircle } from "lucide-react"
import { cn } from "@/lib/utils"

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
      completedCount: byStatus["complete"]?.length || 0,
      personnelTotal: personnel.length,
      personnelAssigned: assigned.length,
      personnelAvailable: available.length,
    }
  }, [operations, personnel])

  const vehicleStatus = useMemo(() => {
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

  const recentActivity = useMemo(() => {
    return [...operations]
      .sort((a, b) => {
        const aTime = a.statusChangedAt?.getTime() || a.dispatchTime.getTime() || 0
        const bTime = b.statusChangedAt?.getTime() || b.dispatchTime.getTime() || 0
        return bTime - aTime
      })
      .slice(0, 10)
  }, [operations])

  return (
    <div className="h-full grid grid-rows-[auto_1fr] gap-0 bg-muted/30 dark:bg-zinc-950/30">
      {/* ── KPI strip ─────────────────────────────────────── */}
      <div className="grid grid-cols-4 border-b border-border">
        <KpiCell
          value={stats.activeOperations}
          label="Aktiv"
          icon={<Siren className="h-4 w-4" />}
          urgent={stats.activeOperations > 0}
          color="text-orange-500 dark:text-orange-400"
          bgColor="bg-orange-500/8 dark:bg-orange-500/10"
        />
        <KpiCell
          value={stats.incomingCount}
          label="Eingegangen"
          icon={<AlertTriangle className="h-4 w-4" />}
          urgent={stats.incomingCount > 0}
          color="text-red-500 dark:text-red-400"
          bgColor="bg-red-500/8 dark:bg-red-500/10"
          borderLeft
        />
        <KpiCell
          value={`${stats.personnelAvailable}`}
          label={`von ${stats.personnelTotal} verfügbar`}
          icon={<Users className="h-4 w-4" />}
          urgent={stats.personnelAvailable === 0 && stats.personnelTotal > 0}
          color="text-blue-500 dark:text-blue-400"
          bgColor="bg-blue-500/8 dark:bg-blue-500/10"
          borderLeft
        />
        <KpiCell
          value={stats.completedCount}
          label="Abgeschlossen"
          icon={<CheckCircle className="h-4 w-4" />}
          color="text-emerald-500 dark:text-emerald-400"
          bgColor="bg-emerald-500/8 dark:bg-emerald-500/10"
          borderLeft
        />
      </div>

      {/* ── Main content ──────────────────────────────────── */}
      <div className="grid grid-cols-[1fr_340px] overflow-hidden">
        {/* Left: Vehicle roster */}
        <div className="overflow-y-auto p-4">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3 flex items-center gap-2">
            <Truck className="h-3.5 w-3.5" />
            Fahrzeuge
          </h2>

          <div className="grid grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-2">
            {vehicleStatus.map((v) => {
              const isDeployed = !!v.assignedOperation
              return (
                <div
                  key={v.id}
                  className={cn(
                    "rounded-md border p-3 transition-all relative",
                    isDeployed
                      ? "border-orange-500/40 bg-orange-500/5 dark:bg-orange-950/30"
                      : "border-border/60 bg-card/60 dark:bg-zinc-900/40"
                  )}
                >
                  {/* Status bar on left edge */}
                  <div
                    className={cn(
                      "absolute left-0 top-2 bottom-2 w-1 rounded-r-full",
                      isDeployed ? "bg-orange-500" : "bg-emerald-500/60"
                    )}
                  />

                  <div className="pl-2">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-bold text-sm tracking-tight">{v.name}</span>
                      <div className="flex items-center gap-1.5">
                        {v.gps && (
                          <div
                            className={cn(
                              "h-1.5 w-1.5 rounded-full",
                              v.gps.status === "online" ? "bg-emerald-500" : "bg-gray-400"
                            )}
                            title={v.gps.status === "online" ? "GPS online" : "GPS offline"}
                          />
                        )}
                        {v.gps && v.gps.speed !== null && v.gps.speed > 1 && (
                          <span className="text-[10px] font-mono text-muted-foreground tabular-nums">
                            {Math.round(v.gps.speed)}km/h
                          </span>
                        )}
                      </div>
                    </div>

                    {v.driverName && (
                      <p className="text-[11px] text-muted-foreground truncate">
                        {v.driverName}
                      </p>
                    )}

                    {isDeployed ? (
                      <div className="mt-1.5">
                        <p className="text-xs font-medium text-orange-600 dark:text-orange-400 truncate leading-tight">
                          {v.assignedOperation!.location}
                        </p>
                        <p className="text-[10px] text-muted-foreground font-mono tabular-nums mt-0.5">
                          {getTimeSince(v.assignedOperation!.statusChangedAt || v.assignedOperation!.dispatchTime)}
                        </p>
                      </div>
                    ) : (
                      <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium mt-1.5">
                        Bereit
                      </p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Right: Activity timeline */}
        <div className="border-l border-border overflow-y-auto">
          <div className="px-4 pt-4 pb-2 sticky top-0 bg-background/95 backdrop-blur-sm z-10 border-b border-border/50">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest flex items-center gap-2">
              <Siren className="h-3.5 w-3.5" />
              Einsätze
            </h2>
          </div>

          <div className="px-4 py-2">
            {recentActivity.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-12">
                Keine Einsätze
              </p>
            ) : (
              <div className="space-y-0">
                {recentActivity.map((op, idx) => {
                  const colDef = columns.find((c) => c.status.includes(op.status))
                  const isActive = op.status !== "complete"
                  return (
                    <div
                      key={op.id}
                      className={cn(
                        "relative pl-5 py-2.5",
                        idx < recentActivity.length - 1 && "border-b border-border/30"
                      )}
                    >
                      {/* Timeline dot */}
                      <div
                        className={cn(
                          "absolute left-0 top-3.5 h-2.5 w-2.5 rounded-full ring-2 ring-background",
                          op.priority === "high"
                            ? "bg-red-500"
                            : op.priority === "medium"
                              ? "bg-yellow-500"
                              : "bg-emerald-500",
                          !isActive && "opacity-40"
                        )}
                      />
                      {/* Connector line */}
                      {idx < recentActivity.length - 1 && (
                        <div className="absolute left-[4.5px] top-7 bottom-0 w-px bg-border/50" />
                      )}

                      <div className={cn(!isActive && "opacity-50")}>
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="text-sm font-medium truncate leading-tight">
                            {op.location}
                          </p>
                          <span className="text-[10px] text-muted-foreground font-mono tabular-nums flex-shrink-0">
                            {getTimeSince(op.statusChangedAt || op.dispatchTime)}
                          </span>
                        </div>

                        <div className="flex items-center gap-1.5 mt-1">
                          <span className="text-[10px] text-muted-foreground">
                            {getIncidentTypeLabel(op.incidentType)}
                          </span>
                          <span className="text-border">·</span>
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-[9px] px-1 py-0 h-4 font-medium border-0",
                              colDef?.color
                            )}
                          >
                            {colDef?.title || op.status}
                          </Badge>
                        </div>

                        {op.vehicles.length > 0 && (
                          <div className="flex gap-1 mt-1.5">
                            {op.vehicles.map((v, i) => (
                              <span
                                key={i}
                                className="text-[10px] font-medium text-foreground/70 bg-muted/80 px-1.5 py-0.5 rounded"
                              >
                                {v}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function KpiCell({
  value,
  label,
  icon,
  urgent,
  color,
  bgColor,
  borderLeft,
}: {
  value: number | string
  label: string
  icon: React.ReactNode
  urgent?: boolean
  color: string
  bgColor: string
  borderLeft?: boolean
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 px-5 py-3",
        bgColor,
        borderLeft && "border-l border-border"
      )}
    >
      <div className={cn("flex-shrink-0", color)}>{icon}</div>
      <div className="min-w-0">
        <p
          className={cn(
            "text-2xl font-bold tabular-nums leading-none",
            urgent && color
          )}
        >
          {value}
        </p>
        <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{label}</p>
      </div>
    </div>
  )
}
