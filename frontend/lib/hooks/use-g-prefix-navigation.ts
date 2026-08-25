"use client"

import { useCallback, useEffect, useRef, useState } from "react"

export interface GPrefixRouter {
  push: (href: string) => void
}

const PREFIX_TIMEOUT_MS = 1500

/**
 * Maps the second key after `g` to its destination path. Every entry is a real
 * path — "already here" is not baked in, it falls out of comparing the target
 * against the caller's `currentPath`, which is why one table serves every page.
 */
export const G_PREFIX_TARGETS: Record<string, string> = {
  b: "/", // Board
  m: "/map",
  e: "/events",
  s: "/settings",
  h: "/help",
}

export interface UseGPrefixNavigation {
  /** True while the prefix is armed and waiting for a second key. */
  isActive: boolean
  /**
   * Process a keydown. Returns true when the event was consumed by the
   * g-prefix machinery (either arming the prefix or completing it),
   * which the caller should treat as a short-circuit.
   */
  handleKey: (event: KeyboardEvent) => boolean
  /** Cancel any armed prefix (used by Escape). Returns true if a prefix was cleared. */
  cancel: () => boolean
}

/**
 * Vim-style "G then X" navigation state machine.
 *
 *   G B → the Board (/)
 *   G M → /map
 *   G E → /events
 *   G S → /settings
 *   G H → /help
 *
 * This is the ONE implementation. Pages that own a keydown handler drive it
 * through `handleKey`/`cancel` (the Board via use-kanban-shortcuts, /map inline);
 * pages that just want the shortcuts mount `useGlobalNavigation`, which wraps
 * this and supplies `currentPath` from the router.
 *
 * The first `G` arms the prefix for 1.5s. Any matching second key navigates
 * and clears it; any other key clears it without navigating. Escape also
 * cancels (handled by the caller, who should call `cancel()`).
 */
export function useGPrefixNavigation(
  router: GPrefixRouter,
  /** The page this hook is mounted on. Its own key consumes the prefix without
   *  navigating — `G B` on the Board should not push a route. Omit it and every
   *  key navigates, which is correct for a page that is not in the table. */
  currentPath?: string,
): UseGPrefixNavigation {
  const [isActive, setIsActive] = useState(false)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)

  const clearTimer = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }, [])

  const cancel = useCallback((): boolean => {
    if (!isActive) return false
    setIsActive(false)
    clearTimer()
    return true
  }, [isActive, clearTimer])

  const activate = useCallback(() => {
    setIsActive(true)
    clearTimer()
    timeoutRef.current = setTimeout(() => {
      setIsActive(false)
      timeoutRef.current = null
    }, PREFIX_TIMEOUT_MS)
  }, [clearTimer])

  const handleKey = useCallback(
    (event: KeyboardEvent): boolean => {
      // Mid-prefix: consume + maybe navigate
      if (isActive) {
        event.preventDefault()
        setIsActive(false)
        clearTimer()
        const target = G_PREFIX_TARGETS[event.key.toLowerCase()]
        if (target && target !== currentPath) router.push(target)
        return true
      }
      // First press: arm prefix
      if (event.key === "g" || event.key === "G") {
        event.preventDefault()
        activate()
        return true
      }
      return false
    },
    [isActive, activate, clearTimer, router, currentPath],
  )

  // Belt-and-suspenders cleanup if the component unmounts mid-prefix.
  useEffect(() => clearTimer, [clearTimer])

  return { isActive, handleKey, cancel }
}
