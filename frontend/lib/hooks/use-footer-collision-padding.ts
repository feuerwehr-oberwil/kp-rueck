'use client'

import { useMemo, useSyncExternalStore } from 'react'

import { EDGE_PADDING, footerCollisionPadding } from '@/lib/utils'

// One shared watcher for every open-able popper on the page. `--nav-reserve`
// lands on `<html>`'s style when the phone nav measures itself, and that can be
// AFTER a menu rendered (sweep VIS.5 / Sol review H: 8px reserved, nav 65px).
const listeners = new Set<() => void>()
let observer: MutationObserver | null = null

const notify = () => {
  for (const listener of listeners) listener()
}

function subscribe(onChange: () => void) {
  listeners.add(onChange)
  if (listeners.size === 1) {
    if (typeof MutationObserver !== 'undefined') {
      observer = new MutationObserver(notify)
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] })
    }
    window.addEventListener('resize', notify)
  }
  return () => {
    listeners.delete(onChange)
    if (listeners.size > 0) return
    observer?.disconnect()
    observer = null
    window.removeEventListener('resize', notify)
  }
}

const getBottom = () => footerCollisionPadding().bottom
const getServerBottom = () => EDGE_PADDING

/**
 * `footerCollisionPadding()` as a live value, for the shared popper wrappers
 * (Popover, Select, DropdownMenu, ContextMenu). Re-renders when the phone nav
 * publishes or changes its height, or the window resizes, so a menu never
 * keeps the padding it read before the nav was measured.
 */
export function useFooterCollisionPadding() {
  const bottom = useSyncExternalStore(subscribe, getBottom, getServerBottom)
  return useMemo(
    () => ({ top: EDGE_PADDING, left: EDGE_PADDING, right: EDGE_PADDING, bottom }),
    [bottom],
  )
}
