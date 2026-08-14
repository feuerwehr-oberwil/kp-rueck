import { apiClient } from "@/lib/api-client"

/** The per-event export formats the board offers: after-action report, paper
 *  fallback Lageblatt, and the audit trail. */
export type EventExportKind = "report" | "lageblatt" | "audit"

/** Mirrors the backend slug: lowercase, umlauts transliterated, everything else "-". */
function slugifyEventName(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/ä/g, "ae")
      .replace(/ö/g, "oe")
      .replace(/ü/g, "ue")
      .replace(/ß/g, "ss")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "ereignis"
  )
}

/**
 * Fetches one per-event export and saves it to this device.
 *
 * Throws on failure so the caller can toast in its own words; the filename is
 * built here because the backend does not send a Content-Disposition.
 */
export async function downloadEventExport(
  eventId: string,
  eventName: string,
  kind: EventExportKind,
): Promise<void> {
  const blob =
    kind === "report"
      ? await apiClient.exportEventReport(eventId)
      : kind === "lageblatt"
        ? await apiClient.exportEventLageblatt(eventId)
        : await apiClient.exportEventAudit(eventId)

  const slug = slugifyEventName(eventName)
  const now = new Date()
  const date = now.toISOString().slice(0, 10)
  const time = now.toTimeString().slice(0, 5).replace(":", "")
  const filename =
    kind === "report"
      ? `einsatzbericht-${slug}-${date}.pdf`
      : kind === "lageblatt"
        ? `lageblatt-${slug}-${date}-${time}.pdf`
        : `audit-${slug}-${date}.xlsx`

  const url = window.URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  window.URL.revokeObjectURL(url)
  document.body.removeChild(anchor)
}
