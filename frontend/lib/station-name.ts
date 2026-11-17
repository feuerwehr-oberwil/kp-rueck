import { useSyncExternalStore } from 'react'

/**
 * The station's name (the Allgemein setting `firestation_name`, «Feuerwehr Oberwil») for the
 * screens that come BEFORE the settings can be read: the boot snail and the login card show
 * «KP RÜCK» and, under it, which station this board is (owner pick XAPP-15 B) – on the
 * standby box as much as on the station PC.
 *
 * The settings need a session, so this device remembers the name from its last board load
 * (`rememberStationName`, called by the board sync). A device that never loaded a board knows
 * no name, and the line stays empty – the name is never guessed, and no public endpoint hands
 * it out.
 */
const STORAGE_KEY = 'kp-rueck-station-name'

const listeners = new Set<() => void>()

function read(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

/** Store the name the board just loaded; a blank name forgets it. */
export function rememberStationName(name: string): void {
  const value = name.trim()
  try {
    if (value === read()) return
    if (value) window.localStorage.setItem(STORAGE_KEY, value)
    else window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    return
  }
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The remembered station name, or null. Null on the server and in the hydrating render. */
export function useStationName(): string | null {
  return useSyncExternalStore(subscribe, read, () => null)
}
