/**
 * Glue between the app's data (operations, route resources, materials) and the
 * pure Funkdurchsage builder in `radio-announcement.ts`.
 *
 * Both places that speak an Auftrag's announcement go through here — the
 * Disponiert dialog when a stop is dispatched, and «Durchsage wiederholen» in
 * the Aufträge-Slide-up — so the wording can never drift between them.
 */

import type { Material, Operation } from "@/lib/contexts/operations-context"
import type { GroupResources, IncidentGroup } from "@/lib/types/groups"
import { formatLocationForDisplay, getGlobalHomeCity } from "@/lib/utils"
import { toStopMirrorStatus } from "@/lib/kanban-utils"
import {
  auftragFullAnnouncement,
  auftragShortAnnouncement,
  needsFullAnnouncement,
  radioFingerprint,
  stopSpecial,
  type RadioDeployment,
  type RadioSegment,
  type RadioStop,
  type RadioTranslate,
} from "@/lib/radio-announcement"

/** Home-town-free address of a stop, the same one the dialogs show. */
export function stopAddress(operation: Operation | undefined, fallback: string): string {
  if (!operation) return fallback
  return (operation.locationDisplay ?? formatLocationForDisplay(operation.location, getGlobalHomeCity())) || fallback
}

/**
 * Everything that rides along on this dispatch: the route's own resources UNION
 * the announced stop's. A stop in an Auftrag is not supposed to carry resources
 * of its own — but if one does, it must still be read out, and it must still
 * count towards the fingerprint, or the change would go unannounced.
 */
export function routeDeployment(
  operation: Operation,
  resources: GroupResources,
  materials: Material[],
): RadioDeployment {
  const stay = new Map(operation.vehicleDriverStay ?? [])
  for (const vehicle of resources.vehicles) {
    if (vehicle.driverStay !== undefined) stay.set(vehicle.name, vehicle.driverStay)
  }
  const materialById = new Map(materials.map((material) => [material.id, material] as const))
  const materialItems = [
    ...operation.materials.map((id) => materialById.get(id)),
    ...resources.materials.map((material) => materialById.get(material.resourceId)),
  ].filter((material): material is Material => Boolean(material))

  return {
    crew: [...operation.crew, ...resources.personnel.map((person) => person.name)],
    // A stop owns no people, so for a grouped incident the EL comes off the
    // route; a standalone incident carries its own.
    leader: resources.personnel.find((person) => person.isLeader)?.name ?? operation.leaderName ?? null,
    vehicles: [...operation.vehicles, ...resources.vehicles.map((vehicle) => vehicle.name)].map((name) => ({
      name,
      stay: stay.get(name),
    })),
    materials: materialItems.map((material) => ({ name: material.name, category: material.category })),
    zuFuss: operation.zuFuss || false,
  }
}

/** The route's stops in order, numbered from 1 and never renumbered. */
export function routeStops(
  t: RadioTranslate,
  group: IncidentGroup,
  operations: Operation[],
  fallbackAddress: string,
): RadioStop[] {
  const byId = new Map(operations.map((operation) => [operation.id, operation] as const))
  return group.stopIds.map((incidentId, index) => {
    const operation = byId.get(incidentId)
    return {
      position: index + 1,
      address: stopAddress(operation, fallbackAddress),
      special: operation
        ? stopSpecial(t, {
            dangerTypes: operation.rekoSummary?.hasDangers ? operation.rekoSummary.dangerTypes : [],
            nachbarhilfe: operation.nachbarhilfe,
            nachbarhilfeNote: operation.nachbarhilfeNote,
          })
        : null,
      // A stop counts as done once the squad has left it — it drops out of the
      // list but keeps its number, so «Stop 3» stays the same address.
      done: operation ? operation.status === "returning" || operation.status === "complete" : false,
      // Screen-only: the list shows where each open stop stands.
      status: toStopMirrorStatus(operation),
    }
  })
}

export interface AuftragRadioInput {
  group: IncidentGroup
  /** The stop this announcement is about. */
  operation: Operation
  resources: GroupResources
  operations: Operation[]
  materials: Material[]
  funkrufname: string
  fallbackAddress: string
  /** Repeat of an earlier announcement: keep its form instead of deciding anew. */
  forceFull?: boolean
}

export interface AuftragRadio {
  segments: RadioSegment[]
  /** True when the full Auftragsdurchsage was used. */
  full: boolean
  /** Digest of the announced resources — store it, compare it next time. */
  fingerprint: string
}

/**
 * Build the announcement for one stop of an Auftrag, full or short.
 *
 * Full when nothing has been announced yet (this stop IS the Auftragsvergabe) or
 * when the route's crew/vehicles/material changed since the last one; short
 * otherwise. `forceFull` overrides the decision so «Wiederholen» repeats what
 * was actually said rather than what would be said now.
 */
export function auftragRadio(t: RadioTranslate, input: AuftragRadioInput): AuftragRadio {
  const deployment = routeDeployment(input.operation, input.resources, input.materials)
  const fingerprint = radioFingerprint(deployment)
  const full = input.forceFull ?? needsFullAnnouncement(input.group.lastAnnounced, fingerprint)
  const stops = routeStops(t, input.group, input.operations, input.fallbackAddress)
  const index = input.group.stopIds.indexOf(input.operation.id)
  const stop: RadioStop = stops[index] ?? {
    // A stop that is no longer in the route (removed while the dialog was open)
    // still deserves a sane sentence rather than a blank one.
    position: input.operation.groupPosition + 1,
    address: stopAddress(input.operation, input.fallbackAddress),
    special: null,
    done: false,
  }

  const segments = full
    ? auftragFullAnnouncement(t, {
        funkrufname: input.funkrufname,
        auftragName: input.group.name,
        deployment,
        stops,
      })
    : auftragShortAnnouncement(t, {
        funkrufname: input.funkrufname,
        auftragName: input.group.name,
        stop,
      })

  return { segments, full, fingerprint }
}
