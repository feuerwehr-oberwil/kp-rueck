"use client"

import { useEffect } from "react"
import { usePathname, useRouter } from "next/navigation"

import { useGPrefixNavigation } from "@/lib/hooks/use-g-prefix-navigation"
import { isOverlayOpen, isTypingTarget } from "@/lib/hooks/use-kanban-shortcuts"
import { openCommandPalette } from "@/components/ui/command-palette"

/**
 * Pages that run their own keydown handler and drive the g-prefix machine from
 * it (their single-letter shortcuts must know whether a key completes a chord:
 * `m` alone is «Material suchen» on the Board, `G M` is the map).
 */
const OWN_HANDLER_ROUTES = ["/", "/map"]

/**
 * Where the global chords stand down entirely:
 * - the public phone forms (`/feld`, `/reko`, `/check-in`, `/alarm`) — a token
 *   holder has no Board or Einstellungen to go to;
 * - the wall displays (`/display/*`) — a stray key must not take a wall screen
 *   off the Lage, and a token viewer could not open the targets anyway;
 * - sign-in and first-time setup, which have nowhere else to go yet.
 */
const EXCLUDED_PREFIXES = ["/feld", "/reko", "/check-in", "/alarm", "/display", "/login", "/auth", "/setup"]

/** True where the mounted-once global listener owns G-chords and `?`. */
export function globalShortcutsEnabled(pathname: string | null): boolean {
  if (!pathname) return false
  if (OWN_HANDLER_ROUTES.includes(pathname)) return false
  return !EXCLUDED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
}

/**
 * The global chords (G B / G K → Board, G M → Karte, G E → Ereignisse, G S →
 * Einstellungen, G H → Hilfe) and `?` for the command palette, on every
 * signed-in page that has no keyboard handler of its own.
 *
 * Mounted ONCE, in the AppShell, instead of per page: it used to be called page
 * by page, so every page that forgot it (Ressourcen, Audit, Import …) simply had
 * no chords — «G+K doesn't work everywhere». The Board and /map keep driving the
 * same state machine from their own handlers (see `OWN_HANDLER_ROUTES`).
 *
 * Same stand-down rules as those handlers: never while typing into a field
 * (`isTypingTarget` — inputs, textareas, selects, contenteditable, comboboxes),
 * never while a modal dialog or a menu owns the keyboard, never on a modifier
 * chord (⌘K and ctrl+G are the browser's / the palette's).
 */
export function useGlobalNavigation() {
  const router = useRouter()
  const pathname = usePathname()
  const gPrefix = useGPrefixNavigation(router, pathname)
  const enabled = globalShortcutsEnabled(pathname)

  useEffect(() => {
    if (!enabled) return
    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        gPrefix.cancel()
        return
      }
      if (isTypingTarget(e.target) || isOverlayOpen()) return
      if (e.metaKey || e.ctrlKey || e.altKey) return

      if (gPrefix.handleKey(e)) return

      if (e.key === "?") {
        e.preventDefault()
        openCommandPalette()
      }
    }

    window.addEventListener("keydown", handleKeyPress)
    return () => window.removeEventListener("keydown", handleKeyPress)
  }, [gPrefix, enabled])
}

/** Renders nothing; the AppShell mounts it once for a signed-in user. */
export function GlobalShortcuts() {
  useGlobalNavigation()
  return null
}
