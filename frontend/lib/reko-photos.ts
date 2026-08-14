import { getApiUrl } from "@/lib/env"

/**
 * URL of a photo uploaded through the Reko form.
 *
 * Two callers, two credentials. A logged-in board sends the session cookie and
 * passes no token. A share-token display has no cookie, so it appends its own
 * viewer token — the endpoint takes it as a second door, scoped to that token's
 * event and to files a submitted Reko report lists (backend `serve_photo`).
 * Without the token the `<img>` would answer 401 and the display would draw a
 * broken-image icon where the picture of the damage should be.
 */
export function rekoPhotoUrl(incidentId: string, filename: string, viewerToken?: string): string {
  const base = `${getApiUrl()}/api/photos/${incidentId}/${encodeURIComponent(filename)}`
  return viewerToken ? `${base}?token=${encodeURIComponent(viewerToken)}` : base
}
