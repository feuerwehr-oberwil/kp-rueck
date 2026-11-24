/**
 * What a person can hold on the board besides an Einsatz, and the one list the person
 * popover shows (UX.1 + UX.2 + UX.15, owner pick 1B «Eine Checkliste», 24.11.2026).
 *
 * `personFunctionItems` is THE item source for the person's functions: the right-click menu
 * (`person-context-menu.tsx`) renders every item, the popover (`person-popover.tsx`) shows one
 * Fahrer row per vehicle driven, or one «Fahrer ›» when none is. So left and right click show
 * the same ticks.
 *
 * `personChecklist` orders it: what the person holds on top (places first, then functions),
 * the rest below. A Fahrer who is crew on the Einsatz their vehicle stands on is ONE place
 * («Mannschaft · fährt Trawa») and no Fahrer row, not two (UX.15, owner sign-off 24.11.2026):
 * that role ends with the place's release or in the right-click menu.
 *
 * Pure, so both are tested without the board.
 */

import type { FunctionType } from "@/lib/api-client"
import type { Person } from "@/lib/contexts/operations-context"
import type { VehicleDriver, VehicleDrivers } from "@/lib/hooks/use-vehicle-drivers"
import type { ResourceBinding } from "@/lib/board-sidebar"
import { REKO_TARGET } from "@/lib/detail-target"

/** Every function but the driver: one per person, no vehicle. In the menu's order. */
export const STATION_FUNCTIONS = ["reko", "magazin", "telefondienst", "kommandoposten"] as const satisfies readonly FunctionType[]
export type StationFunction = (typeof STATION_FUNCTIONS)[number]

export type DriverItem = {
  kind: "driver"
  key: string
  vehicleId: string
  vehicleName: string
  held: boolean
  /** Somebody ELSE driving this vehicle – the menu names them. */
  holder: VehicleDriver | null
}
export type StationItem = { kind: "station"; key: string; functionType: StationFunction; held: boolean }
export type PersonFunctionItem = DriverItem | StationItem

type FunctionPerson = Pick<
  Person,
  "id" | "isDriver" | "driverVehicleId" | "isReko" | "isMagazin" | "isTelefondienst" | "isKommandoposten"
>

const holds: Record<StationFunction, (person: FunctionPerson) => boolean> = {
  reko: (person) => !!person.isReko,
  magazin: (person) => !!person.isMagazin,
  telefondienst: (person) => !!person.isTelefondienst,
  kommandoposten: (person) => !!person.isKommandoposten,
}

/**
 * One driver item per vehicle (fleet order as given), then the four station functions.
 * The ticks come off the person (the board sync); a vehicle's driver from `drivers` (the
 * live special-function rows) when it has an entry, which wins over a stale flag.
 */
export function personFunctionItems(
  person: FunctionPerson,
  vehicles: readonly { id: string; name: string }[],
  drivers: VehicleDrivers,
): PersonFunctionItem[] {
  const driverItems = vehicles.map((vehicle): DriverItem => {
    const entry = drivers.get(vehicle.id)
    const held = entry ? entry.personnelId === person.id : !!person.isDriver && person.driverVehicleId === vehicle.id
    return {
      kind: "driver",
      key: `driver-${vehicle.id}`,
      vehicleId: vehicle.id,
      vehicleName: vehicle.name,
      held,
      holder: entry && !held ? entry : null,
    }
  })
  const stationItems = STATION_FUNCTIONS.map(
    (functionType): StationItem => ({ kind: "station", key: functionType, functionType, held: holds[functionType](person) }),
  )
  return [...driverItems, ...stationItems]
}

/** One line of the person popover. */
export type ChecklistRow =
  /** An Einsatz (crew or Reko) or an Auftrag. `drives`: the vehicle(s) this person drives on it. */
  | { kind: "place"; binding: ResourceBinding; drives: string | null }
  /** A Fahrer row: one per vehicle driven away from the person's crew places (`held`), or one
   *  «Fahrer ›» with `held: null` when none is driven. `vehicles`: all driver items, for the
   *  vehicle choice. `where`: the Einsatz the vehicle stands on. */
  | { kind: "driver"; held: DriverItem | null; vehicles: DriverItem[]; where: string | null }
  | { kind: "station"; item: StationItem }

export interface PersonChecklist {
  /** Ticked: places, then the Fahrer rows a place does not already say, then the station
   *  functions. */
  held: ChecklistRow[]
  /** Unticked: the station functions, then «Fahrer ›». */
  free: ChecklistRow[]
  /** How many things bind the person – the badge. A driver who is crew on the vehicle's
   *  Einsatz and a Reko function with its Einsätze listed count once. */
  count: number
}

/** The open Einsatz a vehicle stands on, as the popover names it. */
export type VehicleOperation = (vehicleId: string) => { id: string; label: string } | null

/**
 * `places` are the person's Einsätze and Aufträge (`collectPersonPlaces`); `vehicleOperation`
 * finds the Einsatz each driven vehicle stands on. A person may drive several vehicles in one
 * Ereignis (the right-click menu ticks each): each gets its own row, which ends that one.
 */
export function personChecklist(
  places: readonly ResourceBinding[],
  functions: readonly PersonFunctionItem[],
  vehicleOperation: VehicleOperation,
): PersonChecklist {
  const vehicles = functions.filter((item): item is DriverItem => item.kind === "driver")
  const stations = functions.filter((item): item is StationItem => item.kind === "station")

  // UX.15: crew on the Einsatz the vehicle stands on → that place says «fährt …».
  const driven = vehicles
    .filter((item) => item.held)
    .map((item) => {
      const operation = vehicleOperation(item.vehicleId)
      const crewPlace = operation
        ? places.find((place) => place.kind === "incident" && place.targetId === operation.id && place.target !== REKO_TARGET)
        : undefined
      return { item, operation, crewPlace }
    })
  const placeRows: ChecklistRow[] = places.map((binding) => {
    const drives = driven.filter((d) => d.crewPlace === binding).map((d) => d.item.vehicleName)
    return { kind: "place", binding, drives: drives.length > 0 ? drives.join(", ") : null }
  })
  const driverRows: ChecklistRow[] = driven
    .filter((d) => !d.crewPlace)
    .map((d) => ({ kind: "driver", held: d.item, vehicles, where: d.operation?.label ?? null }))
  const pickDriverRow: ChecklistRow = { kind: "driver", held: null, vehicles, where: null }
  const stationRow = (item: StationItem): ChecklistRow => ({ kind: "station", item })

  // A crew row drawn as Reko is no Reko place: the Reko function then counts on its own.
  const rekoListed = places.some((place) => place.target === REKO_TARGET && place.purpose !== "crew")
  const heldStations = stations.filter((item) => item.held)
  const count =
    places.length +
    driven.filter((d) => !d.crewPlace).length +
    heldStations.filter((item) => !(item.functionType === "reko" && rekoListed)).length

  return {
    held: [...placeRows, ...driverRows, ...heldStations.map(stationRow)],
    free: [...stations.filter((item) => !item.held).map(stationRow), ...(driven.length > 0 ? [] : [pickDriverRow])],
    count,
  }
}
