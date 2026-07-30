/**
 * Single source of truth for operation-status display labels (audit UI pass).
 *
 * Before this module the mobile cards, detail sheet, filter pills and
 * training controls each carried their own map and drifted ("Unterwegs" vs
 * "Disponiert", two filter pills both called "Beendet"). Labels follow the
 * board column titles, which is the vocabulary operators know.
 */

import type { OperationStatus } from "@/lib/contexts/operations-context"
import { translateOutsideReact } from "@/lib/i18n-messages"

export const OPERATION_STATUS_LABELS: Record<OperationStatus, string> = {
  incoming: "Eingegangen",
  reko: "Reko",
  reko_done: "Reko abgeschlossen",
  enroute: "Disponiert / Anfahrt",
  active: "Einsatz",
  returning: "Beendet / Rückfahrt",
  complete: "Abgeschlossen",
}

// Localized lookup — the const above stays as the key domain (and de fallback).
export function getOperationStatusLabel(status: string): string {
  return status in OPERATION_STATUS_LABELS
    ? translateOutsideReact(`incidents.status.${status}`)
    : status
}
