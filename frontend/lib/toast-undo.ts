/**
 * The one «Rückgängig» toast.
 *
 * Every undo the operator is offered after their own action goes through `undoToast`:
 * - a bare toast (`unmutedToast`), so it also stands on the quiet surfaces – a phone
 *   mutes `toast.success`, and an undo is not noise but the way back;
 * - the length-based lifetime with the 6 s button floor, scaled by «Anzeigedauer»;
 * - one shot: a second click on the same toast (or ⌘Z after a click) changes nothing;
 * - an optional `key` for a fact that is flipped again and again (a vehicle's driver
 *   «bleibt vor Ort / kehrt zurück», an Einsatz's «Zu Fuss»): the new toast replaces the
 *   standing one with that key instead of stacking, and only its undo stays – the way back
 *   to the state before the LATEST change. Replaced = the old toast dismissed, a new one
 *   shown: sonner's in-place update (same toast id) keeps the old toast's remaining time,
 *   so the newest undo could vanish a second after the click.
 *
 * While it stands it is also the target of ⌘Z / Ctrl+Z (`undoNewest`, bound in the
 * board shortcuts): the newest standing undo runs, as if its button were pressed.
 */
import type { ReactNode } from 'react'
import { toast } from 'sonner'
import { translateOutsideReact } from '@/lib/i18n-messages'
import { unmutedToast } from '@/lib/toast-lifetime'

type ToastId = string | number

/** Standing undos, oldest first. A toast leaves on dismiss, on timeout and once used. */
const standing: Array<{ id: ToastId; key?: string; run: () => void }> = []

function forget(id: ToastId) {
  const index = standing.findIndex((entry) => entry.id === id)
  if (index >= 0) standing.splice(index, 1)
}

export function undoToast(
  message: ReactNode,
  { key, description, onUndo }: { key?: string; description?: ReactNode; onUndo: () => unknown },
): ToastId {
  let used = false
  let id: ToastId = ''
  const run = () => {
    if (used) return
    used = true
    forget(id)
    void onUndo()
  }
  // The replaced toast's undo would go back to a state that is no longer the last one.
  const replaced = key === undefined ? undefined : standing.find((entry) => entry.key === key)
  if (replaced) {
    forget(replaced.id)
    toast.dismiss(replaced.id)
  }
  id = unmutedToast(message, {
    description,
    action: { label: translateOutsideReact('notifications.operations.undoLabel'), onClick: run },
    onDismiss: () => forget(id),
    onAutoClose: () => forget(id),
  })
  standing.push({ id, key, run })
  return id
}

/** ⌘Z: run the newest standing undo and close its toast. False when none stands. */
export function undoNewest(): boolean {
  const newest = standing.at(-1)
  if (!newest) return false
  newest.run()
  toast.dismiss(newest.id)
  return true
}
