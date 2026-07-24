"use client"

import { useMemo, useState, useEffect } from "react"
import { useTranslations } from "next-intl"
import { useSearchParams } from "next/navigation"
import { Loader2 } from "lucide-react"
import { getActiveLocale } from "@/lib/i18n-messages"
import { useAuth } from "@/lib/contexts/auth-context"
import { useStatusData, type VehicleWithStatus } from "@/lib/hooks/use-status-data"
import { columns, getTimeSince } from "@/lib/kanban-utils"
import { type Priority, PRIORITY_DOT_CLASSES } from "@/lib/priority"
import { RESOURCE_STATE_DOT_CLASSES } from "@/lib/resource-status"
import { getIncidentTypeLabel } from "@/lib/incident-types"
import { type Operation } from "@/lib/contexts/operations-context"
import { type Person } from "@/lib/contexts/personnel-context"
import { type Material } from "@/lib/contexts/materials-context"
import { type IncidentGroup } from "@/lib/types/groups"
import { apiClient, type ApiViewerData } from "@/lib/api-client"
import { buildSituationData, viewerGroupsToIncidentGroups, type SituationData } from "@/lib/viewer-data"
import { IncidentDetailModal } from "@/components/display/incident-detail-modal"
import { cn, formatLocationForDisplay, getGlobalHomeCity } from "@/lib/utils"

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

/** Short display label for an incident location (falls back to the type). */
function incidentLocationLabel(op: Operation): string {
  return formatLocationForDisplay(op.location, getGlobalHomeCity()) || getIncidentTypeLabel(op.incidentType)
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
  // Auftrag lookup for the detail dialog — the groups context is empty
  // without a login, so hand the payload's groups to the modal instead.
  const detailGroups = useMemo(
    () => (payload ? viewerGroupsToIncidentGroups(payload) : []),
    [payload],
  )

  if (!data) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }
  return <SituationBoard {...data} detailGroups={detailGroups} />
}

function SituationBoard({ stats, vehicleStatus, operations, personnel, materials, detailGroups }: SituationData & {
  /** Token mode only: payload-derived Aufträge for the detail dialog. */
  detailGroups?: IncidentGroup[]
}) {
  const t = useTranslations('display.status')
  const tk = useTranslations('kanban')
  const [selectedOperationId, setSelectedOperationId] = useState<string | null>(null)

  // Resolve from live data each render so the dialog stays in sync while open
  // and closes itself when the incident disappears.
  const selectedOperation = useMemo(
    () => operations.find((op) => op.id === selectedOperationId) ?? null,
    [operations, selectedOperationId],
  )

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
      for (const name of op.crew) map.set(name, incidentLocationLabel(op))
    }
    return map
  }, [operations])

  const materialAssignment = useMemo(() => {
    const map = new Map<string, string>()
    for (const op of operations) {
      for (const [matId] of op.materialAssignments) map.set(matId, incidentLocationLabel(op))
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
            <VehicleRow
              key={v.id}
              vehicle={v}
              onClick={v.assignedOperation ? () => setSelectedOperationId(v.assignedOperation!.id) : undefined}
            />
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
                    <IncidentRow key={op.id} operation={op} onClick={() => setSelectedOperationId(op.id)} />
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

      <IncidentDetailModal
        operation={selectedOperation}
        open={!!selectedOperation}
        onOpenChange={(open) => { if (!open) setSelectedOperationId(null) }}
        personnelOverride={personnel}
        materialsOverride={materials}
        groupsOverride={detailGroups}
      />
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

function VehicleRow({ vehicle: v, onClick }: { vehicle: VehicleWithStatus; onClick?: () => void }) {
  const isDeployed = !!v.assignedOperation
  return (
    <div
      className={cn(
        "flex items-center gap-3 px-3 xl:px-4 py-2 xl:py-2.5 rounded-md",
        isDeployed ? "bg-muted/40" : "bg-muted/20",
        onClick && "cursor-pointer transition-colors hover:bg-muted/60"
      )}
      onClick={onClick}
    >
      <div className={cn("w-3 h-3 xl:w-3.5 xl:h-3.5 rounded-sm shrink-0", RESOURCE_STATE_DOT_CLASSES[isDeployed ? "assigned" : "available"])} />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="font-bold text-sm xl:text-base">{v.name}</span>
          {v.driverName && <span className="text-[11px] xl:text-xs text-muted-foreground truncate">{v.driverName}</span>}
        </div>
        {isDeployed && (
          <p className="text-xs xl:text-sm text-muted-foreground truncate mt-0.5">→ {incidentLocationLabel(v.assignedOperation!)}</p>
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

function IncidentRow({ operation: op, onClick }: { operation: Operation; onClick: () => void }) {
  const statusId = columns.find((c) => c.status.includes(op.status))?.id || "incoming"
  const locationLabel = incidentLocationLabel(op)
  return (
    <div
      className={cn(
        "px-3 xl:px-4 py-2.5 xl:py-3 rounded-md border-l-3 cursor-pointer transition-colors hover:bg-muted/60",
        STATUS_BORDER[statusId],
        STATUS_BG[statusId],
      )}
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 min-w-0">
          <div className={cn(
            "w-2.5 h-2.5 xl:w-3 xl:h-3 rounded-full mt-1 shrink-0",
            PRIORITY_DOT_CLASSES[(op.priority ?? "low") as Priority]
          )} />
          <div className="min-w-0">
            <p className="text-sm xl:text-base font-semibold leading-tight truncate" title={locationLabel}>{locationLabel}</p>
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
      <span className={cn("h-1.5 w-1.5 xl:h-2 xl:w-2 rounded-full shrink-0", RESOURCE_STATE_DOT_CLASSES[isAssigned ? "assigned" : "available"])} />
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
      <span className={cn("h-1.5 w-1.5 xl:h-2 xl:w-2 rounded-full shrink-0", RESOURCE_STATE_DOT_CLASSES[isAssigned ? "assigned" : "available"])} />
      <span className="text-xs xl:text-sm truncate flex-1">{m.name}</span>
      {isAssigned && assignedLocation ? (
        <span className="text-[10px] xl:text-xs text-muted-foreground truncate max-w-[120px] xl:max-w-[160px] shrink-0">→ {assignedLocation}</span>
      ) : (
        !isAssigned && <span className="text-[10px] xl:text-xs text-muted-foreground shrink-0">{t('available')}</span>
      )}
    </div>
  )
}
