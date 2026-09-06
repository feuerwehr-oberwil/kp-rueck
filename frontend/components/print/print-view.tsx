"use client"

import { forwardRef, useEffect } from "react"
import { useTranslations } from "next-intl"
import type { Operation, Person, Material } from "@/lib/contexts/operations-context"
import type { ApiPersonnelListItem, ApiVehicle } from "@/lib/api-client"
import type { GroupResources } from "@/lib/types/groups"
import { translateOutsideReact } from "@/lib/i18n-messages"
import { getIncidentLocationLabel, getIncidentTypeLabel } from "@/lib/incident-types"
import { sortCrewByLeader } from "@/lib/crew-order"
import { compareByName } from "@/lib/roster-order"
import { formatClockTime as formatTime } from "@/lib/incident-time"
import { columns } from "@/lib/kanban-utils"
import { isLocated } from "@/lib/utils/route-geo"
import { toResourceState, type ResourceState } from "@/lib/resource-status"
import { attendanceState, summarizeAttendance } from "@/components/kanban/attendance-modal"
import {
  selectMaterialOnSite,
  type MaterialOnSiteLocation,
} from "@/components/kanban/material-on-site-panel"
import dynamic from "next/dynamic"

// Dynamically import the map (no SSR – MapLibre GL needs a browser)
const PrintableMapInner = dynamic(() => import("./printable-map"), {
  ssr: false,
  loading: () => <div className="h-[300px] bg-gray-100 flex items-center justify-center text-gray-500">{translateOutsideReact("print.view.mapLoading")}</div>,
})

export interface PrintOptions {
  includeIncidents: boolean
  includeCompleted: boolean
  includePersonnel: boolean
  includeVehicles: boolean
  includeMaterials: boolean
  includeMap: boolean
}

/** The Auftrag an incident belongs to, resolved by the hub (the print view
 *  itself stays free of context lookups). A stop owns no resources — the route
 *  does — so they ride along or a grouped stop prints with no crew at all. */
export interface PrintAuftrag {
  name: string
  stopPos: number
  stopTotal: number
  resources: GroupResources
}

interface PrintViewProps {
  eventName: string
  operations: Operation[]
  personnel: Person[]
  vehicles: ApiVehicle[]
  materials: Material[]
  options: PrintOptions
  vehicleDrivers?: Map<string, string> // vehicle name -> driver name
  /** The event roll-call, which is the only source that knows who has GONE
   *  home; the board's personnel list only knows who is on it right now. */
  attendance?: ApiPersonnelListItem[]
  /** personnel id → the roles they hold in this Ereignis, already labelled.
   *  Resolved by the hub, which loads the special functions anyway for the
   *  vehicle drivers — this view stays presentational. */
  eventFunctions?: Map<string, string>
  /** incident id → its Auftrag context and the route's resources. */
  auftraege?: Map<string, PrintAuftrag>
  /** material id → the Schadenplatz it is still standing at (`/restliste`). */
  materialOnSite?: ReadonlyMap<string, MaterialOnSiteLocation>
  /** Fired once the sheet is safe to send to the printer: the map has drawn its
   *  tiles, or there is no map on this sheet at all. A WebGL canvas prints as it
   *  stands, so printing before that would put an empty frame on the paper.
   *  Must be stable (`useCallback`) — it is an effect dependency. */
  onMapReady?: () => void
  onMapError?: () => void
  onMapLoading?: () => void
}

// Reko danger types with a print.view.danger.* label (others fall back to the raw key).
const DANGER_KEYS = ["fire", "explosion", "collapse", "chemical", "electrical", "radiation", "water", "traffic"]

// Column display order. Derived from the board's own columns — the only
// ordering of statuses that exists — so a new column cannot silently desync
// the printed sheet from the board it is a snapshot of.
const STATUS_ORDER: string[] = columns.map((column) => column.id)

function statusRank(status: string): number {
  const index = STATUS_ORDER.indexOf(status)
  return index === -1 ? STATUS_ORDER.length : index
}

/** In-use first, then free, then everything that is out. Same three-state model
 *  personnel, vehicles and material share on the board (`resource-status`). */
const RESOURCE_STATE_RANK: Record<ResourceState, number> = {
  assigned: 0,
  available: 1,
  maintenance: 2,
  unavailable: 3,
}

/** What one line of the printed roster says. */
type RosterState = "assigned" | "available" | "left"

interface RosterRow {
  id: string
  name: string
  role: string
  state: RosterState
  /** What this person holds for THIS Ereignis — «Fahrer TLF 1», «Reko», … The
   *  roster rank next to it is the same at every Ereignis; this is the line an
   *  operator reads the printout for. Empty for most people. */
  eventFunction: string
}

const ROSTER_RANK: Record<RosterState, number> = { assigned: 0, available: 1, left: 2 }

function formatDateTime(date: Date): string {
  return date.toLocaleString("de-CH", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

/**
 * Crew, vehicles and materials as they actually stand at this incident: its own
 * assignments plus the ones its Auftrag owns. Mirrors the WhatsApp formatter —
 * a grouped stop carries nothing itself, so without this it prints empty.
 */
function effectiveResources(op: Operation, auftrag: PrintAuftrag | undefined) {
  if (!auftrag) {
    return {
      crew: op.crew,
      leaderName: op.leaderName,
      vehicles: op.vehicles,
      driverStay: op.vehicleDriverStay,
      materials: op.materials,
    }
  }
  const driverStay = new Map(op.vehicleDriverStay ?? [])
  for (const vehicle of auftrag.resources.vehicles) {
    if (vehicle.driverStay !== undefined) driverStay.set(vehicle.name, vehicle.driverStay)
  }
  return {
    crew: [...op.crew, ...auftrag.resources.personnel.map((p) => p.name)],
    leaderName: auftrag.resources.personnel.find((p) => p.isLeader)?.name ?? op.leaderName,
    vehicles: [...op.vehicles, ...auftrag.resources.vehicles.map((v) => v.name)],
    driverStay,
    materials: [...op.materials, ...auftrag.resources.materials.map((m) => m.resourceId)],
  }
}

export const PrintView = forwardRef<HTMLDivElement, PrintViewProps>(
  (
    {
      eventName,
      operations,
      personnel,
      vehicles,
      materials,
      options,
      vehicleDrivers,
      attendance,
      eventFunctions,
      auftraege,
      materialOnSite,
      onMapReady,
      onMapError,
      onMapLoading,
    },
    ref
  ) => {
    const t = useTranslations("print.view")
    const tAttendance = useTranslations("kanban.attendance")

    // Filter operations based on options
    const filteredOperations = options.includeCompleted
      ? operations
      : operations.filter((op) => op.status !== "complete")

    // Whether this sheet carries a map at all. When it does not, nobody will
    // report in, so the readiness the print button waits for is announced here.
    const showMap = options.includeMap && filteredOperations.length > 0
    useEffect(() => {
      if (!showMap) onMapReady?.()
    }, [showMap, onMapReady])

    // Group operations by status
    const operationsByStatus = filteredOperations.reduce(
      (acc, op) => {
        if (!acc[op.status]) {
          acc[op.status] = []
        }
        acc[op.status].push(op)
        return acc
      },
      {} as Record<string, Operation[]>
    )

    // Sort statuses by the board's column order
    const sortedStatuses = Object.keys(operationsByStatus).sort(
      (a, b) => statusRank(a) - statusRank(b)
    )

    // One continuous number per incident, in the order they are printed — that
    // number is also the marker on the map, so a pin can be looked up in the
    // list without counting columns.
    const numbering = new Map<string, number>()
    for (const status of sortedStatuses) {
      for (const op of operationsByStatus[status]) numbering.set(op.id, numbering.size + 1)
    }

    // The printed roster. The roll-call is authoritative when we have it: it is
    // the only list that knows the difference between "never came" (not printed)
    // and "was here and went home" (printed, as «gegangen» — the sheet exists to
    // answer who is still here).
    const personById = new Map(personnel.map((p) => [p.id, p]))
    const rosterRows: RosterRow[] = attendance?.length
      ? attendance
          .map((item): RosterRow | null => {
            const state = attendanceState(item)
            if (state === "absent") return null
            const person = personById.get(String(item.id))
            const inUse = person ? person.status === "assigned" : item.is_assigned === true
            return {
              id: String(item.id),
              name: item.name,
              role: person?.role ?? item.role ?? "",
              eventFunction: eventFunctions?.get(String(item.id)) ?? "",
              state: state === "left" ? "left" : inUse ? "assigned" : "available",
            }
          })
          .filter((row): row is RosterRow => row !== null)
      : personnel
          .filter((p) => p.status === "available" || p.status === "assigned")
          .map((p) => ({
            id: p.id,
            name: p.name,
            role: p.role,
            eventFunction: eventFunctions?.get(p.id) ?? "",
            state: p.status === "assigned" ? "assigned" : "available",
          }))
    // In-use first, then the roll-call order: flat alphabetical, the same rule
    // (and the same comparator) the Anwesenheit modal and /check-in use. `"de"`
    // was close enough to be invisible until an Ö met a French-language device.
    rosterRows.sort((a, b) => ROSTER_RANK[a.state] - ROSTER_RANK[b.state] || compareByName(a, b))
    const presentCount = rosterRows.filter((row) => row.state !== "left").length
    const attendanceSummary = attendance?.length ? summarizeAttendance(attendance) : null

    // Vehicles and materials, in-use first (see RESOURCE_STATE_RANK).
    const sortedVehicles = [...vehicles].sort(
      (a, b) =>
        RESOURCE_STATE_RANK[toResourceState(a.status)] - RESOURCE_STATE_RANK[toResourceState(b.status)] ||
        a.name.localeCompare(b.name, "de")
    )

    // Filter materials
    const filteredMaterials = materials
      .filter((m) => m.status === "available" || m.status === "assigned")
      .sort(
        (a, b) =>
          RESOURCE_STATE_RANK[toResourceState(a.status)] - RESOURCE_STATE_RANK[toResourceState(b.status)] ||
          a.name.localeCompare(b.name, "de")
      )

    // What of ours is still standing at a Schadenplatz. Same selector the board
    // panel uses, so the two can never disagree.
    const onSiteEntries = materialOnSite ? selectMaterialOnSite(materialOnSite, materials) : []

    // material id → the Schadenplatz it is on, for the inventory's «Ort» column.
    // Two sources, strongest first: a unit the rapport says stayed behind
    // (address included), then an open assignment on an incident.
    const materialPlaces = new Map<string, string>()
    for (const op of operations) {
      for (const id of op.materials) {
        if (!materialPlaces.has(id)) materialPlaces.set(id, getIncidentLocationLabel(op))
      }
    }
    for (const entry of onSiteEntries) {
      if (entry.address) materialPlaces.set(entry.materialId, entry.address)
    }
    /** Where this unit is *right now*: the Schadenplatz it is standing on, or a
     *  dash for one that is in the Magazin — the Kategorie column next to it
     *  already names the shelf, and repeating it would fill the column with the
     *  one answer nobody has to go looking for. */
    const materialPlace = (material: Material): string => materialPlaces.get(material.id) ?? "-"

    // Get material names by ID, marking the units that never came back.
    const getMaterialNames = (materialIds: string[]) => {
      return materialIds
        .map((id) => {
          const name = materials.find((m) => m.id === id)?.name ?? id
          return materialOnSite?.has(id) ? `${name} (${t("vorOrt")})` : name
        })
        .join(", ")
    }

    const vehicleStatusLabel = (status: string): string => {
      switch (toResourceState(status)) {
        case "assigned":
          return t("inUse")
        case "available":
          return t("available")
        case "maintenance":
          return t("maintenance")
        default:
          return t("unavailable")
      }
    }

    return (
      <div ref={ref} className="print-view print-only bg-white text-black p-4 font-sans text-xs">
        {/* Header */}
        <div className="border-b-2 border-black pb-2 mb-4">
          <h1 className="text-lg font-bold">{t("title")}</h1>
          <div className="flex justify-between text-sm">
            <span>{t("eventLabel")}: {eventName}</span>
            <span>{t("printedLabel")}: {formatDateTime(new Date())}</span>
          </div>
        </div>

        {/* Map Overview — its own A4 page. `breakAfter` is set inline rather than
            via a utility class so it cannot be lost to a purge, and the heading
            sits inside the same break-inside-avoid block as the map so it can
            never be orphaned at the foot of the page before it. */}
        {showMap && (
          <div
            className="mb-4 page-break-inside-avoid"
            // Nothing to map = no map = no reason to spend a sheet of paper on
            // the "keine Koordinaten" box.
            style={filteredOperations.some(isLocated) ? { breakAfter: "page" } : undefined}
          >
            <h2 className="font-bold border-b border-black mb-2 text-sm">
              {t("mapOverview")}
            </h2>
            <PrintableMapInner
              operations={filteredOperations}
              numbering={numbering}
              onReady={onMapReady}
              onError={onMapError}
              onLoading={onMapLoading}
            />
          </div>
        )}

        {/* Incidents by Status */}
        {options.includeIncidents && sortedStatuses.map((status) => {
          const statusOps = operationsByStatus[status]

          return (
            <div key={status} className="mb-4">
              {/* Caps come from CSS, not the source string — the message block stays
                  title-case like every other status block (decision of 2026-07-21). */}
              <h2 className="font-bold border-b border-black mb-2 text-sm uppercase">
                {STATUS_ORDER.includes(status) ? t(`statusHeading.${status}`) : status.toUpperCase()} ({statusOps.length})
              </h2>

              {/* Card-style layout for each incident */}
              {statusOps.map((op) => {
                const auftrag = auftraege?.get(op.id)
                const { crew, leaderName, vehicles: opVehicles, driverStay, materials: opMaterials } =
                  effectiveResources(op, auftrag)

                // The exception states, on one scannable line. Each of these
                // changes what the operator has to DO about the incident, which
                // is why they sit above the resource columns rather than in them.
                const flags: string[] = []
                if (auftrag) {
                  flags.push(
                    t("auftrag", { name: auftrag.name, pos: auftrag.stopPos, total: auftrag.stopTotal })
                  )
                }
                if (op.amWarten) {
                  flags.push(op.amWartenNote ? `${t("amWarten")}: ${op.amWartenNote}` : t("amWarten"))
                }
                if (op.pickupNeeded) {
                  const since = op.pickupRequestedAt ? ` (${t("since", { time: formatTime(op.pickupRequestedAt) })})` : ""
                  flags.push(`${t("abholung")}${since}${op.pickupNote ? `: ${op.pickupNote}` : ""}`)
                }
                if (op.zuFuss) flags.push(t("zuFuss"))
                if (op.nachbarhilfe) {
                  flags.push(op.nachbarhilfeNote ? `${t("nachbarhilfe")}: ${op.nachbarhilfeNote}` : t("nachbarhilfe"))
                }
                if (op.source === "intake") flags.push(t("phoneReported"))
                if (op.source === "feld") flags.push(t("feldReported"))

                // «Wer war draussen, was hat er gesehen» on one line: the Reko's
                // name (with the time it got there), then what it reported.
                const arrival = op.rekoArrivedAt ? t("onSiteSince", { time: formatTime(op.rekoArrivedAt) }) : null
                const rekoWho = op.assignedReko
                  ? arrival ? `${op.assignedReko.name} (${arrival})` : op.assignedReko.name
                  : arrival
                const rekoBits = [
                  rekoWho,
                  op.rekoSummary?.hasDangers && op.rekoSummary.dangerTypes.length > 0
                    ? op.rekoSummary.dangerTypes
                        .map((d) => (DANGER_KEYS.includes(d) ? t(`danger.${d}`) : d))
                        .join(", ")
                    : null,
                  op.rekoSummary?.personnelCount
                    ? t("persCount", { count: op.rekoSummary.personnelCount })
                    : null,
                  op.rekoSummary?.estimatedDuration
                    ? t("durationHours", { count: op.rekoSummary.estimatedDuration })
                    : null,
                ].filter((bit): bit is string => Boolean(bit))

                return (
                <div key={op.id} className="border border-gray-400 mb-2 p-2 page-break-inside-avoid">
                  {/* Header row */}
                  <div className="flex justify-between items-start border-b border-gray-300 pb-1 mb-1">
                    <div className="font-bold text-sm">
                      {numbering.get(op.id)}. {getIncidentLocationLabel(op)}
                    </div>
                    <div className="text-right text-[10px]">
                      <span className={op.priority === "high" ? "font-bold" : ""}>
                        {["high", "medium", "low"].includes(op.priority) ? t(`priority.${op.priority}`) : op.priority}
                      </span>
                      {" | "}
                      {formatTime(op.dispatchTime)}
                    </div>
                  </div>

                  {flags.length > 0 && (
                    <div className="mb-1 font-semibold">{flags.join(" · ")}</div>
                  )}

                  {/* Two column layout */}
                  <div className="flex gap-4">
                    {/* Left column */}
                    <div className="flex-1">
                      <div className="mb-1">
                        <span className="font-semibold">{t("typ")}:</span> {getIncidentTypeLabel(op.incidentType)}
                      </div>
                      {crew.length > 0 && (
                        <div className="mb-1">
                          {/* EL first (decision 23) — a printed sheet has no board behind it. */}
                          <span className="font-semibold">{t("personal")}:</span>{" "}
                          {sortCrewByLeader(crew, leaderName)
                            .map((name) => (leaderName && name === leaderName ? `${t("leaderPrefix")} ${name}` : name))
                            .join(", ")}
                        </div>
                      )}
                      {opVehicles.length > 0 && (
                        <div className="mb-1">
                          <span className="font-semibold">{t("fahrzeuge")}:</span>{" "}
                          {opVehicles.map((vName) => {
                            const driverName = vehicleDrivers?.get(vName)
                            const callsign = op.vehicleCallsigns.get(vName)
                            const stays = driverStay?.get(vName)
                            const head = callsign ? `${vName} · ${callsign}` : vName
                            const detail: string[] = []
                            if (driverName) detail.push(`${t("driverPrefix")}: ${driverName}`)
                            if (stays !== undefined) detail.push(stays ? t("driverStays") : t("driverReturns"))
                            return detail.length > 0 ? `${head} (${detail.join(", ")})` : head
                          }).join(", ")}
                        </div>
                      )}
                      {opMaterials.length > 0 && (
                        <div className="mb-1">
                          <span className="font-semibold">{t("material")}:</span> {getMaterialNames(opMaterials)}
                        </div>
                      )}
                    </div>

                    {/* Right column */}
                    <div className="flex-1">
                      {(op.contact || op.contactPhone) && (
                        <div className="mb-1">
                          <span className="font-semibold">{t("kontakt")}:</span> {op.contact}
                          {op.contactPhone && (
                            <>
                              {op.contact ? " · " : " "}
                              <span className="font-semibold">{t("telPrefix")}</span> {op.contactPhone}
                            </>
                          )}
                        </div>
                      )}
                      {rekoBits.length > 0 && (
                        <div className="mb-1">
                          <span className="font-semibold">{t("reko")}:</span> {rekoBits.join(" | ")}
                        </div>
                      )}
                      {op.rekoSummary?.summaryText && (
                        <div className="mb-1">
                          <span className="font-semibold">{t("lagebeurteilung")}:</span>{" "}
                          {op.rekoSummary.summaryText}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Full width fields */}
                  {op.notes && (
                    <div className="mt-1 pt-1 border-t border-gray-200">
                      <span className="font-semibold">{t("meldung")}:</span> {op.notes}
                    </div>
                  )}
                  {op.internalNotes && (
                    <div className="mt-1 text-gray-600">
                      <span className="font-semibold">{t("interneNotizen")}:</span> {op.internalNotes}
                    </div>
                  )}
                </div>
                )
              })}
            </div>
          )
        })}

        {/* Personnel Manifest */}
        {options.includePersonnel && rosterRows.length > 0 && (
          <div className="mb-4 page-break-inside-avoid">
            <h2 className="font-bold border-b border-black mb-2 text-sm">
              {t("personalHeading", { count: presentCount })}
            </h2>
            {attendanceSummary && (
              <div className="mb-1 text-[10px]">
                {tAttendance("summary", attendanceSummary)}
              </div>
            )}
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-gray-400">
                  <th className="text-left p-1">{t("statusCol")}</th>
                  <th className="text-left p-1">{t("nameCol")}</th>
                  <th className="text-left p-1">{t("funktionCol")}</th>
                </tr>
              </thead>
              <tbody>
                {rosterRows.map((row) => (
                  <tr key={row.id} className="border-b border-gray-200">
                    <td className="p-1">
                      {row.state === "assigned" ? t("inUse") : row.state === "left" ? t("gegangen") : t("available")}
                    </td>
                    <td className="p-1">{row.name}</td>
                    {/* The Ereignis role leads: «Fahrer TLF 1» is what the KP
                        looks this list up for, the roster rank behind it is the
                        same at every Ereignis. */}
                    <td className="p-1">{[row.eventFunction, row.role].filter(Boolean).join(" · ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Vehicle Status */}
        {options.includeVehicles && sortedVehicles.length > 0 && (
          <div className="mb-4 page-break-inside-avoid">
            <h2 className="font-bold border-b border-black mb-2 text-sm">
              {t("fahrzeugeHeading", { count: sortedVehicles.length })}
            </h2>
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-gray-400">
                  <th className="text-left p-1">{t("statusCol")}</th>
                  <th className="text-left p-1">{t("fahrzeugCol")}</th>
                  <th className="text-left p-1">{t("typCol")}</th>
                  {/* Who drives it. A fleet list that says «TLF 1 · verfügbar»
                      and nothing else is missing the half that decides whether
                      it can actually roll — and this sheet is what gets read
                      when the screens are gone. */}
                  <th className="text-left p-1">{t("fahrerCol")}</th>
                  <th className="text-left p-1">{t("funkrufnameCol")}</th>
                </tr>
              </thead>
              <tbody>
                {sortedVehicles.map((vehicle) => (
                  <tr key={vehicle.id} className="border-b border-gray-200">
                    <td className="p-1">{vehicleStatusLabel(vehicle.status)}</td>
                    <td className="p-1">{vehicle.name}</td>
                    <td className="p-1">{vehicle.type}</td>
                    <td className="p-1">{vehicleDrivers?.get(vehicle.name) || "-"}</td>
                    <td className="p-1">{vehicle.radio_call_sign || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Material still standing at a Schadenplatz. Above the inventory on
            purpose: "what has not come home" is the sharper question, and it is
            the one somebody reads off this sheet when the Einsatz winds down. */}
        {options.includeMaterials && onSiteEntries.length > 0 && (
          <div className="mb-4 page-break-inside-avoid">
            <h2 className="font-bold border-b border-black mb-2 text-sm">
              {t("materialOnSiteHeading", { count: onSiteEntries.length })}
            </h2>
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-gray-400">
                  <th className="text-left p-1">{t("materialCol")}</th>
                  <th className="text-left p-1">{t("schadenplatzCol")}</th>
                  <th className="text-left p-1">{t("seitCol")}</th>
                </tr>
              </thead>
              <tbody>
                {onSiteEntries.map((entry) => (
                  <tr key={entry.materialId} className="border-b border-gray-200">
                    <td className="p-1">{entry.name}</td>
                    <td className="p-1">{entry.address ?? t("unknownAddress")}</td>
                    <td className="p-1">{entry.since ? formatTime(entry.since) : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Materials */}
        {options.includeMaterials && filteredMaterials.length > 0 && (
          <div className="mb-4 page-break-inside-avoid">
            <h2 className="font-bold border-b border-black mb-2 text-sm">
              {t("materialHeading", { count: filteredMaterials.length })}
            </h2>
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-gray-400">
                  <th className="text-left p-1">{t("statusCol")}</th>
                  <th className="text-left p-1">{t("materialCol")}</th>
                  {/* Where the unit actually is: the Schadenplatz it is standing
                      on, otherwise the depot it belongs to. «Im Einsatz» without
                      a place is the answer that sends somebody looking. */}
                  <th className="text-left p-1">{t("ortCol")}</th>
                  <th className="text-left p-1">{t("kategorieCol")}</th>
                </tr>
              </thead>
              <tbody>
                {filteredMaterials.map((material) => (
                  <tr key={material.id} className="border-b border-gray-200">
                    <td className="p-1">
                      {materialOnSite?.has(material.id)
                        ? t("vorOrt")
                        : material.status === "assigned"
                          ? t("inUse")
                          : t("available")}
                    </td>
                    <td className="p-1">{material.name}</td>
                    <td className="p-1">{materialPlace(material)}</td>
                    <td className="p-1">{material.category}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Footer */}
        <div className="border-t border-black pt-2 mt-4 text-[10px] text-gray-500">
          {t("footer")} | {formatDateTime(new Date())}
        </div>
      </div>
    )
  }
)

PrintView.displayName = "PrintView"
