"use client"

import { useCallback, useEffect, useRef, useState } from "react"

export interface GPrefixRouter {
  push: (href: string) => void
}

const PREFIX_TIMEOUT_MS = 1500

/**
 * Maps the second-key after `g` to a destination path.
 * `null` means "consume the prefix but stay" (e.g. G K when already on Kanban).
 */
const G_PREFIX_TARGETS: Record<string, string | null> = {
  k: null, // Kanban — already here
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
 *   G K → already on Kanban (no nav)
 *   G M → /map
 *   G E → /events
 *   G S → /settings
 *   G H → /help
 *
 * The first `G` arms the prefix for 1.5s. Any matching second key navigates
 * and clears it; any other key clears it without navigating. Escape also
 * cancels (handled by the caller, who should call `cancel()`).
 */
export function useGPrefixNavigation(
  router: GPrefixRouter,
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
        if (target) router.push(target)
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
    [isActive, activate, clearTimer, router],
  )

  // Belt-and-suspenders cleanup if the component unmounts mid-prefix.
  useEffect(() => clearTimer, [clearTimer])

  return { isActive, handleKey, cancel }
}
