"use client"

/**
 * STATUS 1: "Dispatch Console"
 *
 * Inspired by 911 dispatch centers and air traffic control.
 * Dark, dense, monospaced, table-driven. Every pixel is information.
 * Vehicles as a dense status table. Incidents as a scrolling log.
 * No cards, no rounded corners — pure data grid.
 */

import { useAuth } from "@/lib/contexts/auth-context"
import { useStatusData } from "@/lib/hooks/use-status-data"
import { columns, getTimeSince } from "@/lib/kanban-utils"
import { getIncidentTypeLabel } from "@/lib/incident-types"
import { cn } from "@/lib/utils"

export default function Status1Page() {
  const { isAuthenticated } = useAuth()
  if (!isAuthenticated) {
    return <div className="flex h-full items-center justify-center text-muted-foreground">Zugang erforderlich</div>
  }
  return <DispatchConsole />
}

function DispatchConsole() {
  const { stats, vehicleStatus, recentActivity, personnel } = useStatusData()

  const deployed = vehicleStatus.filter((v) => v.assignedOperation)
  const ready = vehicleStatus.filter((v) => !v.assignedOperation)

  return (
    <div className="h-full flex flex-col bg-zinc-950 text-zinc-200 font-mono text-sm overflow-hidden">
      {/* ── Top ticker: live numbers ── */}
      <div className="flex items-stretch border-b border-zinc-800 bg-zinc-900/80 shrink-0">
        <Metric label="AKTIV" value={stats.activeOperations} alert={stats.activeOperations > 0} />
        <Metric label="EINGEHEND" value={stats.incomingCount} alert={stats.incomingCount > 0} />
        <Metric label="DISPONIERT" value={stats.byStatus["enroute"]?.length || 0} />
        <Metric label="IM EINSATZ" value={stats.byStatus["active"]?.length || 0} />
        <Metric label="ABGESCHL." value={stats.completedCount} />
        <div className="border-l border-zinc-800" />
        <Metric label="PERSONAL" value={`${stats.personnelAvailable}/${stats.personnelTotal}`} alert={stats.personnelAvailable === 0 && stats.personnelTotal > 0} />
        <Metric label="FAHRZEUGE" value={`${ready.length}/${vehicleStatus.length}`} />
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* ── Left: Vehicle table ── */}
        <div className="flex-1 overflow-y-auto border-r border-zinc-800">
          <table className="w-full">
            <thead className="sticky top-0 bg-zinc-900 z-10">
              <tr className="text-[10px] text-zinc-500 uppercase tracking-widest">
                <th className="text-left px-3 py-2 font-medium">Fahrzeug</th>
                <th className="text-left px-3 py-2 font-medium">Status</th>
                <th className="text-left px-3 py-2 font-medium">Fahrer</th>
                <th className="text-left px-3 py-2 font-medium">Einsatzort</th>
                <th className="text-right px-3 py-2 font-medium">Dauer</th>
                <th className="text-right px-3 py-2 font-medium">GPS</th>
              </tr>
            </thead>
            <tbody>
              {vehicleStatus.map((v) => {
                const isDeployed = !!v.assignedOperation
                return (
                  <tr
                    key={v.id}
                    className={cn(
                      "border-t border-zinc-800/60 hover:bg-zinc-800/30 transition-colors",
                      isDeployed && "bg-orange-950/20"
                    )}
                  >
                    <td className="px-3 py-2.5">
                      <span className="font-bold text-zinc-100">{v.name}</span>
                      <span className="text-zinc-600 ml-2 text-xs">{v.type}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      {isDeployed ? (
                        <span className="inline-flex items-center gap-1.5">
                          <span className="h-1.5 w-1.5 rounded-full bg-orange-500 animate-pulse" />
                          <span className="text-orange-400 text-xs">IM EINSATZ</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                          <span className="text-emerald-400 text-xs">BEREIT</span>
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-zinc-400 text-xs">
                      {v.driverName || "—"}
                    </td>
                    <td className="px-3 py-2.5 text-xs truncate max-w-[200px]">
                      {isDeployed ? (
                        <span className="text-orange-300">{v.assignedOperation!.location}</span>
                      ) : (
                        <span className="text-zinc-600">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right text-xs tabular-nums text-zinc-500">
                      {isDeployed
                        ? getTimeSince(v.assignedOperation!.statusChangedAt || v.assignedOperation!.dispatchTime)
                        : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {v.gps ? (
                        <span className={cn(
                          "text-[10px]",
                          v.gps.status === "online" ? "text-emerald-500" : "text-zinc-600"
                        )}>
                          {v.gps.status === "online" ? "ON" : "OFF"}
                          {v.gps.speed !== null && v.gps.speed > 1 && (
                            <span className="text-zinc-500 ml-1">{Math.round(v.gps.speed)}km/h</span>
                          )}
                        </span>
                      ) : (
                        <span className="text-zinc-700 text-[10px]">N/A</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* ── Right: Incident log ── */}
        <div className="w-[400px] overflow-y-auto">
          <div className="sticky top-0 bg-zinc-900 z-10 px-3 py-2 border-b border-zinc-800">
            <span className="text-[10px] text-zinc-500 uppercase tracking-widest font-medium">Einsatzlog</span>
          </div>

          {recentActivity.length === 0 ? (
            <div className="px-3 py-12 text-center text-zinc-600">Keine Einsätze</div>
          ) : (
            recentActivity.map((op, idx) => {
              const colDef = columns.find((c) => c.status.includes(op.status))
              const isComplete = op.status === "complete"
              return (
                <div
                  key={op.id}
                  className={cn(
                    "px-3 py-2.5 border-b border-zinc-800/50",
                    !isComplete && "hover:bg-zinc-800/20",
                    isComplete && "opacity-40"
                  )}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={cn(
                        "h-2 w-2 rounded-full shrink-0",
                        op.priority === "high" ? "bg-red-500" : op.priority === "medium" ? "bg-amber-500" : "bg-emerald-500"
                      )} />
                      <span className="text-xs font-medium text-zinc-200 truncate">{op.location}</span>
                    </div>
                    <span className="text-[10px] text-zinc-600 tabular-nums shrink-0">
                      {getTimeSince(op.statusChangedAt || op.dispatchTime)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-1 pl-4">
                    <span className="text-[10px] text-zinc-500">{getIncidentTypeLabel(op.incidentType)}</span>
                    <span className="text-zinc-700">·</span>
                    <span className={cn(
                      "text-[10px] font-medium",
                      colDef?.id === "incoming" && "text-zinc-400",
                      colDef?.id === "enroute" && "text-blue-400",
                      colDef?.id === "active" && "text-orange-400",
                      colDef?.id === "returning" && "text-sky-400",
                      colDef?.id === "complete" && "text-zinc-600",
                    )}>
                      {colDef?.title}
                    </span>
                  </div>
                  {op.vehicles.length > 0 && (
                    <div className="flex gap-1.5 mt-1.5 pl-4">
                      {op.vehicles.map((v, i) => (
                        <span key={i} className="text-[10px] text-zinc-400 bg-zinc-800 px-1.5 py-0.5 rounded-sm">{v}</span>
                      ))}
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}

function Metric({ label, value, alert }: { label: string; value: number | string; alert?: boolean }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-r border-zinc-800 last:border-r-0">
      <span className={cn(
        "text-xl font-bold tabular-nums leading-none",
        alert ? "text-red-400" : "text-zinc-100"
      )}>
        {value}
      </span>
      <span className="text-[10px] text-zinc-500 uppercase tracking-wider leading-tight">{label}</span>
    </div>
  )
}
