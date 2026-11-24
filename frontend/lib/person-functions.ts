/**
 * What a person can hold on the board besides an Einsatz, and the one list the person
 * popover shows (UX.1 + UX.2 + UX.15, owner pick 1B «Eine Checkliste», 24.11.2026).
 *
 * `personFunctionItems` is THE item source for the person's functions: the right-click menu
 * (`person-context-menu.tsx`) renders every item, the popover (`person-popover.tsx`) folds the
 * driver items into one «Fahrer ›» row. So left and right click show the same ticks.
 *
 * `personChecklist` orders it: what the person holds on top (places first, then functions),
 * the rest below. A Fahrer who is crew on the Einsatz their vehicle stands on is ONE place
 * («Mannschaft · fährt Trawa»), not two (UX.15).
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
  /** An Einsatz (crew or Reko) or an Auftrag. `drives`: the vehicle this person drives on it. */
  | { kind: "place"; binding: ResourceBinding; drives: string | null }
  /** All driver items as one row; `held` is the vehicle driven. `where`: the Einsatz that
   *  vehicle stands on when no place row already says so. */
  | { kind: "driver"; held: DriverItem | null; vehicles: DriverItem[]; where: string | null }
  | { kind: "station"; item: StationItem }

export interface PersonChecklist {
  /** Ticked: places, then the Fahrer, then the station functions. */
  held: ChecklistRow[]
  /** Unticked: the station functions, then «Fahrer ›». */
  free: ChecklistRow[]
  /** How many things bind the person – the badge. A folded driver and a Reko function with
   *  its Einsätze listed count once. */
  count: number
}

/**
 * `places` are the person's Einsätze and Aufträge (`collectPersonPlaces`); `drivenOperation`
 * is the Einsatz the held vehicle stands on, if any.
 */
export function personChecklist(
  places: readonly ResourceBinding[],
  functions: readonly PersonFunctionItem[],
  drivenOperation: { id: string; label: string } | null,
): PersonChecklist {
  const vehicles = functions.filter((item): item is DriverItem => item.kind === "driver")
  const stations = functions.filter((item): item is StationItem => item.kind === "station")
  const drivenItem = vehicles.find((item) => item.held) ?? null

  // UX.15: crew on the Einsatz the vehicle stands on → that place says «fährt …».
  const crewPlaceOfVehicle =
    drivenItem && drivenOperation
      ? places.find((place) => place.kind === "incident" && place.targetId === drivenOperation.id && place.target !== REKO_TARGET)
      : undefined
  const placeRows: ChecklistRow[] = places.map((binding) => ({
    kind: "place",
    binding,
    drives: binding === crewPlaceOfVehicle && drivenItem ? drivenItem.vehicleName : null,
  }))
  const driverRow: ChecklistRow = {
    kind: "driver",
    held: drivenItem,
    vehicles,
    where: drivenItem && drivenOperation && !crewPlaceOfVehicle ? drivenOperation.label : null,
  }
  const stationRow = (item: StationItem): ChecklistRow => ({ kind: "station", item })

  const rekoListed = places.some((place) => place.target === REKO_TARGET)
  const heldStations = stations.filter((item) => item.held)
  const count =
    places.length +
    (drivenItem && !crewPlaceOfVehicle ? 1 : 0) +
    heldStations.filter((item) => !(item.functionType === "reko" && rekoListed)).length

  return {
    held: [...placeRows, ...(drivenItem ? [driverRow] : []), ...heldStations.map(stationRow)],
    free: [...stations.filter((item) => !item.held).map(stationRow), ...(drivenItem ? [] : [driverRow])],
    count,
  }
}
