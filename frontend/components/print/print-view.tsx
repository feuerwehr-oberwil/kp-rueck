"use client"

import { forwardRef } from "react"
import { useTranslations } from "next-intl"
import type { Operation, Person, Material } from "@/lib/contexts/operations-context"
import type { ApiVehicle } from "@/lib/api-client"
import { translateOutsideReact } from "@/lib/i18n-messages"
import { formatLocationForDisplay, getGlobalHomeCity } from "@/lib/utils"
import { getIncidentTypeLabel } from "@/lib/incident-types"
import dynamic from "next/dynamic"

// Dynamically import Leaflet components (no SSR)
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

interface PrintViewProps {
  eventName: string
  operations: Operation[]
  personnel: Person[]
  vehicles: ApiVehicle[]
  materials: Material[]
  options: PrintOptions
  vehicleDrivers?: Map<string, string> // vehicle name -> driver name
}

// Reko danger types with a print.view.danger.* label (others fall back to the raw key).
const DANGER_KEYS = ["fire", "explosion", "collapse", "chemical", "electrical", "radiation", "water", "traffic"]

// Column display order (labels come from the print.view.statusHeading messages).
const STATUS_ORDER: Record<string, number> = {
  incoming: 1,
  reko: 2,
  reko_done: 3,
  enroute: 4,
  active: 5,
  returning: 6,
  complete: 7,
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" })
}

function formatDateTime(date: Date): string {
  return date.toLocaleString("de-CH", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export const PrintView = forwardRef<HTMLDivElement, PrintViewProps>(
  ({ eventName, operations, personnel, vehicles, materials, options, vehicleDrivers }, ref) => {
    const t = useTranslations("print.view")

    // Filter operations based on options
    const filteredOperations = options.includeCompleted
      ? operations
      : operations.filter((op) => op.status !== "complete")

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

    // Sort statuses by their defined order
    const sortedStatuses = Object.keys(operationsByStatus).sort(
      (a, b) => (STATUS_ORDER[a] ?? 99) - (STATUS_ORDER[b] ?? 99)
    )

    // Filter personnel (only checked-in / available + assigned)
    const filteredPersonnel = personnel.filter(
      (p) => p.status === "available" || p.status === "assigned"
    )

    // Filter materials
    const filteredMaterials = materials.filter(
      (m) => m.status === "available" || m.status === "assigned"
    )

    // Get material names by ID
    const getMaterialNames = (materialIds: string[]) => {
      return materialIds
        .map((id) => materials.find((m) => m.id === id)?.name ?? id)
        .join(", ")
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

        {/* Map Overview */}
        {options.includeMap && filteredOperations.length > 0 && (
          <div className="mb-4 page-break-inside-avoid">
            <h2 className="font-bold border-b border-black mb-2 text-sm">
              {t("mapOverview")}
            </h2>
            <PrintableMapInner operations={filteredOperations} />
          </div>
        )}

        {/* Incidents by Status */}
        {options.includeIncidents && sortedStatuses.map((status) => {
          const statusOps = operationsByStatus[status]

          return (
            <div key={status} className="mb-4">
              <h2 className="font-bold border-b border-black mb-2 text-sm">
                {status in STATUS_ORDER ? t(`statusHeading.${status}`) : status.toUpperCase()} ({statusOps.length})
              </h2>

              {/* Card-style layout for each incident */}
              {statusOps.map((op, idx) => (
                <div key={op.id} className="border border-gray-400 mb-2 p-2 page-break-inside-avoid">
                  {/* Header row */}
                  <div className="flex justify-between items-start border-b border-gray-300 pb-1 mb-1">
                    <div className="font-bold text-sm">
                      {idx + 1}. {(op.locationDisplay ?? formatLocationForDisplay(op.location, getGlobalHomeCity())) || getIncidentTypeLabel(op.incidentType)}
                    </div>
                    <div className="text-right text-[10px]">
                      <span className={op.priority === "high" ? "font-bold" : ""}>
                        {["high", "medium", "low"].includes(op.priority) ? t(`priority.${op.priority}`) : op.priority}
                      </span>
                      {" | "}
                      {formatTime(op.dispatchTime)}
                    </div>
                  </div>

                  {/* Two column layout */}
                  <div className="flex gap-4">
                    {/* Left column */}
                    <div className="flex-1">
                      <div className="mb-1">
                        <span className="font-semibold">{t("typ")}:</span> {op.incidentType}
                      </div>
                      {op.crew.length > 0 && (
                        <div className="mb-1">
                          <span className="font-semibold">{t("personal")}:</span> {op.crew.join(", ")}
                        </div>
                      )}
                      {op.vehicles.length > 0 && (
                        <div className="mb-1">
                          <span className="font-semibold">{t("fahrzeuge")}:</span>{" "}
                          {op.vehicles.map((vName) => {
                            const driverName = vehicleDrivers?.get(vName)
                            const callsign = op.vehicleCallsigns.get(vName)
                            const parts = [vName]
                            if (callsign) parts[0] = `${vName} · ${callsign}`
                            if (driverName) return `${parts[0]} (${t("driverPrefix")}: ${driverName})`
                            return parts[0]
                          }).join(", ")}
                        </div>
                      )}
                      {op.materials.length > 0 && (
                        <div className="mb-1">
                          <span className="font-semibold">{t("material")}:</span> {getMaterialNames(op.materials)}
                        </div>
                      )}
                    </div>

                    {/* Right column */}
                    <div className="flex-1">
                      {op.contact && (
                        <div className="mb-1">
                          <span className="font-semibold">{t("kontakt")}:</span> {op.contact}
                        </div>
                      )}
                      {op.hasCompletedReko && op.rekoSummary && (
                        <div className="mb-1">
                          <span className="font-semibold">{t("reko")}:</span>{" "}
                          {op.rekoSummary.hasDangers && op.rekoSummary.dangerTypes.length > 0 && (
                            <span>
                              {op.rekoSummary.dangerTypes
                                .map((d) => (DANGER_KEYS.includes(d) ? t(`danger.${d}`) : d))
                                .join(", ")}
                            </span>
                          )}
                          {op.rekoSummary.personnelCount && (
                            <span> | {t("persCount", { count: op.rekoSummary.personnelCount })}</span>
                          )}
                          {op.rekoSummary.estimatedDuration && (
                            <span> | {t("durationHours", { count: op.rekoSummary.estimatedDuration })}</span>
                          )}
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
              ))}
            </div>
          )
        })}

        {/* Personnel Manifest */}
        {options.includePersonnel && filteredPersonnel.length > 0 && (
          <div className="mb-4 page-break-inside-avoid">
            <h2 className="font-bold border-b border-black mb-2 text-sm">
              {t("personalHeading", { count: filteredPersonnel.length })}
            </h2>
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-gray-400">
                  <th className="text-left p-1">{t("statusCol")}</th>
                  <th className="text-left p-1">{t("nameCol")}</th>
                  <th className="text-left p-1">{t("funktionCol")}</th>
                </tr>
              </thead>
              <tbody>
                {filteredPersonnel.map((person) => (
                  <tr key={person.id} className="border-b border-gray-200">
                    <td className="p-1">
                      {person.status === "assigned" ? t("inUse") : t("available")}
                    </td>
                    <td className="p-1">{person.name}</td>
                    <td className="p-1">{person.role}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Vehicle Status */}
        {options.includeVehicles && vehicles.length > 0 && (
          <div className="mb-4 page-break-inside-avoid">
            <h2 className="font-bold border-b border-black mb-2 text-sm">
              {t("fahrzeugeHeading", { count: vehicles.length })}
            </h2>
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-gray-400">
                  <th className="text-left p-1">{t("statusCol")}</th>
                  <th className="text-left p-1">{t("fahrzeugCol")}</th>
                  <th className="text-left p-1">{t("typCol")}</th>
                  <th className="text-left p-1">{t("funkrufnameCol")}</th>
                </tr>
              </thead>
              <tbody>
                {vehicles.map((vehicle) => (
                  <tr key={vehicle.id} className="border-b border-gray-200">
                    <td className="p-1">
                      {vehicle.status === "assigned" ? t("inUse") : vehicle.status === "available" ? t("available") : vehicle.status}
                    </td>
                    <td className="p-1">{vehicle.name}</td>
                    <td className="p-1">{vehicle.type}</td>
                    <td className="p-1">{vehicle.radio_call_sign || "-"}</td>
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
                  <th className="text-left p-1">{t("kategorieCol")}</th>
                </tr>
              </thead>
              <tbody>
                {filteredMaterials.map((material) => (
                  <tr key={material.id} className="border-b border-gray-200">
                    <td className="p-1">
                      {material.status === "assigned" ? t("inUse") : t("available")}
                    </td>
                    <td className="p-1">{material.name}</td>
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
