"use client"

import { useEffect } from "react"
import { usePathname, useRouter } from "next/navigation"

import { useGPrefixNavigation } from "@/lib/hooks/use-g-prefix-navigation"

/**
 * Mount-and-forget g-prefix navigation (G B → Board, G M → Karte, G E →
 * Ereignisse, G S → Einstellungen, G H → Hilfe) for pages that have no keydown
 * handler of their own — training, divera-pool, settings, help, events.
 *
 * The state machine lives in {@link useGPrefixNavigation}; this only owns the
 * listener and the guard about when a keystroke is ours to read. A page that
 * already runs its own keydown handler should call the primitive directly
 * instead, so the guards stay in one place per page (see /map and
 * use-kanban-shortcuts).
 */
export function useGlobalNavigation() {
  const router = useRouter()
  const pathname = usePathname()
  const gPrefix = useGPrefixNavigation(router, pathname)

  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      // Not ours while the user is typing or an overlay owns the keyboard.
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target as HTMLElement)?.closest('[role="dialog"]')
      ) {
        return
      }

      if (e.key === "Escape") {
        gPrefix.cancel()
        return
      }

      // A bare modifier chord is the browser's (⌘K, ctrl+G); only the plain key
      // arms or completes the prefix.
      if (e.metaKey || e.ctrlKey || e.altKey) return

      gPrefix.handleKey(e)
    }

    window.addEventListener("keydown", handleKeyPress)
    return () => window.removeEventListener("keydown", handleKeyPress)
  }, [gPrefix])
}
