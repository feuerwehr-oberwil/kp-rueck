"use client"

/**
 * STATUS 2: "Situation Board"
 *
 * Inspired by military C2 situation rooms and fire service wallboards.
 * Three equal columns: Vehicles | Active Incidents | Personnel.
 * Each is a self-contained panel you can read from across the room.
 * Large type, high contrast, color-coded status blocks.
 */

import { useAuth } from "@/lib/contexts/auth-context"
import { useStatusData, type VehicleWithStatus } from "@/lib/hooks/use-status-data"
import { columns, getTimeSince } from "@/lib/kanban-utils"
import { getIncidentTypeLabel } from "@/lib/incident-types"
import { type Operation } from "@/lib/contexts/operations-context"
import { type Person } from "@/lib/contexts/personnel-context"
import { cn } from "@/lib/utils"

export default function Status2Page() {
  const { isAuthenticated } = useAuth()
  if (!isAuthenticated) {
    return <div className="flex h-full items-center justify-center text-muted-foreground">Zugang erforderlich</div>
  }
  return <SituationBoard />
}

function SituationBoard() {
  const { stats, vehicleStatus, operations, personnel } = useStatusData()

  const activeOps = operations.filter((op) => op.status !== "complete")

  // Group personnel by assignment status
  const assignedPersonnel = personnel.filter((p) => p.status === "assigned")
  const availablePersonnel = personnel.filter((p) => p.status === "available")

  return (
    <div className="h-full grid grid-cols-3 bg-background overflow-hidden">
      {/* ── Column 1: Vehicles ── */}
      <div className="flex flex-col border-r border-border overflow-hidden">
        <PanelHeader
          title="Fahrzeuge"
          count={vehicleStatus.length}
          accent="bg-blue-500"
        />
        <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
          {vehicleStatus.map((v) => (
            <VehicleRow key={v.id} vehicle={v} />
          ))}
        </div>
      </div>

      {/* ── Column 2: Active Incidents ── */}
      <div className="flex flex-col border-r border-border overflow-hidden">
        <PanelHeader
          title="Einsätze"
          count={activeOps.length}
          accent="bg-orange-500"
        />
        <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
          {activeOps.length === 0 ? (
            <div className="text-center text-muted-foreground py-12 text-sm">Keine aktiven Einsätze</div>
          ) : (
            activeOps.map((op) => <IncidentRow key={op.id} operation={op} />)
          )}
        </div>
      </div>

      {/* ── Column 3: Personnel ── */}
      <div className="flex flex-col overflow-hidden">
        <PanelHeader
          title="Personal"
          count={personnel.length}
          accent="bg-emerald-500"
          subtitle={`${stats.personnelAvailable} verfügbar`}
        />
        <div className="flex-1 overflow-y-auto">
          {/* Assigned section */}
          {assignedPersonnel.length > 0 && (
            <div>
              <div className="px-3 py-1.5 bg-orange-500/10 border-b border-border">
                <span className="text-[10px] font-semibold text-orange-600 dark:text-orange-400 uppercase tracking-wider">
                  Im Einsatz ({assignedPersonnel.length})
                </span>
              </div>
              <div className="p-2 space-y-0.5">
                {assignedPersonnel.map((p) => (
                  <PersonRow key={p.id} person={p} />
                ))}
              </div>
            </div>
          )}

          {/* Available section */}
          {availablePersonnel.length > 0 && (
            <div>
              <div className="px-3 py-1.5 bg-emerald-500/10 border-y border-border">
                <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">
                  Verfügbar ({availablePersonnel.length})
                </span>
              </div>
              <div className="p-2 space-y-0.5">
                {availablePersonnel.map((p) => (
                  <PersonRow key={p.id} person={p} />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function PanelHeader({ title, count, accent, subtitle }: {
  title: string; count: number; accent: string; subtitle?: string
}) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 border-b border-border bg-muted/40 shrink-0">
      <div className={cn("w-1 h-8 rounded-full", accent)} />
      <div className="flex-1">
        <div className="flex items-baseline gap-2">
          <h2 className="text-sm font-bold tracking-tight">{title}</h2>
          <span className="text-xl font-bold tabular-nums text-foreground/80">{count}</span>
        </div>
        {subtitle && (
          <p className="text-[10px] text-muted-foreground">{subtitle}</p>
        )}
      </div>
    </div>
  )
}

function VehicleRow({ vehicle: v }: { vehicle: VehicleWithStatus }) {
  const isDeployed = !!v.assignedOperation
  return (
    <div className={cn(
      "flex items-center gap-3 px-3 py-2 rounded-md",
      isDeployed ? "bg-orange-500/8 dark:bg-orange-950/30" : "bg-muted/30"
    )}>
      {/* Status indicator */}
      <div className={cn(
        "w-3 h-3 rounded-sm shrink-0",
        isDeployed ? "bg-orange-500" : "bg-emerald-500"
      )} />

      {/* Vehicle info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="font-bold text-sm">{v.name}</span>
          {v.driverName && (
            <span className="text-[11px] text-muted-foreground truncate">
              {v.driverName}
            </span>
          )}
        </div>
        {isDeployed && (
          <p className="text-xs text-orange-600 dark:text-orange-400 truncate mt-0.5">
            → {v.assignedOperation!.location}
          </p>
        )}
      </div>

      {/* Duration */}
      {isDeployed && (
        <span className="text-[11px] font-mono tabular-nums text-muted-foreground shrink-0">
          {getTimeSince(v.assignedOperation!.statusChangedAt || v.assignedOperation!.dispatchTime)}
        </span>
      )}
    </div>
  )
}

function IncidentRow({ operation: op }: { operation: Operation }) {
  const colDef = columns.find((c) => c.status.includes(op.status))
  return (
    <div className="px-3 py-2.5 rounded-md bg-muted/30">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 min-w-0">
          <div className={cn(
            "w-2.5 h-2.5 rounded-full mt-1 shrink-0",
            op.priority === "high" ? "bg-red-500" : op.priority === "medium" ? "bg-amber-500" : "bg-emerald-500"
          )} />
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-tight truncate">{op.location}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">{getIncidentTypeLabel(op.incidentType)}</p>
          </div>
        </div>
        <span className="text-[11px] font-mono tabular-nums text-muted-foreground shrink-0">
          {getTimeSince(op.statusChangedAt || op.dispatchTime)}
        </span>
      </div>

      <div className="flex items-center gap-2 mt-2 pl-4">
        <span className={cn(
          "text-[10px] font-medium px-1.5 py-0.5 rounded-sm",
          colDef?.color
        )}>
          {colDef?.title}
        </span>
        {op.vehicles.length > 0 && (
          <div className="flex gap-1">
            {op.vehicles.map((v, i) => (
              <span key={i} className="text-[10px] font-medium text-foreground/70 bg-muted px-1.5 py-0.5 rounded-sm">{v}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function PersonRow({ person: p }: { person: Person }) {
  const isAssigned = p.status === "assigned"
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-sm hover:bg-muted/30 transition-colors">
      <span className={cn(
        "h-1.5 w-1.5 rounded-full shrink-0",
        isAssigned ? "bg-orange-500" : "bg-emerald-500"
      )} />
      <span className="text-xs truncate flex-1">{p.name}</span>
      {p.role && (
        <span className="text-[10px] text-muted-foreground shrink-0">{p.role}</span>
      )}
      {p.isDriver && p.driverVehicleName && (
        <span className="text-[10px] text-blue-500 dark:text-blue-400 shrink-0">🚗 {p.driverVehicleName}</span>
      )}
    </div>
  )
}
