/**
 * The one «Rückgängig» toast.
 *
 * Every undo the operator is offered after their own action goes through `undoToast`:
 * - a bare toast (`unmutedToast`), so it also stands on the quiet surfaces – a phone
 *   mutes `toast.success`, and an undo is not noise but the way back;
 * - the length-based lifetime with the 6 s button floor, scaled by «Anzeigedauer»;
 * - one shot: a second click on the same toast (or ⌘Z after a click) changes nothing.
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
const standing: Array<{ id: ToastId; run: () => void }> = []

function forget(id: ToastId) {
  const index = standing.findIndex((entry) => entry.id === id)
  if (index >= 0) standing.splice(index, 1)
}

export function undoToast(
  message: ReactNode,
  { description, onUndo }: { description?: ReactNode; onUndo: () => unknown },
): ToastId {
  let used = false
  let id: ToastId = ''
  const run = () => {
    if (used) return
    used = true
    forget(id)
    void onUndo()
  }
  id = unmutedToast(message, {
    description,
    action: { label: translateOutsideReact('notifications.operations.undoLabel'), onClick: run },
    onDismiss: () => forget(id),
    onAutoClose: () => forget(id),
  })
  standing.push({ id, run })
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
