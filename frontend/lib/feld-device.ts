const STORAGE_KEY = 'kp-feld-device'

/**
 * A random id this phone keeps for the Feld door, sent with every Feld-Code try so the
 * backend counts wrong codes per phone as well as per address (`crud/feld/access.py`).
 * Not a credential – a phone without one is still counted by its address. Undefined where
 * the browser has no storage or no `crypto.randomUUID` (a plain-http address on the LAN).
 */
export function feldDeviceId(): string | undefined {
  try {
    const kept = localStorage.getItem(STORAGE_KEY)
    if (kept) return kept
    const id = crypto.randomUUID()
    localStorage.setItem(STORAGE_KEY, id)
    return id
  } catch {
    return undefined
  }
}
