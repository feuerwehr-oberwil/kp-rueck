"use client"

import { useCallback, useEffect, useState } from "react"
import { isStringArray, readJson, writeJson } from "@/lib/utils/safe-storage"

/**
 * Which sections of a display are folded away, remembered per device.
 *
 * A wall screen, the tablet on the desk and a laptop in the back all show the
 * same event but sit at different distances, so how much of it is folded away is
 * a property of the screen, not of the Einsatz — hence localStorage rather than
 * the synced workspace (same place the other Anzeige-Einstellungen live).
 *
 * Everything starts OPEN except what the caller names in `defaultCollapsed`.
 * Collapsing is hiding, and at 3am nothing important may hide by itself; the one
 * exception is ABGESCHLOSSEN, which is finished work by definition.
 *
 * The stored set is read AFTER mount on purpose: reading localStorage during the
 * first render would make the server and client markup disagree. Reads and
 * writes go through safe-storage, so a corrupt or full store costs the memory of
 * the fold and nothing else.
 */
export function useCollapsedSections(storageKey: string, defaultCollapsed: readonly string[] = []) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(defaultCollapsed))

  useEffect(() => {
    // null means «nothing usable stored» — the defaults stand. An empty array is
    // a real answer (everything deliberately open) and must not be confused with it.
    const stored = readJson(storageKey, isStringArray, null)
    if (stored) setCollapsed(new Set(stored))
  }, [storageKey])

  const toggle = useCallback(
    (id: string) => {
      setCollapsed((previous) => {
        const next = new Set(previous)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        // A failed write only costs the memory of the fold, never the fold itself.
        writeJson(storageKey, [...next])
        return next
      })
    },
    [storageKey],
  )

  const isCollapsed = useCallback((id: string) => collapsed.has(id), [collapsed])

  return { isCollapsed, toggle }
}
