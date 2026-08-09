"use client"

/**
 * FieldStatusNudge — what the field reported, asked as a question.
 *
 * «Angekommen» and «Einsatz beendet» used to sit on the card as permanent
 * badges. That put a second, parallel status display next to the one the board
 * already has: the COLUMNS. A card in EINSATZ that also carries a "beendet"
 * flag is telling the operator two things at once, and the operator has to work
 * out which one counts.
 *
 * So the report stops being a state and becomes a prompt: the field says the
 * crew arrived / finished, and the board asks whether the card should follow.
 * Answer it (move) or wave it away (X) and it is gone for good — the dismissal
 * is remembered per incident and per kind in localStorage, so a reload does not
 * re-ask a question that was already answered.
 *
 * The timestamps themselves are untouched. `field_arrived_at` and
 * `field_complete_reported_at` keep being written and keep appearing in the
 * Rapport, the Lageblatt and the Ereignisbericht — there they are protocol,
 * not status display.
 */

import { useCallback, useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { Radio, X } from "lucide-react"

import { columns } from "@/lib/kanban-utils"
import { useOperations, type Operation, type OperationStatus } from "@/lib/contexts/operations-context"

export type FieldNudgeKind = "arrived" | "complete"

/** One key for the whole board; the value is a list of `${incidentId}:${kind}`. */
export const FIELD_NUDGE_STORAGE_KEY = "kp-rueck:field-nudge-dismissed"

// The board's own column order is the only ordering of statuses that exists —
// deriving from it means a new column cannot silently desync this predicate.
const STATUS_ORDER: OperationStatus[] = columns.map((column) => column.id)
const ACTIVE_INDEX = STATUS_ORDER.indexOf("active")

function statusRank(status: OperationStatus): number {
  const index = STATUS_ORDER.indexOf(status)
  // An unknown status must never read as "already past Einsatz".
  return index === -1 ? 0 : index
}

function dismissalKey(incidentId: string, kind: FieldNudgeKind): string {
  return `${incidentId}:${kind}`
}

/** Every access is guarded: there is no localStorage during SSR, and the
 *  Vitest environment stubs it. A broken store must never break a card. */
function readDismissals(): string[] {
  try {
    const raw = globalThis.localStorage?.getItem(FIELD_NUDGE_STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : []
  } catch {
    return []
  }
}

function writeDismissals(keys: string[]): void {
  try {
    if (keys.length === 0) globalThis.localStorage?.removeItem(FIELD_NUDGE_STORAGE_KEY)
    else globalThis.localStorage?.setItem(FIELD_NUDGE_STORAGE_KEY, JSON.stringify(keys))
  } catch {
    // A full or blocked store costs a re-ask, nothing more.
  }
}

function isDismissed(incidentId: string, kind: FieldNudgeKind): boolean {
  return readDismissals().includes(dismissalKey(incidentId, kind))
}

/** Read-modify-write, never a blind overwrite: several cards share one key. */
function storeDismissal(incidentId: string, kind: FieldNudgeKind): void {
  const key = dismissalKey(incidentId, kind)
  const current = readDismissals()
  if (current.includes(key)) return
  writeDismissals([...current, key])
}

function clearDismissal(incidentId: string, kind: FieldNudgeKind): void {
  const key = dismissalKey(incidentId, kind)
  const current = readDismissals()
  if (!current.includes(key)) return
  writeDismissals(current.filter((entry) => entry !== key))
}

interface FieldStatusNudgeProps {
  operation: Operation
  /** False for viewers — a move whose PATCH would 403 must not be offered. */
  canEdit?: boolean
  /** The shared completion flow (material decision, gates). When absent the
   *  «beendet» nudge stays silent rather than moving the card behind the
   *  operator's back. */
  onRequestComplete?: () => void
}

export function FieldStatusNudge({ operation, canEdit = true, onRequestComplete }: FieldStatusNudgeProps) {
  const t = useTranslations("feld.board")
  const { changeStatusToTop } = useOperations()

  const completeActive = Boolean(operation.fieldCompleteReportedAt) && operation.status !== "complete"
  // "Not yet in EINSATZ and not already past it" — a card in Rückfahrt or
  // Abgeschlossen has long overtaken the arrival report.
  const arrivedActive = Boolean(operation.fieldArrivedAt) && statusRank(operation.status) < ACTIVE_INDEX

  const [hidden, setHidden] = useState<Record<FieldNudgeKind, boolean>>(() => ({
    arrived: isDismissed(operation.id, "arrived"),
    complete: isDismissed(operation.id, "complete"),
  }))

  useEffect(() => {
    // Self-clearing: a nudge whose condition no longer holds drops its stored
    // key, so the list cannot grow for the life of the browser profile.
    if (!arrivedActive) clearDismissal(operation.id, "arrived")
    if (!completeActive) clearDismissal(operation.id, "complete")
    setHidden({
      arrived: arrivedActive && isDismissed(operation.id, "arrived"),
      complete: completeActive && isDismissed(operation.id, "complete"),
    })
  }, [operation.id, arrivedActive, completeActive])

  const dismiss = useCallback((kind: FieldNudgeKind) => {
    storeDismissal(operation.id, kind)
    setHidden((current) => ({ ...current, [kind]: true }))
  }, [operation.id])

  const confirm = useCallback((kind: FieldNudgeKind) => {
    // Hidden locally, not stored: the move itself retires the condition. If a
    // gate is cancelled and the card comes back, the question is fair again.
    setHidden((current) => ({ ...current, [kind]: true }))
    if (kind === "complete") onRequestComplete?.()
    // Moving into `active` passes no gate in useIncidentStatusWorkflow (only
    // enroute/reko/reko_done/returning/complete do), so there is nothing to
    // reuse here — the plain move IS the whole workflow.
    else changeStatusToTop(operation.id, "active")
  }, [changeStatusToTop, onRequestComplete, operation.id])

  const rows: Array<{ kind: FieldNudgeKind; text: string }> = []
  if (completeActive && !hidden.complete && onRequestComplete) {
    rows.push({ kind: "complete", text: t("nudgeCompleteText") })
  }
  if (arrivedActive && !hidden.arrived) {
    rows.push({ kind: "arrived", text: t("nudgeArrivedText") })
  }

  if (!canEdit || rows.length === 0) return null

  return (
    <div className="border-t pt-3 space-y-1.5">
      {rows.map(({ kind, text }) => (
        <div key={kind} data-testid={`field-nudge-${kind}`} className="flex items-center gap-2 text-xs">
          <Radio className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="min-w-0 flex-1 text-muted-foreground">{text}</span>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              confirm(kind)
            }}
            className="flex-shrink-0 rounded-md border border-border px-2 py-0.5 font-medium text-foreground/80 transition-colors hover:bg-muted hover:text-foreground cursor-pointer"
          >
            {t("nudgeConfirm")}
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              dismiss(kind)
            }}
            title={t("nudgeDismiss")}
            aria-label={t("nudgeDismiss")}
            className="flex-shrink-0 rounded-md p-1 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground cursor-pointer"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
    </div>
  )
}
