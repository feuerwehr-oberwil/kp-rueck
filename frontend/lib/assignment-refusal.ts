import { ApiError } from "@/lib/api-client"
import { translateOutsideReact } from "@/lib/i18n-messages"

/**
 * Why the server refused an assignment, in its own words.
 *
 * A 409 on an assign used to mean one thing — somebody else was faster — and
 * the board said so in its own sentence. Now the server also refuses for
 * reasons the operator must read (archived resource, «nicht einsatzbereit», an
 * archived Ereignis, a closed Einsatz) and puts the reason in `detail`. The two
 * generic details (`ErrorMessages.CONFLICT` / `RESOURCE_ALREADY_ASSIGNED` in
 * backend/app/utils/errors.py) and a 409 without any detail stay a race.
 */
const RACE_DETAILS = new Set(["Konflikt bei der Verarbeitung", "Ressource bereits zugewiesen"])

/** The server's reason for a 409 refusal, or null for a race / any other failure. */
export function refusalReason(error: unknown): string | null {
  if (!ApiError.isConflictError(error)) return null
  const text = error.message.trim()
  // No JSON detail: the client falls back to «409 Conflict».
  if (!text || RACE_DETAILS.has(text) || /^409\b/.test(text)) return null
  return text
}

/** The toast description for a failed incident assign of `name`. */
export function assignFailureDescription(error: unknown, name: string): string {
  return (
    refusalReason(error) ??
    (ApiError.isConflictError(error)
      ? translateOutsideReact("notifications.operations.assignConflictDescription", { name })
      : translateOutsideReact("notifications.operations.assignFailedDescription", { name }))
  )
}
