import { getApiUrl } from "@/lib/env"

/**
 * URL of a photo uploaded through the Reko form.
 *
 * The endpoint sits behind the login (the images can show a damaged building,
 * a licence plate, people), so this only resolves for an authenticated session —
 * the share-token views never get photo filenames in the first place.
 */
export function rekoPhotoUrl(incidentId: string, filename: string): string {
  return `${getApiUrl()}/api/photos/${incidentId}/${encodeURIComponent(filename)}`
}
