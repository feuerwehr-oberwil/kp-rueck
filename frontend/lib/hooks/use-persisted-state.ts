"use client"

import { useEffect, useState, type Dispatch, type SetStateAction } from "react"
import { readJson, writeJson } from "@/lib/utils/safe-storage"

/**
 * `useState` that remembers its value per device.
 *
 * For layout choices the operator makes with a click — a folded sidebar, a
 * collapsed panel — where re-opening on every navigation is the bug. The value
 * belongs to the SCREEN, not to the Einsatz: the board on the command-post
 * monitor and the laptop in the back legitimately want different widths, so
 * localStorage rather than the synced settings.
 *
 * The stored value is read AFTER mount on purpose — reading it during the first
 * render would make the server and client markup disagree — and written from a
 * single effect. Nothing is written before the read has happened, otherwise the
 * default would overwrite the stored value on every mount.
 *
 * «Has the read happened» is STATE, not a ref, and that is the whole trick.
 * StrictMode runs effects twice; with a ref, the read effect flipped the flag
 * synchronously, the write effect then ran in the SAME flush and persisted the
 * fallback, and StrictMode's second read picked that up — a sidebar you closed
 * came back open on the next reload, in dev only. Routing it through state means
 * the write effect cannot run until a re-render has carried the restored value,
 * so the first thing ever written is the value that was actually read.
 *
 * `isValid` must be stable (a module-level guard); it is a dependency of the
 * read. Reads and writes go through safe-storage, so a corrupt or full store
 * costs the memory of the preference and nothing else.
 */
export function usePersistedState<T>(
  storageKey: string,
  fallback: T,
  isValid: (value: unknown) => value is T,
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(fallback)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    // null means «nothing usable stored» — the fallback stands.
    const stored = readJson(storageKey, isValid, null)
    if (stored !== null) setValue(stored)
    setHydrated(true)
  }, [storageKey, isValid])

  useEffect(() => {
    if (!hydrated) return
    writeJson(storageKey, value)
  }, [hydrated, storageKey, value])

  return [value, setValue]
}
