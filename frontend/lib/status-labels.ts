/**
 * The one place an operation status turns into a word, for callers that are
 * outside React and so cannot use `useTranslations`.
 *
 * This module used to also export `OPERATION_STATUS_LABELS`, a German map that
 * nothing rendered — it existed only so this function could ask `status in
 * OPERATION_STATUS_LABELS`. A table of display strings that is never displayed
 * is a second vocabulary waiting to drift, and it had: it still carried
 * «Beendet / Rückfahrt» after that stage was renamed to «Rückfahrt». Status
 * names live in messages/de.json (`kanban.columns.*`, the board's column titles)
 * and nowhere else.
 */

import { translateOutsideReact } from "@/lib/i18n-messages"
import { isIncidentStatus } from "@/lib/types/incidents"

export function getOperationStatusLabel(status: string): string {
  return isIncidentStatus(status)
    ? translateOutsideReact(`kanban.columns.${status}`)
    : status
}
