"use client"

import { useMemo, useState, useEffect } from "react"
import { useTranslations } from "next-intl"
import { useSearchParams } from "next/navigation"
import { Loader2, Binoculars, Package2, Infinity as InfinityIcon } from "lucide-react"
import { getActiveLocale } from "@/lib/i18n-messages"
import { useAuth } from "@/lib/contexts/auth-context"
import { useStatusData, type VehicleWithStatus } from "@/lib/hooks/use-status-data"
import { ageLevel, columns, getTimeSince } from "@/lib/kanban-utils"
import { useCollapsedSections } from "@/lib/hooks/use-collapsed-sections"
import { CollapsibleSection } from "@/components/display/collapsible-section"
import { type Priority, PRIORITY_DOT_CLASSES, PRIORITY_TEXT_CLASSES } from "@/lib/priority"
import { RESOURCE_STATE_DOT_CLASSES, materialResourceState, personResourceState } from "@/lib/resource-status"
import { getIncidentTypeLabel, getIncidentLocationLabel } from "@/lib/incident-types"
import { type Operation } from "@/lib/contexts/operations-context"
import { type Person } from "@/lib/contexts/personnel-context"
import { type Material } from "@/lib/contexts/materials-context"
import { type IncidentGroup } from "@/lib/types/groups"
import { apiClient, type ApiViewerData } from "@/lib/api-client"
import { buildSituationData, viewerGroupsToIncidentGroups, type SituationData } from "@/lib/viewer-data"
import { IncidentDetailModal } from "@/components/display/incident-detail-modal"
import { cn } from "@/lib/utils"

const STATUS_ORDER = ["incoming", "ready", "rekoDone", "enroute", "active", "returning"]

/** Per-device fold state for this display (see useCollapsedSections). */
const STATUS_COLLAPSE_KEY = "kp-display-status-collapsed"

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

/** Short display label for an incident location (falls back to the type).
 *  Server-computed (locationDisplay) — final on first paint, no reformat flash. */
const incidentLocationLabel = getIncidentLocationLabel

/** Clickable "→ Einsatz" reference on an assigned resource row. */
interface AssignmentRef {
  operationId: string
  label: string
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
  // Every section folds; all of them start open. A big station scrolls forever
  // otherwise — but nothing folds itself away without someone deciding so.
  const sections = useCollapsedSections(STATUS_COLLAPSE_KEY)

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

  // name/id → { incident id, short label } so the "→ Einsatz" reference is
  // itself clickable and jumps straight to that incident's detail dialog.
  const personAssignment = useMemo(() => {
    const map = new Map<string, AssignmentRef>()
    for (const op of operations) {
      for (const name of op.crew) map.set(name, { operationId: op.id, label: incidentLocationLabel(op) })
    }
    return map
  }, [operations])

  // Material → EVERY incident it sits on. Verbrauchsmaterial is unlimited and
  // routinely runs on several at once; keeping only the last one made the row
  // claim it was on exactly one incident, which is a lie the board can't afford.
  const materialAssignment = useMemo(() => {
    const map = new Map<string, AssignmentRef[]>()
    for (const op of operations) {
      for (const [matId] of op.materialAssignments) {
        const ref = { operationId: op.id, label: incidentLocationLabel(op) }
        const refs = map.get(matId)
        if (refs) refs.push(ref)
        else map.set(matId, [ref])
      }
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
  // «im Einsatz» must agree with the dots beside the names: a Reko is an Auftrag.
  const assignedPersonnelCount = personnel.filter((p) => personResourceState(p) === "assigned").length
  // Verbrauchsmaterial never counts as gone — see materialResourceState.
  const assignedMaterialCount = materials.filter((m) => materialResourceState(m) === "assigned").length

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
              <CollapsibleSection
                key={colDef.id}
                label={tk(`columns.${colDef.id}`)}
                count={ops.length}
                // An incident stuck in this status past the board's own warning
                // threshold keeps showing up on the folded header — a section
                // that hides the overdue one is worse than no folding at all.
                alarm={ops.some((op) => ageLevel(op.statusChangedAt || op.dispatchTime) !== "normal")}
                collapsed={sections.isCollapsed(`status:${colDef.id}`)}
                onToggle={() => sections.toggle(`status:${colDef.id}`)}
                headerClassName={colDef.color}
              >
                <div className="p-2 xl:p-3 space-y-1.5 xl:space-y-2">
                  {ops.map((op) => (
                    <IncidentRow key={op.id} operation={op} onClick={() => setSelectedOperationId(op.id)} />
                  ))}
                </div>
              </CollapsibleSection>
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
          {groupedPersonnel.map(({ role, people }) => {
            const free = people.filter((p) => personResourceState(p) !== "assigned").length
            return (
              <CollapsibleSection
                key={role}
                label={role}
                count={people.length}
                // How many of this Funktion are still free has to survive the
                // fold — «Maschinisten 6» tells nobody that all six are out.
                badge={
                  <span className={cn(
                    "shrink-0 text-[10px] xl:text-xs tabular-nums",
                    free === 0 ? cn("font-semibold", PRIORITY_TEXT_CLASSES.medium) : "text-muted-foreground",
                  )}>
                    {t('freeOfTotal', { free, total: people.length })}
                  </span>
                }
                collapsed={sections.isCollapsed(`role:${role}`)}
                onToggle={() => sections.toggle(`role:${role}`)}
                headerClassName="bg-muted/40"
              >
                <div className="px-2 xl:px-3 py-1 space-y-0.5 xl:space-y-1">
                  {people.map((p) => (
                    <PersonRow key={p.id} person={p} assignedTo={personAssignment.get(p.name)} onOpenIncident={setSelectedOperationId} />
                  ))}
                </div>
              </CollapsibleSection>
            )
          })}
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
            const free = items.length - items.filter((m) => materialResourceState(m) === "assigned").length
            return (
              <CollapsibleSection
                key={category}
                label={category}
                count={items.length}
                badge={
                  <span className={cn(
                    "shrink-0 text-[10px] xl:text-xs tabular-nums",
                    free === 0 ? cn("font-semibold", PRIORITY_TEXT_CLASSES.medium) : "text-muted-foreground",
                  )}>
                    {t('freeOfTotal', { free, total: items.length })}
                  </span>
                }
                collapsed={sections.isCollapsed(`material:${category}`)}
                onToggle={() => sections.toggle(`material:${category}`)}
                headerClassName="bg-muted/40"
              >
                <div className="px-2 xl:px-3 py-1 space-y-0.5 xl:space-y-1">
                  {items.map((m) => (
                    <MaterialRow key={m.id} material={m} assignedTo={materialAssignment.get(m.id) ?? []} onOpenIncident={setSelectedOperationId} />
                  ))}
                </div>
              </CollapsibleSection>
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

function PersonRow({ person: p, assignedTo, onOpenIncident }: { person: Person; assignedTo?: AssignmentRef; onOpenIncident: (id: string) => void }) {
  const tk = useTranslations('kanban')
  const isAssigned = p.status === "assigned"
  const clickable = isAssigned && !!assignedTo
  return (
    <div
      className={cn(
        "flex items-center gap-2 px-3 xl:px-4 py-1.5 xl:py-2 rounded-sm",
        clickable && "cursor-pointer transition-colors hover:bg-muted/60"
      )}
      onClick={clickable ? () => onOpenIncident(assignedTo!.operationId) : undefined}
    >
      {/* Reko counts as busy here: a Reko is an Auftrag, but it never sets status="assigned" */}
      <span className={cn("h-1.5 w-1.5 xl:h-2 xl:w-2 rounded-full shrink-0", RESOURCE_STATE_DOT_CLASSES[personResourceState(p)])} />
      <span className="text-xs xl:text-sm truncate flex-1">{p.name}</span>
      {/* Special-function markers — same icon language as the board roster. */}
      {p.isReko && (
        <span className="inline-flex items-center gap-0.5 text-[10px] xl:text-xs text-muted-foreground shrink-0">
          <Binoculars className="h-3 w-3" /> {tk('common.reko')}
        </span>
      )}
      {p.isMagazin && (
        <span className="inline-flex items-center gap-0.5 text-[10px] xl:text-xs text-muted-foreground shrink-0">
          <Package2 className="h-3 w-3" /> {tk('common.magazin')}
        </span>
      )}
      {p.isDriver && p.driverVehicleName && (
        <span className="text-[10px] xl:text-xs text-blue-500 dark:text-blue-400 shrink-0">{p.driverVehicleName}</span>
      )}
      {clickable && (
        <span className="text-[10px] xl:text-xs text-muted-foreground truncate max-w-[120px] xl:max-w-[160px] shrink-0">→ {assignedTo!.label}</span>
      )}
    </div>
  )
}

function MaterialRow({ material: m, assignedTo, onOpenIncident }: { material: Material; assignedTo: AssignmentRef[]; onOpenIncident: (id: string) => void }) {
  const t = useTranslations('display.status')
  const tk = useTranslations('kanban')
  const isAssigned = m.status === "assigned"
  // One incident → name it and jump there on click. Several (the normal case for
  // Verbrauchsmaterial) → the count, and no click: there is no single target.
  const single = assignedTo.length === 1 ? assignedTo[0] : null
  // A resolved incident is reason enough to open it – a consumable can carry a
  // reference while `status` still reads "available" (it is stocked, not lent out).
  const clickable = !!single
  return (
    <div
      className={cn(
        "flex items-center gap-2 px-3 xl:px-4 py-1.5 xl:py-2 rounded-sm",
        clickable && "cursor-pointer transition-colors hover:bg-muted/60"
      )}
      onClick={clickable ? () => onOpenIncident(single!.operationId) : undefined}
    >
      {/* Verbrauchsmaterial stays green even while assigned — it is stocked, not lent out */}
      <span className={cn("h-1.5 w-1.5 xl:h-2 xl:w-2 rounded-full shrink-0", RESOURCE_STATE_DOT_CLASSES[materialResourceState(m)])} />
      {m.consumable && <InfinityIcon className="h-3 w-3 xl:h-3.5 xl:w-3.5 shrink-0 text-muted-foreground" aria-label={tk('material.consumableUnlimited')} />}
      <span className="text-xs xl:text-sm truncate flex-1">{m.name}</span>
      {single ? (
        <span className="text-[10px] xl:text-xs text-muted-foreground truncate max-w-[120px] xl:max-w-[160px] shrink-0">→ {single.label}</span>
      ) : assignedTo.length > 1 ? (
        <span
          className="text-[10px] xl:text-xs text-muted-foreground shrink-0"
          title={assignedTo.map((a) => a.label).join(", ")}
        >
          → {t('onIncidents', { count: assignedTo.length })}
        </span>
      ) : (
        !isAssigned && <span className="text-[10px] xl:text-xs text-muted-foreground shrink-0">{t('available')}</span>
      )}
    </div>
  )
}
