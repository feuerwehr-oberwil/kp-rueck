/**
 * One place that turns a written phone number into something a device can dial.
 *
 * Numbers arrive as people type them: «061 401 12 34», «+41 61 401 12 34»,
 * «079 123 45 67 (Nachbar)». Three call sites each had their own sanitiser and two of them
 * only stripped whitespace, so a note in brackets travelled straight into the href and the
 * link silently did nothing.
 *
 * Keeps digits and a leading «+» — everything else (spaces, slashes, dots, notes) is display
 * only. Returns null when nothing dialable is left, so callers render plain text instead of a
 * dead link.
 */
export function telHref(raw: string | null | undefined): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  const plus = trimmed.startsWith("+") ? "+" : ""
  const digits = trimmed.replace(/\D/g, "")
  if (digits.length < 3) return null // not a number, just a note
  return `tel:${plus}${digits}`
}
