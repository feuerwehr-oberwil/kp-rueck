"use client"

import { useMemo, useState, type ReactNode } from "react"
import { useTranslations } from "next-intl"
import { useSearchParams } from "next/navigation"
import { AlertTriangle, Ban, Clock, Users } from "lucide-react"
import { useAuth } from "@/lib/contexts/auth-context"
import { useGroups } from "@/lib/contexts/groups-context"
import { type Operation } from "@/lib/contexts/operations-context"
import { useDisplaySearch } from "@/lib/contexts/display-search-context"
import { useStatusData, type VehicleWithStatus } from "@/lib/hooks/use-status-data"
import { useViewerSituation } from "@/lib/hooks/use-viewer-situation"
import { useIncidentTimeMode } from "@/lib/hooks/use-incident-time-mode"
import { auftragByResource } from "@/lib/auftrag-by-resource"
import { formatDurationHours } from "@/lib/duration"
import { filterIncidents } from "@/lib/incident-search"
import { getIncidentLocationLabel, getIncidentTypeLabel } from "@/lib/incident-types"
import { columns, statusBadgeClass, WALL_TEXT_WRAP } from "@/lib/kanban-utils"
import { RESOURCE_STATE_DOT_CLASSES, vehicleResourceState } from "@/lib/resource-status"
import { standbyLists } from "@/lib/standby"
import { type SituationData } from "@/lib/viewer-data"
import { type IncidentGroup } from "@/lib/types/groups"
import { cn } from "@/lib/utils"
import { DisplayStaleBanner } from "@/components/display/display-stale-banner"
import { IncidentDetailModal } from "@/components/display/incident-detail-modal"
import { WallPriorityGlyph } from "@/components/display/wall-priority-glyph"
import { PersonNamingProvider } from "@/components/person-name"
import { IncidentTime } from "@/components/ui/incident-time"
import { LoadingStatus } from "@/components/ui/shell-loader"

/**
 * Bereitschaft – the display page for a crew waiting at the station, on a shared tablet held
 * in the hand (the other three `/display` pages are a wall read from across the room).
 *
 * It answers, top to bottom and without a tap: where the vehicles are, what is ready to go
 * (Reko abgeschlossen, with what the Reko asks for), what else waits, who is out. Read-only:
 * a tap opens the same detail dialog as the wall, nothing here writes. The page scrolls as a
 * whole; from `lg` (a tablet in landscape) the lists stand in two columns.
 *
 * Same two doors as the wall: a share token (`?token=…`, no login) or a session.
 */
export default function DisplayStandbyPage() {
  const t = useTranslations("display.status")
  const token = useSearchParams().get("token")
  const { isAuthenticated } = useAuth()

  if (token) return <TokenStandby token={token} />
  if (!isAuthenticated) {
    return <div className="flex h-full items-center justify-center text-muted-foreground">{t("accessRequired")}</div>
  }
  return <SessionStandby />
}

/** Logged in: the view-model straight from the live contexts. */
function SessionStandby() {
  const data = useStatusData()
  const { groups } = useGroups()
  return <StandbyBoard {...data} groups={groups} />
}

/** Share link: the view-model polled from the token payload. */
function TokenStandby({ token }: { token: string }) {
  const tLoading = useTranslations("common")
  const { data, groups, lastRefresh } = useViewerSituation(token)

  if (!data) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <LoadingStatus size="surface" className="text-sm">{tLoading("loading")}</LoadingStatus>
      </div>
    )
  }
  return (
    <div className="flex h-full flex-col">
      <DisplayStaleBanner lastRefresh={lastRefresh} />
      <div className="min-h-0 flex-1">
        <StandbyBoard {...data} groups={groups} viewerToken={token} />
      </div>
    </div>
  )
}

function StandbyBoard({
  vehicleStatus,
  operations: allOperations,
  personnel,
  materials,
  groups,
  viewerToken,
}: SituationData & {
  groups: IncidentGroup[]
  /** Share link only: the token the Reko photos in the detail dialog load with. */
  viewerToken?: string
}) {
  const t = useTranslations("display.standby")
  const { query } = useDisplaySearch()
  const { mode } = useIncidentTimeMode()
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const groupById = useMemo(() => new Map(groups.map((group) => [group.id, group])), [groups])
  // The top bar's search, the same predicate the board filters with.
  const operations = useMemo(
    () => filterIncidents(allOperations, query, materials, new Map(groups.map((group) => [group.id, group.name]))),
    [allOperations, query, materials, groups],
  )
  const lists = useMemo(() => standbyLists(operations, mode), [operations, mode])

  // A route owns its vehicles, so a stop carries none of its own: vehicle → Auftrag off the
  // route's assignments, else the route the vehicle's Einsatz is a stop on (as /display/status).
  const auftragByVehicleId = useMemo(() => {
    const map = auftragByResource(groups, "vehicle")
    for (const vehicle of vehicleStatus) {
      const groupId = vehicle.assignedOperation?.groupId
      const fallback = groupId ? groupById.get(groupId) : undefined
      if (fallback && !map.has(vehicle.id)) map.set(vehicle.id, fallback)
    }
    return map
  }, [groups, groupById, vehicleStatus])
  const vehicleNamesByGroupId = useMemo(() => {
    const names = new Map<string, string[]>()
    for (const vehicle of vehicleStatus) {
      const auftrag = auftragByVehicleId.get(vehicle.id)
      if (auftrag) names.set(auftrag.id, [...(names.get(auftrag.id) ?? []), vehicle.name])
    }
    return names
  }, [vehicleStatus, auftragByVehicleId])

  // Read from the live list each render: the dialog follows the Einsatz and closes when it goes.
  const selected = operations.find((op) => op.id === selectedId) ?? null
  const rowProps = (op: Operation) => ({ operation: op, onOpen: () => setSelectedId(op.id) })

  return (
    <PersonNamingProvider roster={personnel}>
      {/* `relative`: the rows' sr-only time labels must stay inside the scroller. */}
      <div className="relative h-full overflow-y-auto bg-background">
        <div className="mx-auto flex max-w-[1400px] flex-col gap-5 p-3 sm:p-4">
          <section aria-label={t("vehicles")}>
            {vehicleStatus.length === 0 ? (
              <Empty>{t("vehiclesEmpty")}</Empty>
            ) : (
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-2">
                {vehicleStatus.map((vehicle) => (
                  <li key={vehicle.id}>
                    <VehicleTile
                      vehicle={vehicle}
                      auftrag={auftragByVehicleId.get(vehicle.id)}
                      onOpen={vehicle.assignedOperation ? () => setSelectedId(vehicle.assignedOperation!.id) : undefined}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="grid gap-5 lg:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-5">
              <Section title={t("ready")} count={lists.ready.length} hint={t("readyHint")}>
                {lists.ready.length === 0 ? (
                  <Empty>{t("readyEmpty")}</Empty>
                ) : (
                  <ul className="grid gap-2 sm:max-lg:grid-cols-2">
                    {lists.ready.map((op) => (
                      <li key={op.id}><ReadyCard {...rowProps(op)} /></li>
                    ))}
                  </ul>
                )}
              </Section>
              <Section title={t("waiting")} count={lists.waiting.length}>
                {lists.waiting.length === 0 ? (
                  <Empty>{t("waitingEmpty")}</Empty>
                ) : (
                  <RowList>
                    {lists.waiting.map((op) => (
                      <IncidentRow key={op.id} {...rowProps(op)} />
                    ))}
                  </RowList>
                )}
              </Section>
            </div>
            <Section title={t("out")} count={lists.out.length}>
              {lists.out.length === 0 ? (
                <Empty>{t("outEmpty")}</Empty>
              ) : (
                <RowList>
                  {lists.out.map((op) => {
                    const auftrag = op.groupId ? groupById.get(op.groupId) : undefined
                    return (
                      <IncidentRow
                        key={op.id}
                        {...rowProps(op)}
                        auftrag={auftrag}
                        auftragVehicles={auftrag ? vehicleNamesByGroupId.get(auftrag.id) : undefined}
                        showForces
                      />
                    )
                  })}
                </RowList>
              )}
            </Section>
          </div>
        </div>

        <IncidentDetailModal
          operation={selected}
          open={!!selected}
          onOpenChange={(open) => { if (!open) setSelectedId(null) }}
          personnelOverride={personnel}
          materialsOverride={materials}
          groupsOverride={viewerToken ? groups : undefined}
          viewerToken={viewerToken}
          // The report endpoints need a session; which of them a viewer then gets is the modal's call.
          showReports={!viewerToken}
        />
      </div>
    </PersonNamingProvider>
  )
}

/** A list's caps title with its count, an optional line of what the list means, then the list. */
function Section({ title, count, hint, children }: { title: string; count: number; hint?: string; children: ReactNode }) {
  return (
    <section className="min-w-0">
      <h2 className="mb-2 flex flex-wrap items-baseline gap-x-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
        <span className="rounded-full bg-foreground/10 px-2 py-px text-xs font-bold tabular-nums tracking-normal text-foreground">{count}</span>
        {hint && <span className="font-normal normal-case tracking-normal">{hint}</span>}
      </h2>
      {children}
    </section>
  )
}

function RowList({ children }: { children: ReactNode }) {
  return <ul className="relative divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">{children}</ul>
}

/** An empty list says so in one grey sentence, like an empty board column. */
function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">{children}</p>
}

const TAP = "w-full text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
const TIME = "text-sm leading-[18px] font-semibold"

/** Priority glyph, Einsatz number and address – the head every row and card starts with. */
function AddressHead({ operation, large }: { operation: Operation; large?: boolean }) {
  return (
    <>
      <WallPriorityGlyph priority={operation.priority} lineClassName={large ? "text-lg h-[1.25em]" : "text-base h-[1.25em]"} />
      {operation.number != null && (
        <span className="w-6 shrink-0 text-right font-mono text-xs leading-5 text-muted-foreground tabular-nums">{operation.number}</span>
      )}
    </>
  )
}

/** Where a vehicle is, in one tile; a tap opens its Einsatz. */
function VehicleTile({ vehicle, auftrag, onOpen }: { vehicle: VehicleWithStatus; auftrag?: IncidentGroup; onOpen?: () => void }) {
  const t = useTranslations("display.standby")
  const tk = useTranslations("kanban")
  const tv = useTranslations("incidents.vehicleStatus")
  const op = vehicle.assignedOperation
  const state = vehicleResourceState({ outOfService: vehicle.outOfService, assigned: !!op || !!auftrag })
  const statusId = op ? columns.find((column) => column.status.includes(op.status))?.id : undefined
  // «Nicht einsatzbereit» beats deployment beats free, as on the wall – and always in words.
  const [stateWord, where] =
    state === "unavailable" ? [tk("common.notReady"), null]
    : auftrag ? [tv("auftragLabel", { name: auftrag.name }), op ? getIncidentLocationLabel(op) : null]
    : op ? [statusId ? tk(`columns.${statusId}`) : null, getIncidentLocationLabel(op)]
    : [t("vehicleFree"), null]
  const body = (
    <>
      <span className="flex items-center gap-2">
        {state === "unavailable" ? (
          <Ban className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        ) : (
          <span className={cn("size-3 shrink-0 rounded-sm", RESOURCE_STATE_DOT_CLASSES[state])} aria-hidden />
        )}
        <span className={cn("min-w-0 text-base font-semibold leading-5", WALL_TEXT_WRAP)}>{vehicle.name}</span>
      </span>
      <span className={cn("mt-1 block text-xs text-muted-foreground", WALL_TEXT_WRAP)}>{stateWord}</span>
      {where && <span className={cn("block text-sm font-medium leading-5", WALL_TEXT_WRAP)}>{where}</span>}
    </>
  )
  const box = "block h-full min-h-[4.75rem] rounded-lg border border-border bg-card px-3 py-2"
  return onOpen ? (
    <button type="button" onClick={onOpen} className={cn(box, TAP)}>{body}</button>
  ) : (
    <div className={box}>{body}</div>
  )
}

/** Reko abgeschlossen: the Meldung and what the Reko asks for, readable without a tap. */
function ReadyCard({ operation, onOpen }: { operation: Operation; onOpen: () => void }) {
  const tk = useTranslations("kanban")
  const reko = operation.rekoSummary
  return (
    <button type="button" onClick={onOpen} className={cn("block h-full rounded-lg border border-border bg-card px-3 py-3", TAP)}>
      <span className="flex items-start gap-2">
        <AddressHead operation={operation} large />
        <span className={cn("min-w-0 flex-1 text-lg font-semibold leading-[1.25]", WALL_TEXT_WRAP)}>{getIncidentLocationLabel(operation)}</span>
        <IncidentTime operation={operation} readOnly colorByAge className={cn("shrink-0", TIME)} iconClassName="h-3.5 w-3.5" />
      </span>
      <span className="mt-0.5 block text-xs text-muted-foreground">{getIncidentTypeLabel(operation.incidentType)}</span>
      {operation.notes && <span className={cn("mt-2 block text-sm", WALL_TEXT_WRAP)}>{operation.notes}</span>}
      {reko && (reko.personnelCount || reko.estimatedDuration || reko.dangerTypes.length > 0) && (
        <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-semibold">
          {!!reko.personnelCount && (
            <span className="inline-flex items-center gap-1.5">
              <Users aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
              {tk("card.persCount", { count: reko.personnelCount })}
            </span>
          )}
          {!!reko.estimatedDuration && (
            <span className="inline-flex items-center gap-1.5 tabular-nums">
              <Clock aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
              {formatDurationHours(reko.estimatedDuration)}
            </span>
          )}
          {reko.dangerTypes.length > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <AlertTriangle aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
              {reko.dangerTypes.join(", ")}
            </span>
          )}
        </span>
      )}
    </button>
  )
}

/**
 * One Einsatz as a row: address, type, where it stands, how long. With `showForces` a second
 * line names who is out there – the Einsatz's own vehicles and Mannschaft, or for a stop of an
 * Auftrag the route and its vehicles (the route owns them, the stop none).
 */
function IncidentRow({
  operation,
  onOpen,
  auftrag,
  auftragVehicles,
  showForces,
}: {
  operation: Operation
  onOpen: () => void
  auftrag?: IncidentGroup
  auftragVehicles?: string[]
  showForces?: boolean
}) {
  const t = useTranslations("display.standby")
  const tk = useTranslations("kanban")
  const tv = useTranslations("incidents.vehicleStatus")
  const statusId = columns.find((column) => column.status.includes(operation.status))?.id ?? "incoming"
  const statusLabel =
    operation.status === "reko" && operation.assignedReko
      ? t("rekoBy", { name: operation.assignedReko.name })
      : tk(`columns.${statusId}`)
  const vehicles = auftrag
    ? auftragVehicles ?? []
    : [...(operation.zuFuss ? [tk("common.zuFuss")] : []), ...operation.vehicles.map((vehicle) => vehicle.name)]
  // The Einsatzleiter first, marked; the rest in the order the Einsatz lists them.
  const isLeader = (member: Operation["crew"][number]) => member.personnelId === operation.leaderId
  const crew = [...operation.crew.filter(isLeader), ...operation.crew.filter((member) => !isLeader(member))].map((member) =>
    isLeader(member) ? t("leader", { name: member.name }) : member.name,
  )
  return (
    <li>
      <button type="button" onClick={onOpen} className={cn("flex min-h-14 items-start gap-2 px-3 py-2.5", TAP)}>
        <AddressHead operation={operation} />
        <span className="min-w-0 flex-1">
          <span className={cn("block text-base font-semibold leading-[1.25]", WALL_TEXT_WRAP)}>{getIncidentLocationLabel(operation)}</span>
          <span className={cn("block text-xs text-muted-foreground", WALL_TEXT_WRAP)}>{getIncidentTypeLabel(operation.incidentType)}</span>
          {showForces && (auftrag || vehicles.length > 0 || crew.length > 0) && (
            <span className={cn("mt-0.5 block text-sm", WALL_TEXT_WRAP)}>
              {auftrag && <span className="text-muted-foreground">{tv("auftragLabel", { name: auftrag.name })}{vehicles.length > 0 && " · "}</span>}
              {vehicles.length > 0 && <span className="font-semibold">{vehicles.join(", ")}</span>}
              {crew.length > 0 && <span>{vehicles.length > 0 && " · "}{crew.join(", ")}</span>}
            </span>
          )}
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-2">
          {operation.amWarten ? (
            <span className="rounded-sm border border-warning/40 bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning-foreground">{tk("common.amWarten")}</span>
          ) : (
            <span className={cn("rounded-sm border px-2 py-0.5 text-xs font-medium", statusBadgeClass(operation.status))}>{statusLabel}</span>
          )}
          {/* The room «1h 50'» needs, so every row's clock ends at one edge. */}
          <span className="min-w-[4.5rem] text-right">
            <IncidentTime operation={operation} readOnly colorByAge className={TIME} iconClassName="h-3.5 w-3.5" />
          </span>
        </span>
      </button>
    </li>
  )
}
