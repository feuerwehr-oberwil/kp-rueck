/**
 * The three lists of the Bereitschaft page (`/display/bereitschaft`) – what a crew waiting at
 * the station asks, in that order: what is ready to go, what else is waiting, who is out.
 *
 * - `ready`: Reko abgeschlossen – the Reko already says how many people it takes (owner pick 1A).
 * - `waiting`: Eingegangen and Reko.
 * - `out`: Im Einsatz, then Disponiert / Anfahrt, then Rückfahrt.
 *
 * Inside a list: Hoch → Mittel → Niedrig, then the oldest first – by the instant the row's own
 * time chip measures from (`incidentTimeReference`), so the order never contradicts the number
 * beside it – then the id, so equal rows keep their place between polls. Abgeschlossen is in
 * none of them.
 */

import { incidentTimeReference, type IncidentTimeMode } from './incident-time'
import type { Operation, OperationStatus } from './contexts/operations-context'

const PRIORITY_RANK: Record<Operation['priority'], number> = { high: 0, medium: 1, low: 2 }
const OUT_RANK: Partial<Record<OperationStatus, number>> = { active: 0, enroute: 1, returning: 2 }

export interface StandbyLists {
  ready: Operation[]
  waiting: Operation[]
  out: Operation[]
}

export function standbyLists(operations: readonly Operation[], mode: IncidentTimeMode): StandbyLists {
  const since = (op: Operation) => incidentTimeReference(op, mode).getTime()
  const byUrgency = (a: Operation, b: Operation) =>
    PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || since(a) - since(b) || a.id.localeCompare(b.id)
  const pick = (...statuses: OperationStatus[]) => operations.filter((op) => statuses.includes(op.status))
  return {
    ready: pick('reko_done').sort(byUrgency),
    waiting: pick('incoming', 'reko').sort(byUrgency),
    out: pick('active', 'enroute', 'returning').sort(
      (a, b) => (OUT_RANK[a.status] ?? 0) - (OUT_RANK[b.status] ?? 0) || byUrgency(a, b),
    ),
  }
}
