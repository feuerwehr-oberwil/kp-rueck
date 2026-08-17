/**
 * "Take me there" — turning a Schadenplatz into a route in the phone's own maps app.
 *
 * The field surface is read standing next to a vehicle, and the next thing that
 * happens is somebody drives. Until now the address was text to be re-typed into
 * another app one-handed, which is both slow and the easiest place in the whole
 * night to fat-finger a street name.
 *
 * **Coordinates win when we have them.** An address is what the KP dispatched
 * against and it is what a human reads, but it is also what a geocoder has to
 * guess at — and the one place that matters is a field track with no house
 * number, which is exactly where a storm sends people. `location_lat/lng` came
 * from a map pin or the reporter's own GPS, so it is the better destination
 * whenever it exists; the address is the fallback and is fine for a street.
 *
 * **One URL for both platforms.** `https://www.google.com/maps/dir/?api=1` is
 * handed to the OS, which opens Google Maps on Android and, on iOS, whatever the
 * user has — Apple Maps included — rather than a browser tab. A `maps://` scheme
 * would pin iOS to Apple Maps and do nothing at all on a desktop, and the board's
 * own operators open `/feld` on a laptop often enough to matter.
 */

/** Enough of a Schadenplatz to drive to it. Mirrors the fields on `ApiFeldAssignment`. */
export interface NavigationTarget {
  location_address?: string | null
  location_lat?: string | null
  location_lng?: string | null
}

/**
 * A maps URL for this place, or `null` when there is nothing to navigate to.
 *
 * Null rather than a link to nowhere: a Schadenplatz can legitimately have
 * neither (a crew reported "Sammelplatz Turnhalle" by radio and the KP typed the
 * title only), and a tappable address that opens an empty map is worse than
 * plain text.
 */
export function navigationUrl(target: NavigationTarget): string | null {
  const lat = Number(target.location_lat)
  const lng = Number(target.location_lng)
  const hasCoordinates =
    target.location_lat != null &&
    target.location_lng != null &&
    Number.isFinite(lat) &&
    Number.isFinite(lng)

  const destination = hasCoordinates ? `${lat},${lng}` : (target.location_address?.trim() ?? '')
  if (!destination) return null

  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`
}
