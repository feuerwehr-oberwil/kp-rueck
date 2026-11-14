/**
 * The device's own position, once – for «Hier» in «Neuer Einsatz» (LocationInput `locateHere`)
 * and «Standort übernehmen» on /feld (feld-melden-sheet). Both then turn the fix into words with
 * `reverseGeocode` (lib/geocoding.ts): the KP dispatches against a street, not a coordinate.
 *
 * Never rejects: a refusal, no fix or a timeout is a `reason` the caller says in its own words.
 */

/** Why there is no fix. `unsupported` = no geolocation at all (an insecure origin, an old browser). */
export type PositionFailure = 'unsupported' | 'denied' | 'unavailable' | 'timeout'

export type DevicePosition =
  | { ok: true; lat: number; lon: number; /** Radius of the fix, m. */ accuracy: number }
  | { ok: false; reason: PositionFailure }

/** How long one fix may take. The browser's timer does not count an open permission prompt. */
export const FIX_TIMEOUT_MS = 10_000
/** A fix this young is as good as a fresh one – KP Front's «Hier» takes the same. */
export const FIX_MAX_AGE_MS = 30_000

/** The browser's error code as a reason (GeolocationPositionError: 1 denied, 2 unavailable, 3 timeout). */
export function positionFailure(error: Pick<GeolocationPositionError, 'code'>): PositionFailure {
  if (error.code === 1) return 'denied'
  if (error.code === 3) return 'timeout'
  return 'unavailable'
}

/** One high-accuracy fix. `maximumAge` 0 insists on a fresh one. */
export function getDevicePosition(
  { maximumAge = FIX_MAX_AGE_MS }: { maximumAge?: number } = {},
  geolocation: Geolocation | undefined = typeof navigator === 'undefined' ? undefined : navigator.geolocation,
): Promise<DevicePosition> {
  return new Promise((resolve) => {
    if (!geolocation) {
      resolve({ ok: false, reason: 'unsupported' })
      return
    }
    try {
      geolocation.getCurrentPosition(
        ({ coords }) => resolve({ ok: true, lat: coords.latitude, lon: coords.longitude, accuracy: coords.accuracy }),
        (error) => resolve({ ok: false, reason: positionFailure(error) }),
        { enableHighAccuracy: true, timeout: FIX_TIMEOUT_MS, maximumAge },
      )
    } catch {
      // Some WebViews throw instead of calling back.
      resolve({ ok: false, reason: 'unavailable' })
    }
  })
}
