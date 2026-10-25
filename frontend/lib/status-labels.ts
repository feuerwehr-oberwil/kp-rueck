/**
 * The one place an operation status turns into a word, for callers that are
 * outside React and so cannot use `useTranslations`.
 *
 * This module used to also export `OPERATION_STATUS_LABELS`, a German map that
 * nothing rendered — it existed only so this function could ask `status in
 * OPERATION_STATUS_LABELS`. A table of display strings that is never displayed
 * is a second vocabulary waiting to drift, and it had: it still carried
 * «Beendet / Rückfahrt» after that stage was renamed to «Rückfahrt». Status
 * names live in messages/de.json (`incidents.status.*`) and nowhere else.
 */

import type { OperationStatus } from "@/lib/contexts/operations-context"
import { translateOutsideReact } from "@/lib/i18n-messages"

/** The status keys, as a set. `Record<OperationStatus, true>` keeps it
 *  exhaustive: add a status to the union and this stops compiling. */
const OPERATION_STATUSES: Record<OperationStatus, true> = {
  incoming: true,
  reko: true,
  reko_done: true,
  enroute: true,
  active: true,
  returning: true,
  complete: true,
}

function isOperationStatus(value: string): value is OperationStatus {
  return value in OPERATION_STATUSES
}

export function getOperationStatusLabel(status: string): string {
  return isOperationStatus(status)
    ? translateOutsideReact(`incidents.status.${status}`)
    : status
}
