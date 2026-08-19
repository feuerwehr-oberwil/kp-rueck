import { columns } from '@/lib/kanban-utils'
import type { Notification, NotificationType } from '@/lib/types/notification'
import type { IncidentStatus } from '@/lib/types/incidents'

/**
 * How loudly a notification is allowed to interrupt the operator.
 *
 * Severity alone was the whole policy until `/feld` (plan 25) arrived: five new
 * types that are all `info` except one, which would have made "Angekommen" and
 * "Rapport erfasst" shout exactly as loudly as a depleted material. Severity
 * still decides how a notification *looks*; this decides whether it earns the
 * screen.
 *
 * - `urgent`  — always toasted, never collapsed into the overflow summary.
 * - `normal`  — toasted while there is room in the burst budget.
 * - `quiet`   — bell and sidebar only. Never a toast.
 */
export type ToastPolicy = 'urgent' | 'normal' | 'quiet'

/**
 * Per-type overrides. Anything not listed falls back to its severity.
 *
 * The field pair that is urgent is the pair a crew cannot resolve by itself: a
 * crew waiting to be collected, and a free-text Meldung somebody typed on a
 * phone in the rain — both are addressed *at* the KP and expect an answer.
 */
const TYPE_POLICY: Partial<Record<NotificationType, ToastPolicy>> = {
  field_pickup: 'urgent',
  field_message: 'urgent',
  // A Schadenplatz that did not exist a second ago. Nothing else on the board
  // announces it — the card just appears in a column, and a taken-over one does
  // not even appear there.
  field_report: 'urgent',
  rapport_submitted: 'normal',
  field_complete: 'normal',
  // Was 'quiet' while an arrival changed nothing on the board. Since the
  // auto-move (sweep 27 §P3.3) a field «Angekommen» MOVES the card to EINSATZ,
  // and the toast is the announcement of that move — the message itself says
  // «Karte in „Einsatz" verschoben».
  field_arrived: 'normal',
  // Reko: «vor Ort» and the filed Bericht are worth a toast while there is
  // room, but neither demands an answer from the KP the way a pickup does.
  // Listed explicitly so the pair no longer rides on the severity fallback.
  reko_arrived: 'normal',
  reko_submitted: 'normal',
}

export function toastPolicyFor(notification: Pick<Notification, 'type' | 'severity'>): ToastPolicy {
  const override = TYPE_POLICY[notification.type]
  if (override) return override
  return notification.severity === 'critical' || notification.severity === 'warning' ? 'urgent' : 'normal'
}

/**
 * How many toasts one burst may put on screen before the rest collapses into a
 * single "+N weitere" summary.
 *
 * Three, because the stack sits above the footer and a fourth one starts
 * climbing into the board. Urgent notifications are exempt — the cap exists to
 * stop twenty `time_overdue` warnings from burying one Abholung, not to hide
 * the Abholung.
 */
export const TOAST_BURST_LIMIT = 3

export interface ToastPlan {
  /** Toasted individually, oldest first — the order they happened in. */
  toast: Notification[]
  /** Not toasted individually; summarised as "+N weitere" (0 = no summary). */
  overflow: Notification[]
  /** Bell/sidebar only — no toast, no summary. */
  quiet: Notification[]
}

/**
 * Decide what a batch of newly-arrived notifications does to the screen.
 *
 * Pure on purpose: the burst behaviour is the part that was wrong (twenty
 * toasts, newest-first, sliding over one another) and it is the part worth
 * testing without a DOM.
 *
 * Ordering is oldest-first. The API returns `created_at DESC`, and firing the
 * toasts in that order made a burst read backwards *and* put the oldest event
 * on top of the stack.
 */
export function planToastBurst(
  notifications: Notification[],
  limit: number = TOAST_BURST_LIMIT
): ToastPlan {
  const ordered = [...notifications].sort((a, b) => {
    const byTime = a.created_at.getTime() - b.created_at.getTime()
    // Same-millisecond ties (a seeded event, a bulk evaluation) must still have
    // ONE order, or two renders disagree about which toast is on top.
    return byTime !== 0 ? byTime : a.id.localeCompare(b.id)
  })

  const quiet: Notification[] = []
  const urgent: Notification[] = []
  const normal: Notification[] = []

  for (const notification of ordered) {
    const policy = toastPolicyFor(notification)
    if (policy === 'quiet') quiet.push(notification)
    else if (policy === 'urgent') urgent.push(notification)
    else normal.push(notification)
  }

  // Urgent first come, urgent first served: they take the budget, and if they
  // alone exceed it they still all show. A dropped Abholung is the bug.
  //
  // The "+N weitere" summary occupies a slot of its own, so it is subtracted
  // from the budget whenever it will be needed — otherwise the cap that exists
  // to keep the stack short is quietly one taller than it claims.
  const budget = Math.max(0, limit - urgent.length)
  const room = normal.length > budget ? Math.max(0, budget - 1) : budget
  const toast = [...urgent, ...normal.slice(0, room)].sort((a, b) => {
    const byTime = a.created_at.getTime() - b.created_at.getTime()
    return byTime !== 0 ? byTime : a.id.localeCompare(b.id)
  })

  return { toast, overflow: normal.slice(room), quiet }
}

/** The one board order, shared with `notification-field-action.ts`. */
const STATUS_ORDER: IncidentStatus[] = columns.map((column) => column.id)

function statusRank(status: IncidentStatus): number {
  const index = STATUS_ORDER.indexOf(status)
  return index === -1 ? 0 : index
}

/** The slice of an Operation the supersede check reads. */
export interface SupersedeOperation {
  id: string
  status: IncidentStatus
  assignedReko?: { id: string; name: string } | null
}

/**
 * "New emergency" notifications the KP has visibly overtaken.
 *
 * A `field_report` announces a Schadenplatz that just appeared on the board.
 * Once its incident has moved on — a Reko assigned, disponiert, anything past
 * the column it was announced in — the KP has plainly seen it, and the pending
 * toast / unread row is stale noise. Returns the ids to dismiss.
 *
 * Two birth columns, told apart by severity (the shape they are created with
 * in `crud/feld/melden.py`): a plain Meldung (`info`) is born in EINGEGANGEN,
 * a taken-over one («Trupp fährt direkt hin», `warning`) is born already in
 * DISPONIERT — silencing that one at `enroute` would swallow the exact warning
 * it exists for, so it only counts as overtaken beyond it.
 *
 * An incident the board does not know is left alone: during load the
 * operations list is briefly empty, and "not loaded yet" must not read as
 * "already handled".
 */
export function supersededNewIncidentNotifications(
  notifications: Pick<Notification, 'id' | 'type' | 'severity' | 'incident_id' | 'dismissed'>[],
  operations: SupersedeOperation[]
): string[] {
  const operationsById = new Map(operations.map((operation) => [operation.id, operation]))

  return notifications
    .filter((notification) => {
      if (notification.type !== 'field_report' || notification.dismissed || !notification.incident_id) {
        return false
      }
      const operation = operationsById.get(notification.incident_id)
      if (!operation) return false

      const bornIn: IncidentStatus = notification.severity === 'warning' ? 'enroute' : 'incoming'
      if (statusRank(operation.status) > statusRank(bornIn)) return true
      // A Reko assigned while the card still sits in EINGEGANGEN is a KP action too.
      return bornIn === 'incoming' && operation.assignedReko != null
    })
    .map((notification) => notification.id)
}
