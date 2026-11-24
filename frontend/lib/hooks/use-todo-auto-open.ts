'use client'

import { useEffect, useRef } from 'react'

/**
 * The desktop rail opens itself on a NEW to-do and closes again once the to-do list is empty –
 * but only if it was the one that opened it (owner pick C, bell round 24.11.2026). An operator
 * who opened the rail by hand keeps it; one who closes it keeps it closed until the next new to-do.
 *
 * `ids`: the open to-dos' ids. `enabled`: desktop editor (the phone has no rail).
 */
export function useTodoAutoOpen(
  ids: readonly string[],
  enabled: boolean,
  { open, close }: { open: () => void; close: () => void },
): void {
  const seen = useRef<Set<string> | null>(null)
  const openedByUs = useRef(false)
  const key = ids.join('|')

  useEffect(() => {
    if (!enabled) return
    const current = new Set(key ? key.split('|') : [])
    // The first list after load counts as new too: a to-do waiting since before the reload
    // has not been seen on this screen.
    const fresh = [...current].some((id) => !seen.current?.has(id))
    seen.current = current
    if (fresh) {
      open()
      openedByUs.current = true
    } else if (current.size === 0 && openedByUs.current) {
      close()
      openedByUs.current = false
    }
  }, [key, enabled, open, close])
}
