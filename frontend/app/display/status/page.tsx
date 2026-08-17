"use client"

import { useMemo, useState, useEffect } from "react"
import { useTranslations } from "next-intl"
import { useSearchParams } from "next/navigation"
import { Loader2, Binoculars, Package2, Infinity as InfinityIcon } from "lucide-react"
import { getActiveLocale } from "@/lib/i18n-messages"
import { compareByName, compareByRankThenName } from "@/lib/roster-order"
import { useAuth } from "@/lib/contexts/auth-context"
import { useStatusData, type VehicleWithStatus } from "@/lib/hooks/use-status-data"
import { ageLevel, columns, STATUS_ACCENT } from "@/lib/kanban-utils"
import { IncidentTime } from "@/components/ui/incident-time"
import { useCollapsedSections } from "@/lib/hooks/use-collapsed-sections"
import { CollapsibleSection } from "@/components/display/collapsible-section"
import { DisplayStaleBanner } from "@/components/display/display-stale-banner"
import { type Priority, PRIORITY_EDGE_CLASSES, PRIORITY_TEXT_CLASSES } from "@/lib/priority"
import { RESOURCE_STATE_DOT_CLASSES, materialResourceState, personResourceState } from "@/lib/resource-status"
import { getIncidentTypeLabel, getIncidentLocationLabel } from "@/lib/incident-types"
import { type Operation } from "@/lib/contexts/operations-context"
import { type Person } from "@/lib/contexts/personnel-context"
import { type Material } from "@/lib/contexts/materials-context"
import { type IncidentGroup } from "@/lib/types/groups"
import { useGroups } from "@/lib/contexts/groups-context"
import { apiClient, type ApiViewerData } from "@/lib/api-client"
import { buildSituationData, viewerGroupsToIncidentGroups, type SituationData } from "@/lib/viewer-data"
import { IncidentDetailModal } from "@/components/display/incident-detail-modal"
import { useDisplaySearch } from "@/lib/contexts/display-search-context"
import { filterIncidents } from "@/lib/incident-search"
import { cn } from "@/lib/utils"

const STATUS_ORDER = ["incoming", "reko", "reko_done", "enroute", "active", "returning"]

/** Per-device fold state for this display (see useCollapsedSections). */
const STATUS_COLLAPSE_KEY = "kp-display-status-collapsed"

/**
 * How an incident row says what it is.
 *
 * The left edge used to mean STATUS here while it meant PRIORITY on both card
 * surfaces — and these screens hang next to each other. The edge is priority
 * now, everywhere; status keeps three cues of its own on this page and loses
 * none:
 *
 *  1. POSITION — the rows are grouped by status, in board order (STATUS_ORDER).
 *  2. The section HEADER, which names the status in words and carries the
 *     board column's own tint (`colDef.color`). Words, not just colour.
 *  3. A status DOT on every row, in the board column's colour, so a row that
 *     has scrolled away from its header still says which column it is in. It
 *     replaces the priority dot that stood here: priority is on the edge now,
 *     and two dots for two dimensions is how the confusion started.
 */
const ROW_SURFACE = "bg-muted/30"

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
  // Age of the last SUCCESSFUL poll. Keeping the last-known payload on a failed fetch is
  // right — during an outage it is the best picture in the room — but rendering it with no
  // indication that it stopped updating is not: a backend 500ing since 02:10 produced a
  // display that looked entirely normal at 04:00.
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const d = await apiClient.getViewerData(token)
        if (!cancelled) {
          setPayload(d)
          setLastRefresh(new Date())
        }
      } catch {
        // Keep the last-known payload — DisplayStaleBanner surfaces that it has gone stale.
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
  return (
    <div className="flex h-full flex-col">
      <DisplayStaleBanner lastRefresh={lastRefresh} />
      <div className="min-h-0 flex-1">
        <SituationBoard {...data} detailGroups={detailGroups} viewerToken={token} />
      </div>
    </div>
  )
}

function SituationBoard({
  stats,
  vehicleStatus: allVehicles,
  operations: allOperations,
  personnel: allPersonnel,
  materials: allMaterials,
  detailGroups,
  viewerToken,
}: SituationData & {
  /** Token mode only: payload-derived Aufträge for the detail dialog. */
  detailGroups?: IncidentGroup[]
  /** Token mode only: the share token, which the Reko photos need to load. */
  viewerToken?: string
}) {
  const t = useTranslations('display.status')
  const tk = useTranslations('kanban')

  // The top bar's search narrows all four panels at once: incidents through the
  // board's own predicate, and people, vehicles and material by the names one
  // would actually type. Everything downstream reads the narrowed lists, so the
  // section counts say how many rows are really there — a filtered panel with
  // an unfiltered count is a panel that argues with itself.
  const { query } = useDisplaySearch()
  const needle = query.trim().toLowerCase()
  // Typing the name of an Auftrag must find its stops — on the board they carry
  // the route's colour, so «Sturmtour Nord» is how one talks about them. Token
  // mode has no groups context, so the payload's routes stand in for it.
  const { groups } = useGroups()
  const groupNames = useMemo(
    () => new Map((detailGroups ?? groups).map((g) => [g.id, g.name])),
    [detailGroups, groups],
  )
  const operations = useMemo(
    () => filterIncidents(allOperations, query, allMaterials, groupNames),
    [allOperations, query, allMaterials, groupNames],
  )
  const personnel = useMemo(
    () => (!needle ? allPersonnel : allPersonnel.filter((p) =>
      p.name.toLowerCase().includes(needle) || (p.role ?? "").toLowerCase().includes(needle))),
    [allPersonnel, needle],
  )
  const materials = useMemo(
    () => (!needle ? allMaterials : allMaterials.filter((m) =>
      m.name.toLowerCase().includes(needle) || (m.category ?? "").toLowerCase().includes(needle))),
    [allMaterials, needle],
  )
  const vehicleStatus = useMemo(
    () => (!needle ? allVehicles : allVehicles.filter((v) =>
      v.name.toLowerCase().includes(needle)
      || (v.type ?? "").toLowerCase().includes(needle)
      // A vehicle is often looked up by who is driving it.
      || (v.driverName ?? "").toLowerCase().includes(needle))),
    [allVehicles, needle],
  )
  // vehicle → the Auftrag it is out on, so the wall tells the same story as the
  // operator's Fahrzeugstatus-Sheet. The route OWNS its vehicles, so the group
  // assignments are the truth; the share-token payload carries no assignments,
  // so fall back to the route the vehicle's Einsatz is a stop on.
  const auftragByVehicleId = useMemo(() => {
    const all = detailGroups ?? groups
    const byId = new Map(all.map((g) => [g.id, g]))
    const map = new Map<string, IncidentGroup>()
    for (const g of all) {
      for (const a of g.assignments) {
        if (a.resourceType === "vehicle") map.set(a.resourceId, g)
      }
    }
    for (const v of vehicleStatus) {
      if (map.has(v.id)) continue
      const fallback = v.assignedOperation?.groupId ? byId.get(v.assignedOperation.groupId) : undefined
      if (fallback) map.set(v.id, fallback)
    }
    return map
  }, [detailGroups, groups, vehicleStatus])

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
    // Rank first, in-use before free inside a rank, then the name. The two name
    // legs used to collate with the UI locale — so a wall in a French-language
    // station showed a different sequence than the board beside it. Names and
    // rank labels are roster data (`lib/roster-order.ts`), not interface copy.
    const sorted = [...personnel].sort((a, b) => {
      if (a.role !== b.role) return compareByRankThenName(a, b)
      if (a.status !== b.status) return a.status === "assigned" ? -1 : 1
      return compareByName(a, b)
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
  }, [personnel, t])

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

  // A vehicle out on an Auftrag is deployed too — it carries no incident of its
  // own, because the route owns it and the stops carry no resources.
  const deployed = vehicleStatus.filter((v) => v.assignedOperation || auftragByVehicleId.has(v.id)).length
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
              auftrag={auftragByVehicleId.get(v.id)}
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
        viewerToken={viewerToken}
        // Token mode passes `detailGroups`; only the logged-in display can read
        // the report endpoints at all. Which of them it then gets is the modal's
        // call: the Schadenplatz-Rapport is editor-gated over citizen PII, so a
        // viewer sees Reko-Bericht, Funkmeldungen and Verlauf and not that one.
        showReports={!detailGroups}
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

function VehicleRow({ vehicle: v, auftrag, onClick }: { vehicle: VehicleWithStatus; auftrag?: IncidentGroup; onClick?: () => void }) {
  const tv = useTranslations('incidents.vehicleStatus')
  // Out on an Auftrag counts as deployed even without an incident of its own.
  const isDeployed = !!v.assignedOperation || !!auftrag
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
        {/* Where it is. An Auftrag wins over the single stop's address — the same
            answer the Fahrzeugstatus-Sheet gives — and it carries the route's own
            colour, so «welches Fahrzeug fährt welche Tour» reads from the wall. */}
        {auftrag ? (
          <p className="mt-0.5 flex items-center gap-1.5 min-w-0">
            <span
              className="h-2 w-2 xl:h-2.5 xl:w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: auftrag.color ?? "var(--muted-foreground)" }}
            />
            <span
              className={cn("truncate text-xs xl:text-sm font-medium", !auftrag.color && "text-muted-foreground")}
              style={auftrag.color ? { color: auftrag.color } : undefined}
            >
              {tv('auftragLabel', { name: auftrag.name })}
            </span>
          </p>
        ) : isDeployed ? (
          <p className="text-xs xl:text-sm text-muted-foreground truncate mt-0.5">→ {incidentLocationLabel(v.assignedOperation!)}</p>
        ) : null}
      </div>
      {/* Only a real Einsatz has a clock — a route-owned vehicle has no incident
          of its own to time. */}
      {v.assignedOperation && (
        <span className="shrink-0">
          <IncidentTime
            operation={v.assignedOperation}
            readOnly
            className="text-[11px] xl:text-xs"
            iconClassName="h-3 w-3"
          />
        </span>
      )}
    </div>
  )
}

function IncidentRow({ operation: op, onClick }: { operation: Operation; onClick: () => void }) {
  const tk = useTranslations('kanban')
  const statusId = columns.find((c) => c.status.includes(op.status))?.id || "incoming"
  const locationLabel = incidentLocationLabel(op)
  const statusLabel = tk(`columns.${statusId}`)
  return (
    <div
      className={cn(
        // border-l-4 like both card surfaces: same edge, same width, same
        // meaning. High and medium colour it; low closes it (see priority.ts).
        "px-3 xl:px-4 py-2.5 xl:py-3 rounded-md border-l-4 cursor-pointer transition-colors hover:bg-muted/60",
        ROW_SURFACE,
        PRIORITY_EDGE_CLASSES[(op.priority ?? "low") as Priority],
      )}
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 min-w-0">
          <div
            className={cn(
              "w-2.5 h-2.5 xl:w-3 xl:h-3 rounded-full mt-1 shrink-0",
              STATUS_ACCENT[statusId].dot,
            )}
            title={statusLabel}
          />
          <div className="min-w-0">
            <p className="text-sm xl:text-base font-semibold leading-tight truncate" title={locationLabel}>{locationLabel}</p>
            <p className="text-[11px] xl:text-xs text-muted-foreground mt-0.5">{getIncidentTypeLabel(op.incidentType)}</p>
          </div>
        </div>
        <span className="shrink-0">
          <IncidentTime operation={op} readOnly className="text-[11px] xl:text-xs" iconClassName="h-3 w-3" />
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
