"use client"

import { useMemo } from "react"
import { useAuth } from "@/lib/contexts/auth-context"
import { useStatusData, type VehicleWithStatus } from "@/lib/hooks/use-status-data"
import { columns, getTimeSince } from "@/lib/kanban-utils"
import { getIncidentTypeLabel } from "@/lib/incident-types"
import { type Operation } from "@/lib/contexts/operations-context"
import { type Person } from "@/lib/contexts/personnel-context"
import { type Material } from "@/lib/contexts/materials-context"
import { cn } from "@/lib/utils"

// Status group ordering for incidents (workflow order)
const STATUS_ORDER = ["incoming", "ready", "enroute", "active", "returning"]

// Left border color per status for instant visual scanning
const STATUS_BORDER: Record<string, string> = {
  incoming: "border-l-slate-500",
  ready: "border-l-emerald-500",
  enroute: "border-l-blue-500",
  active: "border-l-orange-500",
  returning: "border-l-sky-500",
}

const STATUS_BG: Record<string, string> = {
  incoming: "bg-slate-500/5 dark:bg-slate-500/10",
  ready: "bg-emerald-500/5 dark:bg-emerald-500/10",
  enroute: "bg-blue-500/5 dark:bg-blue-500/10",
  active: "bg-orange-500/5 dark:bg-orange-500/10",
  returning: "bg-sky-500/5 dark:bg-sky-500/10",
}

export default function DisplayStatusPage() {
  const { isAuthenticated } = useAuth()
  if (!isAuthenticated) {
    return <div className="flex h-full items-center justify-center text-muted-foreground">Zugang erforderlich</div>
  }
  return <SituationBoard />
}

function SituationBoard() {
  const { stats, vehicleStatus, operations, personnel, materials } = useStatusData()

  // Group active incidents by status (workflow order)
  const incidentsByStatus = useMemo(() => {
    const groups: { colDef: typeof columns[number]; ops: Operation[] }[] = []
    for (const statusId of STATUS_ORDER) {
      const colDef = columns.find((c) => c.id === statusId)
      if (!colDef) continue
      const ops = operations.filter((op) => colDef.status.includes(op.status))
      if (ops.length > 0) groups.push({ colDef, ops })
    }
    return groups
  }, [operations])

  const totalActiveOps = operations.filter((op) => op.status !== "complete").length

  // Build lookups for assignments
  const personAssignment = useMemo(() => {
    const map = new Map<string, string>()
    for (const op of operations) {
      for (const name of op.crew) map.set(name, op.location)
    }
    return map
  }, [operations])

  const materialAssignment = useMemo(() => {
    const map = new Map<string, string>()
    for (const op of operations) {
      for (const [matId] of op.materialAssignments) map.set(matId, op.location)
    }
    return map
  }, [operations])

  // Personnel grouped by role, assigned first within each
  const groupedPersonnel = useMemo(() => {
    const sorted = [...personnel].sort((a, b) => {
      if (a.role !== b.role) return a.role.localeCompare(b.role, "de")
      if (a.status !== b.status) return a.status === "assigned" ? -1 : 1
      return a.name.localeCompare(b.name, "de")
    })
    const groups: { role: string; people: Person[] }[] = []
    const roleMap = new Map<string, Person[]>()
    for (const p of sorted) {
      const role = p.role || "Andere"
      if (!roleMap.has(role)) {
        const arr: Person[] = []
        roleMap.set(role, arr)
        groups.push({ role, people: arr })
      }
      roleMap.get(role)!.push(p)
    }
    return groups
  }, [personnel])

  // Materials grouped by category, assigned first
  const groupedMaterials = useMemo(() => {
    const sorted = [...materials].sort((a, b) => {
      if (a.category !== b.category) return a.category.localeCompare(b.category, "de")
      if (a.status !== b.status) return a.status === "assigned" ? -1 : 1
      return a.name.localeCompare(b.name, "de")
    })
    const groups: { category: string; items: Material[] }[] = []
    const catMap = new Map<string, Material[]>()
    for (const m of sorted) {
      if (!catMap.has(m.category)) {
        const arr: Material[] = []
        catMap.set(m.category, arr)
        groups.push({ category: m.category, items: arr })
      }
      catMap.get(m.category)!.push(m)
    }
    return groups
  }, [materials])

  const deployed = vehicleStatus.filter((v) => v.assignedOperation).length
  const assignedPersonnelCount = personnel.filter((p) => p.status === "assigned").length
  const assignedMaterialCount = materials.filter((m) => m.status === "assigned").length

  return (
    <div className="h-full grid grid-cols-4 bg-background overflow-hidden">
      {/* ── Column 1: Vehicles ── */}
      <div className="flex flex-col border-r border-border overflow-hidden">
        <PanelHeader
          title="Fahrzeuge"
          count={vehicleStatus.length}
          accent="bg-blue-500"
          subtitle={`${vehicleStatus.length - deployed} verfügbar · ${deployed} im Einsatz`}
        />
        <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
          {vehicleStatus.map((v) => (
            <VehicleRow key={v.id} vehicle={v} />
          ))}
        </div>
      </div>

      {/* ── Column 2: Active Incidents (grouped by status) ── */}
      <div className="flex flex-col border-r border-border overflow-hidden">
        <PanelHeader
          title="Einsätze"
          count={totalActiveOps}
          accent="bg-orange-500"
          subtitle={`${stats.incomingCount} eingegangen · ${stats.activeOperations - stats.incomingCount} in Bearbeitung`}
        />
        <div className="flex-1 overflow-y-auto">
          {incidentsByStatus.length === 0 ? (
            <div className="text-center text-muted-foreground py-12 text-sm">Keine aktiven Einsätze</div>
          ) : (
            incidentsByStatus.map(({ colDef, ops }) => (
              <div key={colDef.id}>
                <div className={cn("px-3 py-1.5 border-b border-border", colDef.color)}>
                  <span className="text-[10px] font-semibold text-foreground/70 uppercase tracking-wider">
                    {colDef.title} ({ops.length})
                  </span>
                </div>
                <div className="p-2 space-y-1.5">
                  {ops.map((op) => (
                    <IncidentRow key={op.id} operation={op} />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── Column 3: Personnel ── */}
      <div className="flex flex-col border-r border-border overflow-hidden">
        <PanelHeader
          title="Personal"
          count={personnel.length}
          accent="bg-emerald-500"
          subtitle={`${stats.personnelAvailable} verfügbar · ${assignedPersonnelCount} im Einsatz`}
        />
        <div className="flex-1 overflow-y-auto">
          {groupedPersonnel.map(({ role, people }) => (
            <div key={role}>
              <div className="px-3 py-1.5 bg-muted/40 border-b border-border">
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  {role} ({people.length})
                </span>
              </div>
              <div className="px-2 py-1 space-y-0.5">
                {people.map((p) => (
                  <PersonRow key={p.id} person={p} assignedLocation={personAssignment.get(p.name)} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Column 4: Materials ── */}
      <div className="flex flex-col overflow-hidden">
        <PanelHeader
          title="Material"
          count={materials.length}
          accent="bg-violet-500"
          subtitle={`${materials.length - assignedMaterialCount} verfügbar · ${assignedMaterialCount} im Einsatz`}
        />
        <div className="flex-1 overflow-y-auto">
          {groupedMaterials.map(({ category, items }) => {
            const catAssigned = items.filter((m) => m.status === "assigned").length
            return (
              <div key={category}>
                <div className="px-3 py-1.5 bg-muted/40 border-b border-border flex items-center justify-between">
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{category}</span>
                  <span className="text-[10px] text-muted-foreground tabular-nums">{items.length - catAssigned}/{items.length}</span>
                </div>
                <div className="px-2 py-1 space-y-0.5">
                  {items.map((m) => (
                    <MaterialRow key={m.id} material={m} assignedLocation={materialAssignment.get(m.id)} />
                  ))}
                </div>
              </div>
            )
          })}
          {materials.length === 0 && (
            <div className="text-center text-muted-foreground py-12 text-sm">Kein Material erfasst</div>
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
    <div className="flex items-center gap-3 px-3 py-2.5 border-b border-border bg-muted/40 shrink-0 min-h-[60px]">
      <div className={cn("w-1 self-stretch rounded-full", accent)} />
      <div className="flex-1">
        <div className="flex items-baseline gap-2">
          <h2 className="text-sm font-bold tracking-tight">{title}</h2>
          <span className="text-xl font-bold tabular-nums text-foreground/80">{count}</span>
        </div>
        {subtitle && <p className="text-[10px] text-muted-foreground">{subtitle}</p>}
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
      <div className={cn("w-3 h-3 rounded-sm shrink-0", isDeployed ? "bg-orange-500" : "bg-emerald-500")} />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="font-bold text-sm">{v.name}</span>
          {v.driverName && <span className="text-[11px] text-muted-foreground truncate">{v.driverName}</span>}
        </div>
        {isDeployed && (
          <p className="text-xs text-orange-600 dark:text-orange-400 truncate mt-0.5">→ {v.assignedOperation!.location}</p>
        )}
      </div>
      {isDeployed && (
        <span className="text-[11px] font-mono tabular-nums text-muted-foreground shrink-0">
          {getTimeSince(v.assignedOperation!.statusChangedAt || v.assignedOperation!.dispatchTime)}
        </span>
      )}
    </div>
  )
}

function IncidentRow({ operation: op }: { operation: Operation }) {
  const statusId = columns.find((c) => c.status.includes(op.status))?.id || "incoming"
  return (
    <div className={cn(
      "px-3 py-2.5 rounded-md border-l-3",
      STATUS_BORDER[statusId],
      STATUS_BG[statusId],
    )}>
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
      {op.vehicles.length > 0 && (
        <div className="flex gap-1 mt-1.5 pl-4">
          {op.vehicles.map((v, i) => (
            <span key={i} className="text-[10px] font-medium text-foreground/70 bg-background/60 px-1.5 py-0.5 rounded-sm">{v}</span>
          ))}
        </div>
      )}
    </div>
  )
}

function PersonRow({ person: p, assignedLocation }: { person: Person; assignedLocation?: string }) {
  const isAssigned = p.status === "assigned"
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-sm">
      <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", isAssigned ? "bg-orange-500" : "bg-emerald-500")} />
      <span className="text-xs truncate flex-1">{p.name}</span>
      {p.isDriver && p.driverVehicleName && (
        <span className="text-[10px] text-blue-500 dark:text-blue-400 shrink-0">{p.driverVehicleName}</span>
      )}
      {isAssigned && assignedLocation && (
        <span className="text-[10px] text-orange-600 dark:text-orange-400 truncate max-w-[120px] shrink-0">→ {assignedLocation}</span>
      )}
    </div>
  )
}

function MaterialRow({ material: m, assignedLocation }: { material: Material; assignedLocation?: string }) {
  const isAssigned = m.status === "assigned"
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-sm">
      <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", isAssigned ? "bg-orange-500" : "bg-emerald-500")} />
      <span className="text-xs truncate flex-1">{m.name}</span>
      {isAssigned && assignedLocation ? (
        <span className="text-[10px] text-orange-600 dark:text-orange-400 truncate max-w-[120px] shrink-0">→ {assignedLocation}</span>
      ) : (
        !isAssigned && <span className="text-[10px] text-muted-foreground shrink-0">verfügbar</span>
      )}
    </div>
  )
}
