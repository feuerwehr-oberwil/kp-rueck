/**
 * The resource sidebars' pure half: what a binding is, which one a click goes
 * to, and how a depot folds identical devices into one counted row.
 *
 * Moved out of `app/page.tsx` verbatim (2026-09-23) so it can be tested without
 * mounting the board; the rows that render these still live with the board.
 */

import type { Material } from "@/lib/contexts/operations-context"

/**
 * One place a resource is held right now.
 *
 * The board asked this question with `operations.find(...)` — the FIRST hit —
 * which meant a person on two Schadenplätze could never be followed to the
 * second one, and a Magaziner or Telefondienst (bound, but on no incident at
 * all) produced a click that did nothing whatsoever.
 */
export interface ResourceBinding {
  key: string
  /** 'incident' scrolls to a card, 'route' opens the Auftrag sheet,
   *  'function' has nowhere to go and says so. */
  kind: "incident" | "route" | "function"
  /** Incident id, Auftrag id, or null for a station function. */
  targetId: string | null
  label: string
  /** Second line — the Auftrag a stop belongs to, or «Sonderfunktion · kein Einsatz». */
  detail: string
}

/** What the bindings popover is currently answering for. */
export interface BindingsPopoverState {
  kind: "person" | "material"
  id: string
  title: string
  subtitle: string
  bindings: ResourceBinding[]
}

/** Can this binding actually be followed? A station function has nowhere to go,
 *  and neither has anything that lost its target. */
export const isNavigableBinding = (binding: ResourceBinding): boolean =>
  binding.kind !== 'function' && !!binding.targetId

/**
 * The one place this resource can be opened, or null when there is a choice to
 * make (or nothing to open).
 *
 * A picker over a list of one is a click spent on confirming what the board
 * already knew. The person row used to shortcut only when that one binding was
 * an INCIDENT, so somebody on a single Auftrag — the most ordinary state on a
 * storm board — got a popover offering exactly one destination. Kind does not
 * matter: one reachable place means go there.
 */
export const soleDestination = (bindings: ResourceBinding[]): ResourceBinding | null => {
  const reachable = bindings.filter(isNavigableBinding)
  return reachable.length === 1 && bindings.length === 1 ? reachable[0] : null
}

/** "19.08." — the stamp on «seit …», the same one the Materialverwaltung uses. */
export function shortDate(value: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}.`
}

/**
 * Fold a depot's ready devices into bundles of identical units, order
 * preserved by first appearance. Keyed by NAME — two devices that cannot be
 * told apart on the shelf cannot be told apart on the board. Consumables stay
 * single: their row already says «stock», and folding a Schlauch into a
 * counted bundle would double-count what `consumable` already models.
 */
export function aggregateByName(items: Material[]): Material[][] {
  const order: Material[][] = []
  const byName = new Map<string, Material[]>()
  for (const item of items) {
    if (item.consumable) {
      order.push([item])
      continue
    }
    const existing = byName.get(item.name)
    if (existing) {
      existing.push(item)
    } else {
      const bundle = [item]
      byName.set(item.name, bundle)
      order.push(bundle)
    }
  }
  return order
}
