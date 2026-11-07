"use client"

import { useMemo, useState, useCallback, useRef, type ReactNode } from "react"
import { useTranslations } from "next-intl"
import { useSearchParams } from "next/navigation"
import { Binoculars, Package2, Ban, Infinity as InfinityIcon, Truck } from "lucide-react"
import { getActiveLocale } from "@/lib/i18n-messages"
import { compareByName, compareByRankThenName } from "@/lib/roster-order"
import { useAuth } from "@/lib/contexts/auth-context"
import { useStatusData, type VehicleWithStatus } from "@/lib/hooks/use-status-data"
import { ageLevel, columns, STATUS_ACCENT, WALL_COLUMN_HEADER_CLASS, WALL_TEXT_WRAP } from "@/lib/kanban-utils"
import { IncidentTime } from "@/components/ui/incident-time"
import { useCollapsedSections } from "@/lib/hooks/use-collapsed-sections"
import { CollapsibleSection } from "@/components/display/collapsible-section"
import { DisplayStaleBanner } from "@/components/display/display-stale-banner"
import { type Priority, PRIORITY_EDGE_CLASSES } from "@/lib/priority"
import { WallPriorityGlyph } from "@/components/display/wall-priority-glyph"
import {
  RESOURCE_STATE_DOT_CLASSES,
  materialResourceState,
  personResourceState,
  vehicleResourceState,
} from "@/lib/resource-status"
import { getIncidentTypeLabel, getIncidentLocationLabel } from "@/lib/incident-types"
import { type Operation } from "@/lib/contexts/operations-context"
import { type Person } from "@/lib/contexts/personnel-context"
import { type Material } from "@/lib/contexts/materials-context"
import { type IncidentGroup } from "@/lib/types/groups"
import { useGroups } from "@/lib/contexts/groups-context"
import { apiClient, type ApiViewerData } from "@/lib/api-client"
import { usePolling } from "@/lib/hooks/use-polling"
import { buildSituationData, viewerGroupsToIncidentGroups, type SituationData } from "@/lib/viewer-data"
import { IncidentDetailModal } from "@/components/display/incident-detail-modal"
import { useDisplaySearch } from "@/lib/contexts/display-search-context"
import { filterIncidents } from "@/lib/incident-search"
import { cn } from "@/lib/utils"
import { WALL_STACK_BOARD, WALL_STACK_BODY, WALL_STACK_COLUMN } from "@/lib/wall-stack"
import { LoadingStatus } from "@/components/ui/shell-loader"
import { EventFiguresView } from "@/components/event-figures"
import { useEvent } from "@/lib/contexts/event-context"
import { useEventFigures } from "@/lib/hooks/use-event-figures"
import type { ApiEventFigures } from "@/lib/api-client"
import { PersonName, PersonNamingProvider } from "@/components/person-name"
import { auftragByResource } from "@/lib/auftrag-by-resource"
import { WallScrollBody } from "@/components/display/wall-more-below"
import { useMaterialSplit } from "@/components/display/material-split"

const STATUS_ORDER = ["incoming", "reko", "reko_done", "enroute", "active", "returning"]

/** «Offen» – not yet dispatched, a Reko on the way included. The Kennzahlen's own
 *  split (`WAITING_STATUSES` in backend/app/services/reaction_times.py): the
 *  Einsätze head says «10 offen · 9 in Arbeit» with the very words and figures of
 *  the tiles under it (hill climb r22 – «5 eingegangen · 14 in Bearbeitung» over
 *  «Offen 10 · In Arbeit 9» was two splits of one column). */
const WAITING_STATUSES: ReadonlySet<string> = new Set(["incoming", "reko", "reko_done"])

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
 *     replaces the priority dot that stood here: two dots for two dimensions
 *     is how the confusion started. Priority is the edge plus the board's
 *     chevron/dash glyph right before the address – a shape, not a third dot.
 */
const ROW_SURFACE = "bg-muted/30"

/** A resource's name on this wall — vehicle, person, material: 18/600 from `xl`,
 *  the line that has to carry across the room. `leading-6` keeps a person row
 *  as tall as it was at 14px, so the columns that fitted still fit. Wraps,
 *  never truncates (`WALL_TEXT_WRAP`). */
const WALL_NAME = cn("min-w-0 text-sm xl:text-lg font-semibold leading-5 xl:leading-6", WALL_TEXT_WRAP)

/** Where a resource is (→ address, Auftrag, «nicht einsatzbereit»): 16/600 from
 *  `xl` – one step under the name, not three. Wraps like the name. */
const WALL_DESTINATION = cn("min-w-0 text-xs xl:text-base font-semibold", WALL_TEXT_WRAP)

/** A person's function where a destination would stand («Reko», «Magazin»): the
 *  destination's type and muted ink, glyph 12px → 14px from `xl`. */
const PERSON_FUNCTION = "inline-flex shrink-0 items-center gap-1 text-right text-muted-foreground"
const PERSON_FUNCTION_ICON = "h-3 w-3 xl:h-3.5 xl:w-3.5 shrink-0"

/** The vehicle a driver drives, before the destination («🚚 Mowa → Ringstrasse 11»):
 *  a neutral ink chip at 14/18 600 from `xl`, the wall's count-chip surface with the
 *  board's vehicle glyph (hill climb r18). It was blue 12px text – the Auftrag
 *  swatch's blue, so «Pio ● Sturmholz Oberwil» read as part of the Auftrag; blue
 *  belongs to the swatch alone, a vehicle is a fact and facts are ink. */
const DRIVER_VEHICLE_TAG =
  "inline-flex shrink-0 items-center gap-1 rounded-sm bg-foreground/10 px-1.5 text-xs leading-4 xl:text-sm xl:leading-[1.125rem] font-semibold text-foreground"

/** A Personal/Material row (`ResourceRow`): the name group on the left, the
 *  where-group on the right, 16px apart at the least (hill climb r19 – at 8px a
 *  long name ran into «Mawa → Bättwilerstrasse 7»; r20 – Material had its own
 *  row and «Tauchpumpe Kl.» ran into «→ Schulstrasse 9»). Both sides are
 *  `min-w-0`: the where-group wraps to a second line inside the row's inset,
 *  right-aligned, before either side eats the gap. */
const RESOURCE_ROW = "flex items-center gap-4 px-2 py-1.5 rounded-sm"
const RESOURCE_ROW_NAME = "flex min-w-0 flex-1 items-center gap-2"
const RESOURCE_ROW_WHERE = "flex min-w-0 flex-wrap items-center justify-end gap-x-2 gap-y-0.5 text-right"

/** A Funktion's / Materialkategorie's «n/m frei» in its group head: 12/600 ink tabular
 *  from `xl`, and the head's ONLY figure – a count chip beside it said the total twice
 *  (hill climb r23). Ink, not amber, at «0/5 frei» too: gebunden is a fact (VISUAL-03). */
const WALL_FREE_OF_TOTAL = "shrink-0 text-2xs xl:text-xs font-semibold tabular-nums text-foreground"

/** Personal/Material rows: the availability mark sits centred in ONE fixed leading
 *  gutter, so every name starts at one edge whether the row carries a dot, a ring or
 *  the «nicht einsatzbereit» Ban glyph. The mark is ~10px from `xl` – read across a
 *  room, the board's 8px marks read like punctuation. */
const WALL_MARK_GUTTER = "flex w-3.5 xl:w-4 shrink-0 items-center justify-center"
const WALL_MARK = "size-2 xl:size-2.5 rounded-full"

/** What the column foot's «+n weiter ↓» counts (WallScrollBody): one row each –
 *  except that an Einsatz listed twice (its stop row under the Auftrag, its row
 *  under its status) is one Einsatz: both rows carry `data-wall-key={op.id}`. */
const WALL_ITEM = "[data-wall-item]"

/** The Personal and Material rows' box: 8px in from the column, and each row 8px
 *  more, so a name starts 16px in – under the section head's chevron – and a
 *  destination ends 16px before the divider (hill climb r19). */
const RESOURCE_ROWS = "px-2 py-1 space-y-0.5 xl:space-y-1"

/** The box of every column head (`PanelHeader`, `ContinuedPanelHeader`): one
 *  min height, so the four heads end on one rule whatever they carry. */
const PANEL_HEADER_BOX = "px-3 xl:px-4 py-2.5 xl:py-3 border-b border-border bg-muted/40 shrink-0 min-h-[60px]"
const PANEL_HEADER_SUMMARY = "text-2xs xl:text-xs text-muted-foreground mt-0.5"

/** A panel on a phone: stacked full width (lib/wall-stack), a rule under it instead of beside it. */
const STACKED_PANEL = cn(WALL_STACK_COLUMN, "max-sm:border-r-0 max-sm:border-b")

/** Short display label for an incident location (falls back to the type).
 *  Server-computed (locationDisplay) — final on first paint, no reformat flash. */
const incidentLocationLabel = getIncidentLocationLabel

/** Reading order inside a material category: in use, free, out of service. */
const MATERIAL_STATE_RANK: Record<ReturnType<typeof materialResourceState>, number> = {
  assigned: 0,
  available: 1,
  maintenance: 2,
  unavailable: 3,
}

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
  const { selectedEvent } = useEvent()
  // Unattended wall: keep polling while hidden, like every other /display loop.
  const { figures } = useEventFigures(selectedEvent?.id, { pauseWhenHidden: false })
  return <SituationBoard {...data} figures={figures} />
}

/** Token/read-only display: view-model polled from the share token payload. */
function TokenStatusView({ token }: { token: string }) {
  const tLoading = useTranslations('common')
  const [payload, setPayload] = useState<ApiViewerData | null>(null)
  // Age of the last SUCCESSFUL poll. Keeping the last-known payload on a failed fetch is
  // right — during an outage it is the best picture in the room — but rendering it with no
  // indication that it stopped updating is not: a backend 500ing since 02:10 produced a
  // display that looked entirely normal at 04:00.
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)

  const load = useCallback(async () => {
    try {
      const d = await apiClient.getViewerData(token)
      // A GET that got no answer resolves to nothing: that is a failed poll,
      // not an empty Ereignis, and must not count as a fresh one either.
      if (!d) return
      setPayload(d)
      setLastRefresh(new Date())
    } catch {
      // Keep the last-known payload — DisplayStaleBanner surfaces that it has gone stale.
    }
  }, [token])
  // Unattended wall screen: never paused on visibility (see `usePolling`).
  usePolling(load, { intervalMs: 5000, pauseWhenHidden: false })

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
        <LoadingStatus size="surface" className="text-sm">{tLoading('loading')}</LoadingStatus>
      </div>
    )
  }
  return (
    <div className="flex h-full flex-col">
      <DisplayStaleBanner lastRefresh={lastRefresh} />
      <div className="min-h-0 flex-1">
        <SituationBoard {...data} detailGroups={detailGroups} viewerToken={token} figures={payload?.figures ?? null} />
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
  figures,
}: SituationData & {
  /** Kennzahlen of the Ereignis (counts + Reaktionszeiten); null while loading. */
  figures?: ApiEventFigures | null
  /** Token mode only: payload-derived Aufträge for the detail dialog. */
  detailGroups?: IncidentGroup[]
  /** Token mode only: the share token, which the Reko photos need to load. */
  viewerToken?: string
}) {
  const t = useTranslations('display.status')
  const tk = useTranslations('kanban')
  const tFigures = useTranslations('events.figures')

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
    const map = auftragByResource(all, "vehicle")
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

  /**
   * The Aufträge, each with its stops in route order.
   *
   * A route was visible on this page only sideways — as the chip on a vehicle
   * row — while the Einsätze column listed its stops scattered across four
   * status sections with nothing saying they belong together. On a wall that is
   * the one grouping an officer talks in («was macht Sturmtour Nord?»), so it
   * leads the Einsätze column and the status sections keep the rest.
   *
   * Filtered stops only: typing in the search must narrow this list like every
   * other, and `filterIncidents` already resolves an Auftrag NAME to its stops.
   * A route whose stops all filtered out drops away with them.
   */
  const auftraege = useMemo(() => {
    const byId = new Map(operations.map((op) => [op.id, op]))
    return (detailGroups ?? groups)
      .map((group) => ({
        group,
        stops: group.stopIds
          .map((stopId) => byId.get(stopId))
          .filter((op): op is Operation => Boolean(op)),
      }))
      .filter((row) => row.stops.length > 0)
  }, [detailGroups, groups, operations])

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

  // The head's figure and its split, from the rows this column lists (the search
  // narrows them like the sections below). Abgeschlossen is not on this wall; the
  // Kennzahlen count it as «Erledigt».
  const activeOps = operations.filter((op) => op.status !== "complete")
  const waitingOps = activeOps.filter((op) => WAITING_STATUSES.has(op.status)).length

  // person id → { incident id, short label } so the "→ Einsatz" reference is
  // itself clickable and jumps straight to that incident's detail dialog.
  const personAssignment = useMemo(() => {
    const map = new Map<string, AssignmentRef>()
    for (const op of operations) {
      for (const { personnelId } of op.crew) map.set(personnelId, { operationId: op.id, label: incidentLocationLabel(op) })
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

  // Person / material → the Auftrag that holds it: a route's crew and material
  // stand on no incident of their own, so the maps above leave them blank while
  // the board sidebar says «Sturmholz Oberwil». The same lookup as the sidebar
  // (lib/auftrag-by-resource). Token mode's payload carries no route
  // assignments, so these stay empty there.
  const auftragByPersonId = useMemo(() => auftragByResource(detailGroups ?? groups, "personnel"), [detailGroups, groups])
  const auftragByMaterialId = useMemo(() => auftragByResource(detailGroups ?? groups, "material"), [detailGroups, groups])

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
      // In use first, «nicht einsatzbereit» last — the same order the board's
      // material sidebar puts its groups in. What is out is the thing nobody
      // needs to scan for.
      const rank = MATERIAL_STATE_RANK[materialResourceState(a)] - MATERIAL_STATE_RANK[materialResourceState(b)]
      if (rank !== 0) return rank
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

  // Material that does not fit its own column continues under the vehicle
  // tiles, group by group (components/display/material-split).
  const vehicleBodyRef = useRef<HTMLDivElement>(null)
  const vehicleListRef = useRef<HTMLDivElement>(null)
  const materialBodyRef = useRef<HTMLDivElement>(null)
  const materialSplitAt = useMaterialSplit({
    vehicleBody: vehicleBodyRef,
    vehicleList: vehicleListRef,
    materialBody: materialBodyRef,
    groupsKey: groupedMaterials.map((g) => g.category).join("\u0000"),
  })

  // One Materialkategorie, in whichever column it stands.
  const materialGroup = ({ category, items }: (typeof groupedMaterials)[number]) => {
    // «frei» means it can be sent out — neither on an Einsatz nor broken.
    const free = items.filter((m) => materialResourceState(m) === "available").length
    return (
      <div key={category} data-material-group={category}>
        <CollapsibleSection
          label={category}
          // No count chip: «n/m frei» already says the total (hill climb r23).
          badge={<span className={WALL_FREE_OF_TOTAL}>{t('freeOfTotal', { free, total: items.length })}</span>}
          collapsed={sections.isCollapsed(`material:${category}`)}
          onToggle={() => sections.toggle(`material:${category}`)}
          headerClassName="bg-muted/40"
        >
          <div className={RESOURCE_ROWS}>
            {items.map((m) => (
              <MaterialRow key={m.id} material={m} assignedTo={materialAssignment.get(m.id) ?? []} auftrag={auftragByMaterialId.get(m.id)} onOpenIncident={setSelectedOperationId} />
            ))}
          </div>
        </CollapsibleSection>
      </div>
    )
  }

  // Vehicle readiness beats deployment, so both numbers are read off the same
  // helper the rows draw with — «6 verfügbar» must not include the one on the
  // ramp with a broken pump. A vehicle out on an Auftrag is deployed too: it
  // carries no incident of its own, because the route owns it.
  const vehicleStates = useMemo(
    () => vehicleStatus.map((v) =>
      vehicleResourceState({ outOfService: v.outOfService, assigned: !!v.assignedOperation || auftragByVehicleId.has(v.id) })
    ),
    [vehicleStatus, auftragByVehicleId],
  )
  const deployed = vehicleStates.filter((s) => s === "assigned").length
  const vehiclesNotReady = vehicleStates.filter((s) => s === "unavailable").length
  // «im Einsatz» must agree with the dots beside the names: a Reko is an Auftrag.
  const assignedPersonnelCount = personnel.filter((p) => personResourceState(p) === "assigned").length
  // Verbrauchsmaterial never counts as gone — see materialResourceState.
  const materialStates = materials.map((m) => materialResourceState(m))
  const assignedMaterialCount = materialStates.filter((s) => s === "assigned").length
  const materialsNotReady = materialStates.filter((s) => s === "unavailable").length
  const materialSubtitle = materialsNotReady > 0
    ? t('availableDeployedNotReady', {
        available: materials.length - assignedMaterialCount - materialsNotReady,
        deployed: assignedMaterialCount,
        notReady: materialsNotReady,
      })
    : t('availableDeployed', { available: materials.length - assignedMaterialCount, deployed: assignedMaterialCount })

  return (
    // `relative` here and on each column's list: the rows' sr-only labels need a positioned
    // ancestor inside the scroller they sit in, or they escape it and widen the whole page
    // (513px on a 393px iPhone, WebKit; overflow sweep, 03.10.)
    // Below `sm` the four panels stack and this box scrolls down, like the board
    // (lib/wall-stack): four 300px panels side by side cut «Material» off a phone.
    // The naming follows the roster this wall shows (in token mode the
    // payload's, which the board provider does not have).
    <PersonNamingProvider roster={allPersonnel}>
    <div className={cn("relative h-full flex bg-background overflow-x-auto", WALL_STACK_BOARD, "max-sm:gap-0")}>
      {/* ── Column 1: Vehicles ── */}
      <div className={cn("flex flex-1 flex-col min-w-[300px] border-r border-border overflow-hidden", STACKED_PANEL)}>
        <PanelHeader
          title={t('vehicles')}
          count={vehicleStatus.length}

          subtitle={vehiclesNotReady > 0
            ? t('availableDeployedNotReady', {
                available: vehicleStatus.length - deployed - vehiclesNotReady,
                deployed,
                notReady: vehiclesNotReady,
              })
            : t('availableDeployed', { available: vehicleStatus.length - deployed, deployed })}
        />
        <WallScrollBody bodyRef={vehicleBodyRef} itemSelector={WALL_ITEM} className={cn("relative flex-1 overflow-y-auto", WALL_STACK_BODY)}>
          <div ref={vehicleListRef} className="p-2 xl:p-3 space-y-1.5 xl:space-y-2">
            {vehicleStatus.map((v) => (
              <VehicleRow
                key={v.id}
                vehicle={v}
                auftrag={auftragByVehicleId.get(v.id)}
                onClick={v.assignedOperation ? () => setSelectedOperationId(v.assignedOperation!.id) : undefined}
              />
            ))}
          </div>
          {/* Material's first groups, when its own column is too short for all of
              them. Read in order, this is where Material STARTS, so the full head
              (count, summary) stands here and column 4 only says it goes on
              (hill climb r21 – two equal «MATERIAL» heads, the count on the second). */}
          {materialSplitAt > 0 && (
            <PanelHeader
              data-material-head
              className="border-t"
              title={t('material')}
              count={materials.length}
              subtitle={materialSubtitle}
            />
          )}
          {groupedMaterials.slice(0, materialSplitAt).map(materialGroup)}
        </WallScrollBody>
      </div>

      {/* ── Column 2: Active Incidents ── */}
      <div className={cn("flex flex-1 flex-col min-w-[300px] border-r border-border overflow-hidden", STACKED_PANEL)}>
        <PanelHeader
          title={t('incidents')}
          count={activeOps.length}

          subtitle={t('waitingInProgress', { waiting: waitingOps, inProgress: activeOps.length - waitingOps })}
        />
        <WallScrollBody itemSelector={WALL_ITEM} className={cn("relative flex-1 overflow-y-auto", WALL_STACK_BODY)}>
          {/* Aufträge first — the grouping the radio talks in. Each route names
              its stops in the order they are driven, so «Stopp 2 von 3» is
              readable from across the room without opening anything. */}
          {/* Kennzahlen first: the Lage in four numbers and the Reaktionszeiten,
              folded like every other section (search does not narrow them —
              they describe the whole Ereignis). No count chip: the section lists
              no rows, and a bare «21» (Meldungen, Erledigt included) beside the
              head's 19 Einsätze read as a third total (hill climb r22). */}
          {figures && figures.total > 0 && (
            <CollapsibleSection
              label={t('figures')}
              badge={
                <span className="shrink-0 text-2xs xl:text-xs tabular-nums text-muted-foreground">
                  {tFigures('wallBadge', {
                    waiting: figures.waiting,
                    high: figures.by_priority.find((p) => p.priority === "high")?.waiting ?? 0,
                  })}
                </span>
              }
              alarm={!!figures.oldest_waiting_high && ageLevel(new Date(figures.oldest_waiting_high.created_at)) !== "normal"}
              collapsed={sections.isCollapsed("figures")}
              onToggle={() => sections.toggle("figures")}
              headerClassName="bg-muted/40"
            >
              <EventFiguresView
                figures={figures}
                density="wall"
                incidentLabel={(id) => {
                  const op = allOperations.find((o) => o.id === id)
                  return op ? incidentLocationLabel(op) : undefined
                }}
                onOpenIncident={(id) => setSelectedOperationId(id)}
              />
            </CollapsibleSection>
          )}
          {auftraege.map(({ group, stops }) => (
            <CollapsibleSection
              key={group.id}
              label={group.name}
              count={stops.length}
              badge={
                <span className="shrink-0 text-2xs xl:text-xs tabular-nums text-muted-foreground">
                  {t('auftragStops', { count: stops.length })}
                </span>
              }
              collapsed={sections.isCollapsed(`auftrag:${group.id}`)}
              onToggle={() => sections.toggle(`auftrag:${group.id}`)}
              headerClassName="bg-info/10"
            >
              <div className="p-2 xl:p-3 space-y-1.5 xl:space-y-2">
                {stops.map((op, index) => (
                  <div key={op.id} className="flex items-start gap-2">
                    {/* The stop's place in the route, 14/18 600 mono like the
                        row's clock, centred in a fixed 20px gutter and on the
                        address's first line (row padding + half its line). */}
                    <span className="mt-2.5 xl:mt-[0.8125rem] w-5 shrink-0 text-center font-mono text-sm leading-[1.125rem] font-semibold tabular-nums text-muted-foreground">
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <IncidentRow operation={op} onClick={() => setSelectedOperationId(op.id)} />
                    </div>
                  </div>
                ))}
              </div>
            </CollapsibleSection>
          ))}
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
        </WallScrollBody>
      </div>

      {/* ── Column 3: Personnel ── */}
      <div className={cn("flex flex-1 flex-col min-w-[300px] border-r border-border overflow-hidden", STACKED_PANEL)}>
        <PanelHeader
          title={t('personnel')}
          count={personnel.length}

          subtitle={t('availableDeployed', { available: stats.personnelAvailable, deployed: assignedPersonnelCount })}
        />
        <WallScrollBody itemSelector={WALL_ITEM} className={cn("relative flex-1 overflow-y-auto", WALL_STACK_BODY)}>
          {groupedPersonnel.map(({ role, people }) => {
            const free = people.filter((p) => personResourceState(p) !== "assigned").length
            return (
              <CollapsibleSection
                key={role}
                label={role}
                // How many of this Funktion are still free has to survive the
                // fold — «Maschinisten 6» tells nobody that all six are out.
                // No count chip: «n/m frei» already says the total (hill climb r23).
                badge={<span className={WALL_FREE_OF_TOTAL}>{t('freeOfTotal', { free, total: people.length })}</span>}
                collapsed={sections.isCollapsed(`role:${role}`)}
                onToggle={() => sections.toggle(`role:${role}`)}
                headerClassName="bg-muted/40"
              >
                <div className={RESOURCE_ROWS}>
                  {people.map((p) => (
                    <PersonRow key={p.id} person={p} assignedTo={personAssignment.get(p.id)} auftrag={auftragByPersonId.get(p.id)} onOpenIncident={setSelectedOperationId} />
                  ))}
                </div>
              </CollapsibleSection>
            )
          })}
        </WallScrollBody>
      </div>

      {/* ── Column 4: Materials ── */}
      <div className={cn("flex flex-1 flex-col min-w-[300px] overflow-hidden", STACKED_PANEL)}>
        {materialSplitAt > 0 ? (
          <ContinuedPanelHeader title={t('materialContinued')} />
        ) : (
          <PanelHeader title={t('material')} count={materials.length} subtitle={materialSubtitle} />
        )}
        <WallScrollBody bodyRef={materialBodyRef} itemSelector={WALL_ITEM} className={cn("relative flex-1 overflow-y-auto", WALL_STACK_BODY)}>
          {groupedMaterials.slice(materialSplitAt).map(materialGroup)}
          {materials.length === 0 && (
            <div className="text-center text-muted-foreground py-12 text-sm xl:text-base">{t('noMaterial')}</div>
          )}
        </WallScrollBody>
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
    </PersonNamingProvider>
  )
}

/** A column's head: caps title, the ink count chip, the summary line under it.
 *  `className`/`data-*` go to the box (Material's head under the vehicles adds
 *  a top rule and the attribute material-split measures). */
function PanelHeader({ title, count, subtitle, className, ...rest }: {
  title: string; count: number; subtitle?: string; className?: string
  "data-material-head"?: boolean
}) {
  return (
    <div {...rest} className={cn(PANEL_HEADER_BOX, className)}>
      <div className="flex items-center justify-between">
        <h2 className="text-sm xl:text-base font-bold tracking-tight uppercase">{title}</h2>
        <span className="inline-flex items-center justify-center h-6 min-w-6 px-1.5 rounded-sm bg-foreground/10 text-foreground text-xs xl:text-sm font-bold tabular-nums">
          {count}
        </span>
      </div>
      {subtitle && <p className={PANEL_HEADER_SUMMARY}>{subtitle}</p>}
    </div>
  )
}

/** Column 4's head while Material's first groups stand under the vehicles: a
 *  quiet muted caps «MATERIAL · FORTS.» – no count, no summary (those are on the
 *  head in column 1). The summary's line stays as an empty line, so this head is
 *  as tall as its neighbours and the four heads still end on one rule. */
function ContinuedPanelHeader({ title }: { title: string }) {
  return (
    <div className={PANEL_HEADER_BOX}>
      <div className="flex h-6 items-center">
        <h2 className={WALL_COLUMN_HEADER_CLASS}>{title}</h2>
      </div>
      <p aria-hidden className={PANEL_HEADER_SUMMARY}>{"\u00a0"}</p>
    </div>
  )
}

function VehicleRow({ vehicle: v, auftrag, onClick }: { vehicle: VehicleWithStatus; auftrag?: IncidentGroup; onClick?: () => void }) {
  const tv = useTranslations('incidents.vehicleStatus')
  const tk = useTranslations('kanban.common')
  // Out on an Auftrag counts as deployed even without an incident of its own.
  const isDeployed = !!v.assignedOperation || !!auftrag
  // «Nicht einsatzbereit» beats deployment beats free — the same precedence the
  // board draws, and never colour alone: the square becomes a Ban glyph and the
  // row says the word, because a wall is read across a room and in a fire hall
  // that room is not always well lit.
  const state = vehicleResourceState({ outOfService: v.outOfService, assigned: isDeployed })
  const isOutOfService = state === "unavailable"
  return (
    <div
      data-wall-item
      className={cn(
        "flex items-center gap-3 px-3 xl:px-4 py-2 xl:py-2.5 rounded-md",
        isDeployed ? "bg-muted/40" : "bg-muted/20",
        isOutOfService && "border border-dashed border-border bg-transparent opacity-70",
        onClick && "cursor-pointer transition-colors hover:bg-muted/60"
      )}
      onClick={onClick}
    >
      {isOutOfService ? (
        <Ban className="h-3.5 w-3.5 xl:h-4 xl:w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      ) : (
        <div className={cn("w-3 h-3 xl:w-3.5 xl:h-3.5 rounded-sm shrink-0", RESOURCE_STATE_DOT_CLASSES[state])} />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className={cn(WALL_NAME, isOutOfService && "text-muted-foreground")}>{v.name}</span>
          {v.driverName && <span className={cn("min-w-0 text-xs xl:text-sm text-muted-foreground", WALL_TEXT_WRAP)}>{v.driverName}</span>}
        </div>
        {/* Where it is. An Auftrag wins over the single stop's address — the same
            answer the Fahrzeugstatus-Sheet gives — and its dot carries the route's
            own colour, so «welches Fahrzeug fährt welche Tour» reads from the wall.
            The TEXT stays neutral: a route colour is a swatch, not a text colour
            (#10b981 on white was 2.3:1 – sweep 2026-10, VISUAL-05).
            «Nicht einsatzbereit» wins over both: it is why the vehicle is nowhere. */}
        {isOutOfService ? (
          <p className={cn("mt-0.5", WALL_DESTINATION, "text-muted-foreground")}>{tk('notReady')}</p>
        ) : auftrag ? (
          <p className="mt-0.5 flex items-center gap-1.5 min-w-0">
            <AuftragSwatch auftrag={auftrag} />
            <span className={WALL_DESTINATION}>
              {tv('auftragLabel', { name: auftrag.name })}
            </span>
          </p>
        ) : isDeployed ? (
          <p className={cn("mt-0.5", WALL_DESTINATION)}>→ {incidentLocationLabel(v.assignedOperation!)}</p>
        ) : null}
      </div>
      {/* Only a real Einsatz has a clock — a route-owned vehicle has no incident
          of its own to time. */}
      {/* 16/20 600 from `xl` (hill climb r9): how long a crew has been out is a
          read from across the room, not a caption. Coloured by the board's
          `ageLevel`, like the wall card's age. */}
      {v.assignedOperation && (
        <span className="shrink-0 text-right">
          <IncidentTime
            operation={v.assignedOperation}
            readOnly
            colorByAge
            className="text-sm xl:text-base leading-5 font-semibold"
            iconClassName="h-3.5 w-3.5 xl:h-4 xl:w-4"
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
  const priority = (op.priority ?? "low") as Priority
  return (
    <div
      data-wall-item
      data-wall-key={op.id}
      className={cn(
        // border-l-4 like both card surfaces: same edge, same width, same
        // meaning. High and medium colour it; low closes it (see priority.ts).
        "px-3 xl:px-4 py-2.5 xl:py-3 rounded-md border-l-4 cursor-pointer transition-colors hover:bg-muted/60",
        ROW_SURFACE,
        PRIORITY_EDGE_CLASSES[priority],
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
          {/* The priority glyph the wall board draws before an address (hill
              climb r9; one shared glyph since r10): the edge alone said priority
              in colour only. Centred on the address's first line. */}
          <div className="flex items-start gap-1.5 min-w-0">
            <WallPriorityGlyph priority={priority} lineClassName="text-sm xl:text-base h-[1.25em]" />
            <div className="min-w-0">
              {/* Two lines, hyphenated, instead of one truncated: «Mühlemattstrasse …»
                  is not an address anybody can act on, and a wall has no pointer for
                  the title attribute. */}
              <p className={cn("text-sm xl:text-base font-semibold leading-tight line-clamp-2", WALL_TEXT_WRAP)} title={locationLabel}>{locationLabel}</p>
              <p className="text-[11px] xl:text-xs text-muted-foreground mt-0.5">{getIncidentTypeLabel(op.incidentType)}</p>
            </div>
          </div>
        </div>
        {/* 14/18 600 (hill climb r10), coloured by `ageLevel` like the vehicle
            tiles' and the wall card's age: a caption-sized clock read as a
            footnote beside the 16px ones. `min-w` reserves the room «1h 50'»
            needs, so the address wraps before the time is squeezed and every
            stop's clock starts at one edge. */}
        <span className="shrink-0 min-w-[4.5rem] text-right">
          <IncidentTime
            operation={op}
            readOnly
            colorByAge
            className="text-sm leading-[18px] font-semibold"
            iconClassName="h-3.5 w-3.5"
          />
        </span>
      </div>
    </div>
  )
}

/** The one Personal/Material row: `mark` (the availability gutter and any glyph
 *  before the name), the name, and `where` (destination, function, «verfügbar»)
 *  in the where-group. A row with `onClick` opens that Einsatz. */
function ResourceRow({ mark, name, nameClassName, where, onClick, className }: {
  mark: ReactNode
  name: ReactNode
  nameClassName?: string
  where?: ReactNode
  onClick?: () => void
  className?: string
}) {
  return (
    <div
      data-wall-item
      className={cn(RESOURCE_ROW, className, onClick && "cursor-pointer transition-colors hover:bg-muted/60")}
      onClick={onClick}
    >
      <span className={RESOURCE_ROW_NAME}>
        {mark}
        <span className={cn("flex-1", WALL_NAME, nameClassName)}>{name}</span>
      </span>
      {where && <span className={RESOURCE_ROW_WHERE}>{where}</span>}
    </div>
  )
}

function PersonRow({ person: p, assignedTo, auftrag, onOpenIncident }: { person: Person; assignedTo?: AssignmentRef; auftrag?: IncidentGroup; onOpenIncident: (id: string) => void }) {
  const tk = useTranslations('kanban')
  const isAssigned = p.status === "assigned"
  const clickable = isAssigned && !!assignedTo
  const hasWhere = !!(p.isReko || p.isMagazin || (p.isDriver && p.driverVehicleName) || clickable || auftrag)
  return (
    <ResourceRow
      onClick={clickable ? () => onOpenIncident(assignedTo!.operationId) : undefined}
      // Reko counts as busy here: a Reko is an Auftrag, but it never sets status="assigned"
      mark={
        <span className={WALL_MARK_GUTTER} aria-hidden="true">
          <span className={cn(WALL_MARK, RESOURCE_STATE_DOT_CLASSES[personResourceState(p)])} />
        </span>
      }
      name={<PersonName name={p.name} kennung={p.kennung ?? null} />}
      where={hasWhere && (
        <>
          {/* Special-function markers — same icon language as the board roster.
              They answer «where» like the street beside the next name, so they wear
              the destination's size, weight and ink tier (hill climb r5): a smaller,
              lighter «Reko» read as a footnote to the row above it. */}
          {p.isReko && (
            <span className={cn(PERSON_FUNCTION, WALL_DESTINATION)}>
              <Binoculars className={PERSON_FUNCTION_ICON} /> {tk('common.reko')}
            </span>
          )}
          {p.isMagazin && (
            <span className={cn(PERSON_FUNCTION, WALL_DESTINATION)}>
              <Package2 className={PERSON_FUNCTION_ICON} /> {tk('common.magazin')}
            </span>
          )}
          {p.isDriver && p.driverVehicleName && (
            <span className={DRIVER_VEHICLE_TAG} title={tk('person.driverFunction', { vehicle: p.driverVehicleName })}>
              <Truck aria-hidden className={cn(PERSON_FUNCTION_ICON, "text-muted-foreground")} />
              {p.driverVehicleName}
            </span>
          )}
          {clickable ? (
            <span className={cn(WALL_DESTINATION, "text-muted-foreground")}>→ {assignedTo!.label}</span>
          ) : auftrag ? (
            <AuftragDestination auftrag={auftrag} />
          ) : null}
        </>
      )}
    />
  )
}

function MaterialRow({ material: m, assignedTo, auftrag, onOpenIncident }: { material: Material; assignedTo: AssignmentRef[]; auftrag?: IncidentGroup; onOpenIncident: (id: string) => void }) {
  const t = useTranslations('display.status')
  const tk = useTranslations('kanban')
  const tc = useTranslations('kanban.common')
  // «Nicht einsatzbereit» ▸ «im Einsatz» ▸ «verfügbar», through the board's own
  // helper. Said in three ways at once, never colour alone: the dot becomes a Ban
  // glyph, the row dims, and the trailing slot spells the word out.
  const state = materialResourceState(m)
  const isOutOfService = state === "unavailable"
  // One incident → name it and jump there on click. Several (the normal case for
  // Verbrauchsmaterial) → the count, and no click: there is no single target.
  const single = assignedTo.length === 1 ? assignedTo[0] : null
  // A resolved incident is reason enough to open it – a consumable can carry a
  // reference while `status` still reads "available" (it is stocked, not lent out).
  const clickable = !!single
  return (
    <ResourceRow
      className={cn(isOutOfService && "opacity-70")}
      onClick={clickable ? () => onOpenIncident(single!.operationId) : undefined}
      // Verbrauchsmaterial stays green even while assigned — it is stocked, not
      // lent out. Broken beats both: a defective Fass is not "unlimited".
      mark={
        <>
          <span className={WALL_MARK_GUTTER} aria-hidden="true">
            {isOutOfService ? (
              <Ban className="h-3 w-3 xl:h-3.5 xl:w-3.5 text-muted-foreground" />
            ) : (
              <span className={cn(WALL_MARK, RESOURCE_STATE_DOT_CLASSES[state])} />
            )}
          </span>
          {m.consumable && !isOutOfService && <InfinityIcon className="h-3 w-3 xl:h-3.5 xl:w-3.5 shrink-0 text-muted-foreground" aria-label={tk('material.consumableUnlimited')} />}
        </>
      }
      name={m.name}
      nameClassName={cn(isOutOfService && "text-muted-foreground")}
      where={
        isOutOfService ? (
          <span className="text-2xs xl:text-xs font-medium text-muted-foreground">{tc('notReady')}</span>
        ) : single ? (
          <span className={cn(WALL_DESTINATION, "text-muted-foreground")}>→ {single.label}</span>
        ) : assignedTo.length > 1 ? (
          <span
            className="text-2xs xl:text-xs text-muted-foreground"
            title={assignedTo.map((a) => a.label).join(", ")}
          >
            → {t('onIncidents', { count: assignedTo.length })}
          </span>
        ) : auftrag ? (
          <AuftragDestination auftrag={auftrag} />
        ) : null
        // Free says nothing more: the green dot is the word, as on a Personal row
        // (hill climb r21 – twenty muted «verfügbar» down one column).
      }
    />
  )
}

/** The route's colour as a swatch beside its name – never as the text colour
 *  (sweep 2026-10, VISUAL-05). One size for every wall row. `inline-block`, so
 *  inside wrapping text it rides at the start of the first line. */
function AuftragSwatch({ auftrag, className }: { auftrag: IncidentGroup; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("inline-block size-2 xl:size-2.5 shrink-0 rounded-full", className)}
      style={{ backgroundColor: auftrag.color ?? "var(--muted-foreground)" }}
    />
  )
}

/** A person's or a device's right-hand destination when it is out on an Auftrag:
 *  swatch + the Auftrag's name in the destination's type and ink, where an
 *  address would stand after «→». Wraps like every wall destination; the board
 *  sidebar names the same Auftrag (lib/auftrag-by-resource). */
function AuftragDestination({ auftrag }: { auftrag: IncidentGroup }) {
  return (
    <span className={cn(WALL_DESTINATION, "text-right text-muted-foreground")}>
      <AuftragSwatch auftrag={auftrag} className="mr-1.5 align-middle" />
      {auftrag.name}
    </span>
  )
}
