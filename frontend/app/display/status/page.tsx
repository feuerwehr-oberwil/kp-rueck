"use client"

import { useMemo, useState, useEffect } from "react"
import { useTranslations } from "next-intl"
import { useSearchParams } from "next/navigation"
import { Loader2 } from "lucide-react"
import { getActiveLocale } from "@/lib/i18n-messages"
import { useAuth } from "@/lib/contexts/auth-context"
import { useStatusData, type VehicleWithStatus, type StatusStats } from "@/lib/hooks/use-status-data"
import { columns, getTimeSince } from "@/lib/kanban-utils"
import { getIncidentTypeLabel } from "@/lib/incident-types"
import { type Operation, type OperationStatus } from "@/lib/contexts/operations-context"
import { type Person } from "@/lib/contexts/personnel-context"
import { type Material } from "@/lib/contexts/materials-context"
import { apiClient, type ApiViewerData, type ApiIncident } from "@/lib/api-client"
import { cn } from "@/lib/utils"

/** The view-model SituationBoard renders — fed by useStatusData (auth) or a token payload. */
interface SituationData {
  stats: StatusStats
  vehicleStatus: VehicleWithStatus[]
  operations: Operation[]
  personnel: Person[]
  materials: Material[]
}

const API_STATUS_TO_INTERNAL: Record<string, OperationStatus> = {
  eingegangen: "incoming",
  reko: "ready",
  reko_done: "rekoDone",
  disponiert: "enroute",
  einsatz: "active",
  einsatz_beendet: "returning",
  abschluss: "complete",
}

const STATUS_ORDER = ["incoming", "ready", "rekoDone", "enroute", "active", "returning"]

const STATUS_BORDER: Record<string, string> = {
  incoming: "border-l-slate-500",
  ready: "border-l-emerald-500",
  rekoDone: "border-l-teal-500",
  enroute: "border-l-blue-500",
  active: "border-l-orange-500",
  returning: "border-l-sky-500",
}

const STATUS_BG: Record<string, string> = {
  incoming: "bg-muted/30",
  ready: "bg-muted/30",
  rekoDone: "bg-muted/30",
  enroute: "bg-muted/30",
  active: "bg-muted/30",
  returning: "bg-muted/30",
}

export default function DisplayStatusPage() {
  const t = useTranslations('display.status')
  const searchParams = useSearchParams()
  const token = searchParams.get("token")
  const { isAuthenticated } = useAuth()

  if (token) return <TokenStatusView token={token} />
  if (!isAuthenticated) {
    return <div className="flex h-full items-center justify-center text-muted-foreground">{t('accessRequired')}</div>
  }
  return <AuthStatusView />
}

/** Authenticated display: view-model straight from the live contexts. */
function AuthStatusView() {
  const data = useStatusData()
  return <SituationBoard {...data} />
}

/** Token/read-only display: view-model polled from the share token payload. */
function TokenStatusView({ token }: { token: string }) {
  const [payload, setPayload] = useState<ApiViewerData | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const d = await apiClient.getViewerData(token)
        if (!cancelled) setPayload(d)
      } catch {
        // keep last-known payload on transient failures
      }
    }
    load()
    const id = window.setInterval(load, 5000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [token])

  const data = useMemo(() => (payload ? buildSituationData(payload) : null), [payload])

  if (!data) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }
  return <SituationBoard {...data} />
}

function SituationBoard({ stats, vehicleStatus, operations, personnel, materials }: SituationData) {
  const t = useTranslations('display.status')
  const tk = useTranslations('kanban')

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

  const groupedPersonnel = useMemo(() => {
    const sorted = [...personnel].sort((a, b) => {
      if (a.role !== b.role) {
        if (a.roleSortOrder !== b.roleSortOrder) return (a.roleSortOrder ?? 0) - (b.roleSortOrder ?? 0)
        return (a.role ?? "").localeCompare(b.role ?? "", getActiveLocale())
      }
      if (a.status !== b.status) return a.status === "assigned" ? -1 : 1
      return (a.name ?? "").localeCompare(b.name ?? "", getActiveLocale())
    })
    const groups: { role: string; people: Person[] }[] = []
    const roleMap = new Map<string, Person[]>()
    for (const p of sorted) {
      const role = p.role || t('otherRole')
      if (!roleMap.has(role)) {
        const arr: Person[] = []
        roleMap.set(role, arr)
        groups.push({ role, people: arr })
      }
      roleMap.get(role)!.push(p)
    }
    return groups
  }, [personnel])

  const groupedMaterials = useMemo(() => {
    const sorted = [...materials].sort((a, b) => {
      if (a.category !== b.category) {
        if (a.categorySortOrder !== b.categorySortOrder) return (a.categorySortOrder ?? 0) - (b.categorySortOrder ?? 0)
        return (a.category ?? "").localeCompare(b.category ?? "", getActiveLocale())
      }
      if (a.status !== b.status) return a.status === "assigned" ? -1 : 1
      return (a.name ?? "").localeCompare(b.name ?? "", getActiveLocale())
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
    <div className="h-full flex bg-background overflow-x-auto">
      {/* ── Column 1: Vehicles ── */}
      <div className="flex flex-1 flex-col min-w-[300px] border-r border-border overflow-hidden">
        <PanelHeader
          title={t('vehicles')}
          count={vehicleStatus.length}

          subtitle={t('availableDeployed', { available: vehicleStatus.length - deployed, deployed })}
        />
        <div className="flex-1 overflow-y-auto p-2 xl:p-3 space-y-1.5 xl:space-y-2">
          {vehicleStatus.map((v) => (
            <VehicleRow key={v.id} vehicle={v} />
          ))}
        </div>
      </div>

      {/* ── Column 2: Active Incidents ── */}
      <div className="flex flex-1 flex-col min-w-[300px] border-r border-border overflow-hidden">
        <PanelHeader
          title={t('incidents')}
          count={totalActiveOps}

          subtitle={t('incomingInProgress', { incoming: stats.incomingCount, inProgress: stats.activeOperations - stats.incomingCount })}
        />
        <div className="flex-1 overflow-y-auto">
          {incidentsByStatus.length === 0 ? (
            <div className="text-center text-muted-foreground py-12 text-sm xl:text-base">{t('noActiveIncidents')}</div>
          ) : (
            incidentsByStatus.map(({ colDef, ops }) => (
              <div key={colDef.id}>
                <div className={cn("px-3 xl:px-4 py-1.5 xl:py-2 border-b border-border", colDef.color)}>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] xl:text-xs font-bold text-foreground/70 uppercase tracking-wider">
                      {tk(`columns.${colDef.id}`)}
                    </span>
                    <span className="inline-flex items-center justify-center h-5 min-w-5 px-1 rounded-md bg-foreground/10 text-foreground text-[10px] xl:text-xs font-bold tabular-nums">
                      {ops.length}
                    </span>
                  </div>
                </div>
                <div className="p-2 xl:p-3 space-y-1.5 xl:space-y-2">
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
      <div className="flex flex-1 flex-col min-w-[300px] border-r border-border overflow-hidden">
        <PanelHeader
          title={t('personnel')}
          count={personnel.length}

          subtitle={t('availableDeployed', { available: stats.personnelAvailable, deployed: assignedPersonnelCount })}
        />
        <div className="flex-1 overflow-y-auto">
          {groupedPersonnel.map(({ role, people }) => (
            <div key={role}>
              <div className="px-3 xl:px-4 py-1.5 xl:py-2 bg-muted/40 border-b border-border">
                <span className="text-[10px] xl:text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  {role} ({people.length})
                </span>
              </div>
              <div className="px-2 xl:px-3 py-1 space-y-0.5 xl:space-y-1">
                {people.map((p) => (
                  <PersonRow key={p.id} person={p} assignedLocation={personAssignment.get(p.name)} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Column 4: Materials ── */}
      <div className="flex flex-1 flex-col min-w-[300px] overflow-hidden">
        <PanelHeader
          title={t('material')}
          count={materials.length}

          subtitle={t('availableDeployed', { available: materials.length - assignedMaterialCount, deployed: assignedMaterialCount })}
        />
        <div className="flex-1 overflow-y-auto">
          {groupedMaterials.map(({ category, items }) => {
            const catAssigned = items.filter((m) => m.status === "assigned").length
            return (
              <div key={category}>
                <div className="px-3 xl:px-4 py-1.5 xl:py-2 bg-muted/40 border-b border-border flex items-center justify-between">
                  <span className="text-[10px] xl:text-xs font-semibold text-muted-foreground uppercase tracking-wider">{category}</span>
                  <span className="text-[10px] xl:text-xs text-muted-foreground tabular-nums">{items.length - catAssigned}/{items.length}</span>
                </div>
                <div className="px-2 xl:px-3 py-1 space-y-0.5 xl:space-y-1">
                  {items.map((m) => (
                    <MaterialRow key={m.id} material={m} assignedLocation={materialAssignment.get(m.id)} />
                  ))}
                </div>
              </div>
            )
          })}
          {materials.length === 0 && (
            <div className="text-center text-muted-foreground py-12 text-sm xl:text-base">{t('noMaterial')}</div>
          )}
        </div>
      </div>
    </div>
  )
}

function PanelHeader({ title, count, subtitle }: {
  title: string; count: number; accent?: string; subtitle?: string
}) {
  return (
    <div className="px-3 xl:px-4 py-2.5 xl:py-3 border-b border-border bg-muted/40 shrink-0 min-h-[60px]">
      <div className="flex items-center justify-between">
        <h2 className="text-sm xl:text-base font-bold tracking-tight uppercase">{title}</h2>
        <span className="inline-flex items-center justify-center h-6 min-w-6 px-1.5 rounded-md bg-foreground/10 text-foreground text-xs xl:text-sm font-bold tabular-nums">
          {count}
        </span>
      </div>
      {subtitle && <p className="text-[10px] xl:text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
    </div>
  )
}

function VehicleRow({ vehicle: v }: { vehicle: VehicleWithStatus }) {
  const isDeployed = !!v.assignedOperation
  return (
    <div className={cn(
      "flex items-center gap-3 px-3 xl:px-4 py-2 xl:py-2.5 rounded-md",
      isDeployed ? "bg-muted/40" : "bg-muted/20"
    )}>
      <div className={cn("w-3 h-3 xl:w-3.5 xl:h-3.5 rounded-sm shrink-0", isDeployed ? "bg-orange-500" : "bg-emerald-500")} />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="font-bold text-sm xl:text-base">{v.name}</span>
          {v.driverName && <span className="text-[11px] xl:text-xs text-muted-foreground truncate">{v.driverName}</span>}
        </div>
        {isDeployed && (
          <p className="text-xs xl:text-sm text-muted-foreground truncate mt-0.5">→ {v.assignedOperation!.location}</p>
        )}
      </div>
      {isDeployed && (
        <span className="text-[11px] xl:text-xs font-mono tabular-nums text-muted-foreground shrink-0">
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
      "px-3 xl:px-4 py-2.5 xl:py-3 rounded-md border-l-3",
      STATUS_BORDER[statusId],
      STATUS_BG[statusId],
    )}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 min-w-0">
          <div className={cn(
            "w-2.5 h-2.5 xl:w-3 xl:h-3 rounded-full mt-1 shrink-0",
            op.priority === "high" ? "bg-red-500" : op.priority === "medium" ? "bg-amber-500" : "bg-emerald-500"
          )} />
          <div className="min-w-0">
            <p className="text-sm xl:text-base font-semibold leading-tight truncate">{op.location}</p>
            <p className="text-[11px] xl:text-xs text-muted-foreground mt-0.5">{getIncidentTypeLabel(op.incidentType)}</p>
          </div>
        </div>
        <span className="text-[11px] xl:text-xs font-mono tabular-nums text-muted-foreground shrink-0">
          {getTimeSince(op.statusChangedAt || op.dispatchTime)}
        </span>
      </div>
    </div>
  )
}

function PersonRow({ person: p, assignedLocation }: { person: Person; assignedLocation?: string }) {
  const isAssigned = p.status === "assigned"
  return (
    <div className="flex items-center gap-2 px-3 xl:px-4 py-1.5 xl:py-2 rounded-sm">
      <span className={cn("h-1.5 w-1.5 xl:h-2 xl:w-2 rounded-full shrink-0", isAssigned ? "bg-orange-500" : "bg-emerald-500")} />
      <span className="text-xs xl:text-sm truncate flex-1">{p.name}</span>
      {p.isDriver && p.driverVehicleName && (
        <span className="text-[10px] xl:text-xs text-blue-500 dark:text-blue-400 shrink-0">{p.driverVehicleName}</span>
      )}
      {isAssigned && assignedLocation && (
        <span className="text-[10px] xl:text-xs text-muted-foreground truncate max-w-[120px] xl:max-w-[160px] shrink-0">→ {assignedLocation}</span>
      )}
    </div>
  )
}

function MaterialRow({ material: m, assignedLocation }: { material: Material; assignedLocation?: string }) {
  const t = useTranslations('display.status')
  const isAssigned = m.status === "assigned"
  return (
    <div className="flex items-center gap-2 px-3 xl:px-4 py-1.5 xl:py-2 rounded-sm">
      <span className={cn("h-1.5 w-1.5 xl:h-2 xl:w-2 rounded-full shrink-0", isAssigned ? "bg-orange-500" : "bg-emerald-500")} />
      <span className="text-xs xl:text-sm truncate flex-1">{m.name}</span>
      {isAssigned && assignedLocation ? (
        <span className="text-[10px] xl:text-xs text-muted-foreground truncate max-w-[120px] xl:max-w-[160px] shrink-0">→ {assignedLocation}</span>
      ) : (
        !isAssigned && <span className="text-[10px] xl:text-xs text-muted-foreground shrink-0">{t('available')}</span>
      )}
    </div>
  )
}

/** Map an API incident (from the share-token payload) onto an Operation.
 *  Crew/material assignments aren't in the token payload, so those degrade to
 *  empty — the status board still shows incidents, vehicles, and the roster. */
function apiIncidentToOperation(a: ApiIncident): Operation {
  const lat = a.location_lat != null ? parseFloat(a.location_lat) : 47.51637699933488
  const lng = a.location_lng != null ? parseFloat(a.location_lng) : 7.561800450458299
  return {
    id: a.id,
    location: a.location_address || "",
    vehicle: "" as unknown as Operation["vehicle"],
    vehicles: (a.assigned_vehicles ?? []).map((v) => v.name),
    incidentType: a.type,
    dispatchTime: new Date(a.created_at),
    crew: [],
    priority: a.priority,
    status: API_STATUS_TO_INTERNAL[a.status] ?? "incoming",
    coordinates: [lat, lng],
    materials: [],
    notes: a.description ?? "",
    contact: a.contact ?? "",
    contactPhone: a.contact_phone ?? "",
    internalNotes: "",
    nachbarhilfe: a.nachbarhilfe ?? false,
    nachbarhilfeNote: a.nachbarhilfe_note ?? "",
    amWarten: a.am_warten ?? false,
    amWartenNote: a.am_warten_note ?? "",
    zuFuss: a.zu_fuss ?? false,
    groupId: a.group_id ?? null,
    groupPosition: a.group_position ?? 0,
    source: a.source,
    statusChangedAt: a.status_changed_at ? new Date(a.status_changed_at) : null,
    hasCompletedReko: a.has_completed_reko,
    rekoArrivedAt: a.reko_arrived_at ? new Date(a.reko_arrived_at) : null,
    rekoSummary: null,
    assignedReko: null,
    crewAssignments: new Map(),
    materialAssignments: new Map(),
    vehicleAssignments: new Map(),
    vehicleCallsigns: new Map(),
    vehicleDriverStay: new Map(),
  }
}

/** Build the full SituationBoard view-model from a share-token payload. */
function buildSituationData(payload: ApiViewerData): SituationData {
  const operations: Operation[] = payload.incidents.map(apiIncidentToOperation)

  const personnel: Person[] = payload.personnel.map((p) => ({
    id: p.id,
    name: p.name,
    role: p.role ?? "",
    status: p.availability === "assigned" ? "assigned" : "available",
    tags: p.tags ?? undefined,
    roleSortOrder: p.role_sort_order,
    diveraUserId: p.divera_user_id ?? null,
  }))

  const materials: Material[] = payload.materials.map((m) => ({
    id: m.id,
    name: m.name,
    category: m.location || "General",
    type: m.type || "Sonstiges",
    status: m.status === "available" ? "available" : "assigned",
    categorySortOrder: m.location_sort_order,
    consumable: m.consumable ?? false,
    groupId: m.group_id,
  }))

  const vehicleStatus: VehicleWithStatus[] = payload.vehicles
    .map((v) => {
      const assignedOperation = operations.find((op) =>
        op.vehicles.some((vName) => vName.toLowerCase() === v.name.toLowerCase())
      )
      const gps = payload.vehicle_positions.find(
        (vp) => vp.device_name.toLowerCase() === v.name.toLowerCase()
      )
      return {
        id: v.id,
        name: v.name,
        type: v.type,
        status: v.status,
        displayOrder: v.display_order,
        assignedOperation,
        gps,
        driverName: null,
      }
    })
    .sort((a, b) => a.displayOrder - b.displayOrder)

  const byStatus: Record<string, Operation[]> = {}
  columns.forEach((col) => { byStatus[col.id] = [] })
  operations.forEach((op) => {
    const col = columns.find((c) => c.status.includes(op.status))
    if (col) byStatus[col.id].push(op)
  })
  const activeOps = operations.filter((op) => op.status !== "complete")
  const stats: StatusStats = {
    byStatus,
    totalOperations: operations.length,
    activeOperations: activeOps.length,
    incomingCount: byStatus["incoming"]?.length || 0,
    completedCount: byStatus["complete"]?.length || 0,
    personnelTotal: personnel.length,
    personnelAssigned: personnel.filter((p) => p.status === "assigned").length,
    personnelAvailable: personnel.filter((p) => p.status === "available").length,
  }

  return { stats, vehicleStatus, operations, personnel, materials }
}
