"use client"

import { forwardRef } from "react"
import type { Operation, Person, Material } from "@/lib/contexts/operations-context"
import type { ApiVehicle } from "@/lib/api-client"

export interface PrintOptions {
  includeCompleted: boolean
  includePersonnel: boolean
  includeVehicles: boolean
  includeMaterials: boolean
}

interface PrintViewProps {
  eventName: string
  operations: Operation[]
  personnel: Person[]
  vehicles: ApiVehicle[]
  materials: Material[]
  options: PrintOptions
}

const STATUS_ORDER: Record<string, { label: string; order: number }> = {
  incoming: { label: "EINGEGANGEN", order: 1 },
  ready: { label: "REKO", order: 2 },
  enroute: { label: "DISPONIERT / UNTERWEGS", order: 3 },
  active: { label: "EINSATZ", order: 4 },
  returning: { label: "BEENDET / RÜCKFAHRT", order: 5 },
  complete: { label: "ABGESCHLOSSEN", order: 6 },
}

const PRIORITY_LABELS: Record<string, string> = {
  high: "HOCH",
  medium: "MITTEL",
  low: "TIEF",
}

const DANGER_LABELS: Record<string, string> = {
  fire: "Brand",
  explosion: "Explosion",
  collapse: "Einsturz",
  chemical: "Chemie",
  electrical: "Elektrik",
  radiation: "Strahlung",
  water: "Wasser",
  traffic: "Verkehr",
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
  ({ eventName, operations, personnel, vehicles, materials, options }, ref) => {
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
      (a, b) => (STATUS_ORDER[a]?.order ?? 99) - (STATUS_ORDER[b]?.order ?? 99)
    )

    // Filter personnel (only checked-in / available + assigned)
    const filteredPersonnel = personnel.filter(
      (p) => p.status === "available" || p.status === "assigned"
    )

    // Filter materials
    const filteredMaterials = materials.filter(
      (m) => m.status === "available" || m.status === "assigned"
    )

    return (
      <div ref={ref} className="print-view hidden print:block bg-white text-black p-4 font-mono text-xs">
        {/* Header */}
        <div className="border-b-2 border-black pb-2 mb-4">
          <h1 className="text-lg font-bold">KP RÜCK STATUSÜBERSICHT</h1>
          <div className="flex justify-between text-sm">
            <span>Event: {eventName}</span>
            <span>Gedruckt: {formatDateTime(new Date())}</span>
          </div>
        </div>

        {/* Incidents by Status */}
        {sortedStatuses.map((status) => {
          const statusOps = operationsByStatus[status]
          const statusInfo = STATUS_ORDER[status]

          return (
            <div key={status} className="mb-4">
              <h2 className="font-bold border-b border-black mb-2">
                {statusInfo?.label ?? status.toUpperCase()} ({statusOps.length})
              </h2>

              {/* Table for A4, will be styled as list for thermal via CSS */}
              <table className="w-full text-xs border-collapse">
                <thead className="print-a4-only">
                  <tr className="border-b border-gray-400">
                    <th className="text-left p-1">Adresse</th>
                    <th className="text-left p-1">Typ</th>
                    <th className="text-left p-1">Prio</th>
                    <th className="text-left p-1">Zeit</th>
                    <th className="text-left p-1">Personal</th>
                    <th className="text-left p-1">Fahrzeuge</th>
                    <th className="text-left p-1">Reko</th>
                  </tr>
                </thead>
                <tbody>
                  {statusOps.map((op, idx) => (
                    <tr key={op.id} className="border-b border-gray-200 align-top">
                      <td className="p-1">
                        <div className="font-semibold">{idx + 1}. {op.location}</div>
                        {op.notes && (
                          <div className="text-gray-600 text-[10px] mt-1 print-thermal-only">
                            Meldung: {op.notes}
                          </div>
                        )}
                      </td>
                      <td className="p-1">{op.incidentType}</td>
                      <td className="p-1">
                        <span className={op.priority === "high" ? "font-bold" : ""}>
                          {PRIORITY_LABELS[op.priority] ?? op.priority}
                        </span>
                      </td>
                      <td className="p-1">{formatTime(op.dispatchTime)}</td>
                      <td className="p-1">{op.crew.join(", ") || "-"}</td>
                      <td className="p-1">{op.vehicles.join(", ") || "-"}</td>
                      <td className="p-1">
                        {op.hasCompletedReko && op.rekoSummary ? (
                          <div>
                            {op.rekoSummary.hasDangers && op.rekoSummary.dangerTypes.length > 0 && (
                              <div className="text-[10px]">
                                {op.rekoSummary.dangerTypes
                                  .map((d) => DANGER_LABELS[d] ?? d)
                                  .join(", ")}
                              </div>
                            )}
                            {op.rekoSummary.personnelCount && (
                              <div className="text-[10px]">~{op.rekoSummary.personnelCount} Pers.</div>
                            )}
                            {op.rekoSummary.estimatedDuration && (
                              <div className="text-[10px]">~{op.rekoSummary.estimatedDuration}h</div>
                            )}
                          </div>
                        ) : (
                          "-"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        })}

        {/* Personnel Manifest */}
        {options.includePersonnel && filteredPersonnel.length > 0 && (
          <div className="mb-4 page-break-inside-avoid">
            <h2 className="font-bold border-b border-black mb-2">
              PERSONAL ({filteredPersonnel.length} eingecheckt)
            </h2>
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-gray-400">
                  <th className="text-left p-1">Status</th>
                  <th className="text-left p-1">Name</th>
                  <th className="text-left p-1">Funktion</th>
                </tr>
              </thead>
              <tbody>
                {filteredPersonnel.map((person) => (
                  <tr key={person.id} className="border-b border-gray-200">
                    <td className="p-1">
                      {person.status === "assigned" ? "Im Einsatz" : "Verfügbar"}
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
            <h2 className="font-bold border-b border-black mb-2">
              FAHRZEUGE ({vehicles.length})
            </h2>
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-gray-400">
                  <th className="text-left p-1">Status</th>
                  <th className="text-left p-1">Fahrzeug</th>
                  <th className="text-left p-1">Typ</th>
                  <th className="text-left p-1">Funkrufname</th>
                </tr>
              </thead>
              <tbody>
                {vehicles.map((vehicle) => (
                  <tr key={vehicle.id} className="border-b border-gray-200">
                    <td className="p-1">
                      {vehicle.status === "assigned" ? "Im Einsatz" : vehicle.status === "available" ? "Verfügbar" : vehicle.status}
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
            <h2 className="font-bold border-b border-black mb-2">
              MATERIAL ({filteredMaterials.length})
            </h2>
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-gray-400">
                  <th className="text-left p-1">Status</th>
                  <th className="text-left p-1">Material</th>
                  <th className="text-left p-1">Kategorie</th>
                </tr>
              </thead>
              <tbody>
                {filteredMaterials.map((material) => (
                  <tr key={material.id} className="border-b border-gray-200">
                    <td className="p-1">
                      {material.status === "assigned" ? "Im Einsatz" : "Verfügbar"}
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
          KP Rück - Notfall-Ausdruck | {formatDateTime(new Date())}
        </div>
      </div>
    )
  }
)

PrintView.displayName = "PrintView"
