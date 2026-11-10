/**
 * What a freshly claimed station still has to set up, read from what the server holds.
 *
 * A production install starts with a placeholder identity (backend/app/seed.py: «Musterstadt»
 * and its coordinates) and with no roster and no fleet at all. The claim (/setup) only asks
 * for the station's name and the admin password, so the board would open with a map centred
 * on a town that does not exist and an empty sidebar – and say nothing about either.
 */

/** The seed's placeholder Magazin (backend/app/seed.py, production branch). */
export const PLACEHOLDER_STATION = { latitude: 47.5596, longitude: 7.5886, homeCity: "Musterstadt" } as const

export interface StationSetupInput {
  settings: Record<string, string>
  personnelCount: number
  vehicleCount: number
}

export interface StationSetupState {
  /** The Magazin's location and the Einsatzgebiet are the station's own, not the placeholder. */
  locationSet: boolean
  /** There is at least one person and one vehicle to put on an Einsatz. */
  inventorySet: boolean
  done: boolean
}

const same = (value: string | undefined, placeholder: number) =>
  value !== undefined && Math.abs(Number.parseFloat(value) - placeholder) < 1e-6

export function stationSetupState({ settings, personnelCount, vehicleCount }: StationSetupInput): StationSetupState {
  const placeholderCoords =
    same(settings.firestation_latitude, PLACEHOLDER_STATION.latitude) &&
    same(settings.firestation_longitude, PLACEHOLDER_STATION.longitude)
  const placeholderCity = (settings.home_city ?? "").trim().startsWith(PLACEHOLDER_STATION.homeCity)
  const locationSet = !placeholderCoords && !placeholderCity
  const inventorySet = personnelCount > 0 && vehicleCount > 0
  return { locationSet, inventorySet, done: locationSet && inventorySet }
}
