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
 * **Since sweep 27 §P3.3 a genuine `/feld` tap moves the card itself** (server
 * side, `crud/feld/reports._auto_move`), so for those two cases this nudge
 * self-retires before it is ever seen — the status has already caught up. What
 * keeps asking here is the ambiguous rest: an operator recording «angekommen»
 * or «beendet» off a radio message (they may be logging history, not news), and
 * a GPS arrival in prompt mode. That is the manual path, kept on purpose.
 *
 * The same prompt is rendered in TWO places at once: on the kanban card and in
 * the detail modal's Übersicht, directly above «Status wechseln» — which is the
 * control the question is asking about. Two mounted copies of one question have
 * to answer together, so the dismissal is NOT component state: it is a tiny
 * external store every mounted nudge subscribes to (see below).
 *
 * The timestamps themselves are untouched. `field_arrived_at` and
 * `field_complete_reported_at` keep being written and keep appearing in the
 * Rapport, the Lageblatt and the Ereignisbericht — there they are protocol,
 * not status display.
 */

import { useCallback, useEffect, useSyncExternalStore } from "react"
import { useTranslations } from "next-intl"
import { Radio, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { columns } from "@/lib/kanban-utils"
import { useOperations, type Operation, type OperationStatus } from "@/lib/contexts/operations-context"

export type FieldNudgeKind = "arrived" | "complete"

/** One key for the whole board; the value is a list of `${incidentId}:${kind}`. */
export const FIELD_NUDGE_STORAGE_KEY = "kp-rueck:field-nudge-dismissed"

// The board's own column order is the only ordering of statuses that exists —
// deriving from it means a new column cannot silently desync this predicate.
const STATUS_ORDER: OperationStatus[] = columns.map((column) => column.id)
const ACTIVE_INDEX = STATUS_ORDER.indexOf("active")
const RETURNING_INDEX = STATUS_ORDER.indexOf("returning")

function statusRank(status: OperationStatus): number {
  const index = STATUS_ORDER.indexOf(status)
  // An unknown status must never read as "already past Einsatz".
  return index === -1 ? 0 : index
}

function dismissalKey(incidentId: string, kind: FieldNudgeKind): string {
  return `${incidentId}:${kind}`
}

/* -------------------------------------------------------------------------
 * The shared answer store.
 *
 * Two layers, both shared by every mounted nudge for the same incident:
 *
 *  * `localStorage` holds the DISMISSALS — «I have seen this, stop asking».
 *    They survive a reload, and they are what makes the X on the card and the
 *    X in the modal the same X.
 *  * `confirmed` holds the answers given by MOVING the card. Session-only on
 *    purpose: the move itself retires the condition, and if a completion gate
 *    is cancelled the question is fair again. It is cleared when the last
 *    nudge unmounts, which is exactly the lifetime the old local `useState`
 *    had — only now it is shared while more than one copy is on screen.
 * ---------------------------------------------------------------------- */

const listeners = new Set<() => void>()
const confirmed = new Set<string>()

function emit(): void {
  for (const listener of listeners) listener()
}

function handleStorageEvent(event: StorageEvent): void {
  // `key === null` is a `clear()` in another tab. Either way: re-read.
  if (event.key === null || event.key === FIELD_NUDGE_STORAGE_KEY) emit()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (listeners.size === 1) globalThis.addEventListener?.("storage", handleStorageEvent)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      globalThis.removeEventListener?.("storage", handleStorageEvent)
      confirmed.clear()
    }
  }
}

/** A value React can compare. Recomputed on every read — the lists are a
 *  handful of short strings, and a cache here could only ever go stale. */
function getSnapshot(): string {
  return `${readDismissals().join(",")}|${[...confirmed].join(",")}`
}

/** No localStorage on the server, so nothing is answered there. */
function getServerSnapshot(): string {
  return "|"
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

/** Answered either way — waved away, or answered by moving the card. */
function isAnswered(incidentId: string, kind: FieldNudgeKind): boolean {
  const key = dismissalKey(incidentId, kind)
  return confirmed.has(key) || readDismissals().includes(key)
}

/** Read-modify-write, never a blind overwrite: several cards share one key. */
function storeDismissal(incidentId: string, kind: FieldNudgeKind): void {
  const key = dismissalKey(incidentId, kind)
  const current = readDismissals()
  if (current.includes(key)) return
  writeDismissals([...current, key])
  emit()
}

/**
 * Answered by moving the card — also called from the notification list, where
 * the same question can be answered without ever finding the card. Both paths
 * have to write the same answer or the card would go on asking about a move it
 * has already made.
 */
export function storeFieldNudgeConfirmation(incidentId: string, kind: FieldNudgeKind): void {
  storeConfirmation(incidentId, kind)
}

function storeConfirmation(incidentId: string, kind: FieldNudgeKind): void {
  const key = dismissalKey(incidentId, kind)
  if (confirmed.has(key)) return
  confirmed.add(key)
  emit()
}

function clearAnswer(incidentId: string, kind: FieldNudgeKind): void {
  const key = dismissalKey(incidentId, kind)
  const current = readDismissals()
  const hadDismissal = current.includes(key)
  const hadConfirmation = confirmed.delete(key)
  if (hadDismissal) writeDismissals(current.filter((entry) => entry !== key))
  if (hadDismissal || hadConfirmation) emit()
}

interface FieldStatusNudgeProps {
  operation: Operation
  /** False for viewers — a move whose PATCH would 403 must not be offered. */
  canEdit?: boolean
  /** `card` sits under a divider inside the kanban card; `detail` is the boxed
   *  call to action above «Status wechseln» in the Übersicht tab. Same
   *  question, same answers, two frames. */
  variant?: "card" | "detail"
  className?: string
}

export function FieldStatusNudge({
  operation,
  canEdit = true,
  variant = "card",
  className,
}: FieldStatusNudgeProps) {
  const t = useTranslations("feld.board")
  const { changeStatusToTop } = useOperations()
  // Subscribing is the whole point: an answer given on the card has to repaint
  // the copy in the modal, and the other way round.
  useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  // Answered the moment the card reaches BEENDET / RÜCKFAHRT — that IS the state
  // the field reported, so there is nothing left to ask. A card that has already
  // overtaken it (Abgeschlossen) is past the question too.
  const completeActive =
    Boolean(operation.fieldCompleteReportedAt) && statusRank(operation.status) < RETURNING_INDEX
  // "Not yet in EINSATZ and not already past it" — a card in Rückfahrt or
  // Abgeschlossen has long overtaken the arrival report.
  const arrivedActive = Boolean(operation.fieldArrivedAt) && statusRank(operation.status) < ACTIVE_INDEX

  useEffect(() => {
    // Self-clearing: a nudge whose condition no longer holds drops its stored
    // key, so the list cannot grow for the life of the browser profile.
    if (!arrivedActive) clearAnswer(operation.id, "arrived")
    if (!completeActive) clearAnswer(operation.id, "complete")
  }, [operation.id, arrivedActive, completeActive])

  const dismiss = useCallback((kind: FieldNudgeKind) => {
    storeDismissal(operation.id, kind)
  }, [operation.id])

  // Both answers are the same shape: move the card to the column the field just
  // described, and stop. «Beendet» used to open the whole completion flow —
  // material decisions, gates, a dialog — which asked the operator to finish an
  // incident whose crew is still driving home. Beendet/Rückfahrt IS that state,
  // so the move alone is the honest answer: if the crew turns up, the card is
  // already where it should be, and if they need a lift back, that arrives as an
  // Abholung, not as another prompt about this one.
  // Answering twice is answering once: a second click (a double tap, a copy in
  // the modal pressed after the copy on the card) must not send the card to the
  // top of its column all over again.
  const confirm = useCallback((kind: FieldNudgeKind) => {
    if (isAnswered(operation.id, kind)) return
    storeConfirmation(operation.id, kind)
    changeStatusToTop(operation.id, kind === "complete" ? "returning" : "active")
  }, [changeStatusToTop, operation.id])

  const rows: Array<{ kind: FieldNudgeKind; text: string }> = []
  if (completeActive && !isAnswered(operation.id, "complete")) {
    rows.push({ kind: "complete", text: t("nudgeCompleteText") })
  }
  if (arrivedActive && !isAnswered(operation.id, "arrived")) {
    rows.push({ kind: "arrived", text: t("nudgeArrivedText") })
  }

  if (!canEdit || rows.length === 0) return null

  return (
    <div
      className={cn(
        "space-y-2",
        // The card variant draws no rule of its own: the card reads as three
        // sections (Kopf/Meldung, Ressourcen, Reko) and this nudge belongs to
        // the first one, so it takes that section's plain 12px rhythm. A rule
        // here used to open a fourth section that does not exist.
        variant === "detail" && "rounded-lg border border-primary/25 bg-primary/5 p-3",
        className,
      )}
    >
      {rows.map(({ kind, text }) => (
        // One wrapping row, no breakpoints: this exact markup is rendered in a
        // ~300px kanban column AND in the wide modal, so a `sm:` prefix would
        // be measuring the wrong box. Instead the sentence claims a floor of
        // 11rem and the action group refuses to shrink, so the group drops to
        // its own line whenever the sentence would otherwise be squeezed into
        // a four-word-per-line column. Wide: one line. Narrow: two.
        <div
          key={kind}
          data-testid={`field-nudge-${kind}`}
          className="flex flex-wrap items-center gap-x-2 gap-y-2 text-xs"
        >
          <div className="flex min-w-[11rem] flex-1 items-start gap-2">
            <Radio className="mt-px h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className={cn("min-w-0", variant === "detail" ? "text-foreground" : "text-muted-foreground")}>
              {text}
            </span>
          </div>
          <div className="ml-auto flex flex-shrink-0 items-center gap-1">
            <Button
              type="button"
              size="xs"
              variant="outline"
              onClick={(event) => {
                event.stopPropagation()
                confirm(kind)
              }}
            >
              {t("nudgeConfirm")}
            </Button>
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              title={t("nudgeDismiss")}
              aria-label={t("nudgeDismiss")}
              className="text-muted-foreground/60"
              onClick={(event) => {
                event.stopPropagation()
                dismiss(kind)
              }}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        </div>
      ))}
    </div>
  )
}
