"use client"

/**
 * STATUS 3: "Operational Overview"
 *
 * Big-screen dashboard designed to be read from 3+ meters.
 * Huge numbers, minimal text. Vehicles as prominent horizontal bars
 * showing their assignment state. Incidents as compact status rows
 * underneath. Think airport departure boards meets fire service.
 */

import { useAuth } from "@/lib/contexts/auth-context"
import { useStatusData, type VehicleWithStatus } from "@/lib/hooks/use-status-data"
import { columns, getTimeSince } from "@/lib/kanban-utils"
import { getIncidentTypeLabel } from "@/lib/incident-types"
import { type Operation } from "@/lib/contexts/operations-context"
import { cn } from "@/lib/utils"

export default function Status3Page() {
  const { isAuthenticated } = useAuth()
  if (!isAuthenticated) {
    return <div className="flex h-full items-center justify-center text-muted-foreground">Zugang erforderlich</div>
  }
  return <OperationalOverview />
}

function OperationalOverview() {
  const { stats, vehicleStatus, operations } = useStatusData()

  const activeOps = operations
    .filter((op) => op.status !== "complete")
    .sort((a, b) => {
      // Sort by priority (high first), then by time
      const priorityOrder = { high: 0, medium: 1, low: 2 }
      const aPrio = priorityOrder[a.priority] ?? 2
      const bPrio = priorityOrder[b.priority] ?? 2
      if (aPrio !== bPrio) return aPrio - bPrio
      return (b.statusChangedAt?.getTime() || b.dispatchTime.getTime()) - (a.statusChangedAt?.getTime() || a.dispatchTime.getTime())
    })

  return (
    <div className="h-full flex flex-col bg-zinc-950 text-zinc-100 overflow-hidden">
      {/* ── Hero numbers ── */}
      <div className="grid grid-cols-4 shrink-0">
        <HeroNumber
          value={stats.activeOperations}
          label="Einsätze aktiv"
          color={stats.activeOperations > 0 ? "text-orange-400" : "text-zinc-600"}
          bg="bg-orange-500/5"
        />
        <HeroNumber
          value={stats.incomingCount}
          label="Eingegangen"
          color={stats.incomingCount > 0 ? "text-red-400" : "text-zinc-600"}
          bg="bg-red-500/5"
        />
        <HeroNumber
          value={stats.personnelAvailable}
          label={`von ${stats.personnelTotal} bereit`}
          color="text-blue-400"
          bg="bg-blue-500/5"
        />
        <HeroNumber
          value={vehicleStatus.filter((v) => !v.assignedOperation).length}
          label={`von ${vehicleStatus.length} verfügbar`}
          color="text-emerald-400"
          bg="bg-emerald-500/5"
        />
      </div>

      {/* ── Vehicle bars ── */}
      <div className="shrink-0 border-t border-zinc-800">
        <div className="px-4 py-2">
          <span className="text-[10px] text-zinc-600 uppercase tracking-[0.2em] font-medium">Fahrzeuge</span>
        </div>
        <div className="grid grid-cols-5 gap-0">
          {vehicleStatus.map((v) => (
            <VehicleBar key={v.id} vehicle={v} />
          ))}
        </div>
      </div>

      {/* ── Incident rows (airport departure board style) ── */}
      <div className="flex-1 overflow-y-auto border-t border-zinc-800">
        <div className="px-4 py-2 sticky top-0 bg-zinc-950 z-10 border-b border-zinc-800/50">
          <span className="text-[10px] text-zinc-600 uppercase tracking-[0.2em] font-medium">Einsätze</span>
        </div>

        {activeOps.length === 0 ? (
          <div className="text-center text-zinc-700 py-16 text-sm">Keine aktiven Einsätze</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="text-[10px] text-zinc-600 uppercase tracking-wider border-b border-zinc-800/50">
                <th className="text-left px-4 py-2 font-medium w-8"></th>
                <th className="text-left px-4 py-2 font-medium">Standort</th>
                <th className="text-left px-4 py-2 font-medium">Typ</th>
                <th className="text-left px-4 py-2 font-medium">Status</th>
                <th className="text-left px-4 py-2 font-medium">Fahrzeuge</th>
                <th className="text-right px-4 py-2 font-medium">Seit</th>
              </tr>
            </thead>
            <tbody>
              {activeOps.map((op) => (
                <IncidentTableRow key={op.id} operation={op} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function HeroNumber({ value, label, color, bg }: {
  value: number; label: string; color: string; bg: string
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center py-5", bg)}>
      <span className={cn("text-5xl font-black tabular-nums leading-none tracking-tight", color)}>
        {value}
      </span>
      <span className="text-[11px] text-zinc-500 mt-2 uppercase tracking-wider">{label}</span>
    </div>
  )
}

function VehicleBar({ vehicle: v }: { vehicle: VehicleWithStatus }) {
  const isDeployed = !!v.assignedOperation
  return (
    <div className={cn(
      "border-r border-zinc-800 last:border-r-0 px-3 py-3 transition-colors",
      isDeployed ? "bg-orange-950/40" : "bg-zinc-900/40"
    )}>
      <div className="flex items-center justify-between mb-1">
        <span className="font-bold text-base tracking-tight">{v.name}</span>
        <span className={cn(
          "text-[10px] font-semibold uppercase tracking-wider",
          isDeployed ? "text-orange-400" : "text-emerald-500"
        )}>
          {isDeployed ? "AKTIV" : "BEREIT"}
        </span>
      </div>

      {/* Assignment bar */}
      <div className={cn(
        "h-1.5 rounded-full w-full",
        isDeployed ? "bg-orange-500/60" : "bg-emerald-500/30"
      )} />

      <div className="mt-1.5 min-h-[2.5rem]">
        {v.driverName && (
          <p className="text-[11px] text-zinc-500 truncate">{v.driverName}</p>
        )}
        {isDeployed ? (
          <>
            <p className="text-xs text-orange-300/90 truncate">{v.assignedOperation!.location}</p>
            <p className="text-[10px] text-zinc-600 font-mono tabular-nums mt-0.5">
              {getTimeSince(v.assignedOperation!.statusChangedAt || v.assignedOperation!.dispatchTime)}
            </p>
          </>
        ) : (
          <p className="text-xs text-zinc-700 mt-0.5">—</p>
        )}
      </div>
    </div>
  )
}

function IncidentTableRow({ operation: op }: { operation: Operation }) {
  const colDef = columns.find((c) => c.status.includes(op.status))
  return (
    <tr className="border-b border-zinc-800/40 hover:bg-zinc-900/40 transition-colors">
      <td className="px-4 py-2.5">
        <div className={cn(
          "w-3 h-3 rounded-full",
          op.priority === "high" ? "bg-red-500" : op.priority === "medium" ? "bg-amber-500" : "bg-emerald-500"
        )} />
      </td>
      <td className="px-4 py-2.5">
        <span className="text-sm font-medium">{op.location}</span>
      </td>
      <td className="px-4 py-2.5 text-xs text-zinc-500">
        {getIncidentTypeLabel(op.incidentType)}
      </td>
      <td className="px-4 py-2.5">
        <span className={cn(
          "text-[11px] font-medium px-2 py-0.5 rounded-sm",
          colDef?.id === "incoming" && "bg-zinc-800 text-zinc-300",
          colDef?.id === "ready" && "bg-emerald-950 text-emerald-300",
          colDef?.id === "enroute" && "bg-blue-950 text-blue-300",
          colDef?.id === "active" && "bg-orange-950 text-orange-300",
          colDef?.id === "returning" && "bg-sky-950 text-sky-300",
        )}>
          {colDef?.title}
        </span>
      </td>
      <td className="px-4 py-2.5">
        {op.vehicles.length > 0 ? (
          <div className="flex gap-1.5">
            {op.vehicles.map((v, i) => (
              <span key={i} className="text-[11px] font-medium text-zinc-300 bg-zinc-800 px-1.5 py-0.5 rounded-sm">
                {v}
              </span>
            ))}
          </div>
        ) : (
          <span className="text-zinc-700 text-xs">—</span>
        )}
      </td>
      <td className="px-4 py-2.5 text-right">
        <span className="text-xs font-mono tabular-nums text-zinc-500">
          {getTimeSince(op.statusChangedAt || op.dispatchTime)}
        </span>
      </td>
    </tr>
  )
}
