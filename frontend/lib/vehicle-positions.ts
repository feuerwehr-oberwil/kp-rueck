import type { ApiVehiclePosition } from '@/lib/api-client'

/**
 * A vehicle or Traccar device name, reduced for matching: lowercase, without
 * whitespace and punctuation – «TLF 1», «TLF-1» and «tlf1» are one truck.
 */
export function normalizeVehicleName(name: string): string {
  return name.toLowerCase().replace(/[\s\-_.]+/g, '')
}

/**
 * The GPS fix of the Traccar device that is this vehicle, if any. Device names
 * are typed by whoever set up the tracker, so three tries, in order:
 * exact (case-insensitive), normalised, then one name containing the other.
 * No match is the normal case for a vehicle without a tracker.
 */
export function findVehiclePosition(
  vehicleName: string,
  positions: readonly ApiVehiclePosition[],
): ApiVehiclePosition | undefined {
  const lower = vehicleName.toLowerCase()
  const target = normalizeVehicleName(vehicleName)
  return (
    positions.find((p) => p.device_name.toLowerCase() === lower) ??
    positions.find((p) => normalizeVehicleName(p.device_name) === target) ??
    positions.find((p) => {
      const device = normalizeVehicleName(p.device_name)
      return device.includes(target) || target.includes(device)
    })
  )
}
