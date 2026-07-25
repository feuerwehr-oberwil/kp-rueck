/**
 * Crash-safe localStorage helpers.
 *
 * Reads that run during render — provider `useState`/`useRef` initialisers in
 * particular — must never throw. Anything in the root layout sits ABOVE every
 * `error.tsx` boundary, so a single bad value there takes the whole app to the
 * global error screen. Worse, the value is persisted: reloading (and even
 * restarting the browser) reproduces it, so the operator has no way out.
 *
 * A stored value can go bad in ways `try { JSON.parse }` alone doesn't cover:
 * a quota-truncated write leaves invalid JSON, and a key written by an older
 * build (or another tab) can parse fine but hold the wrong SHAPE — `{}` where
 * an array is expected then throws on the first `.filter`. So reads validate
 * the parsed value and fall back rather than trusting the parse.
 *
 * Writes are equally guarded: a full quota makes `setItem` throw, and these
 * writes sit in render paths and effects where that would surface as a crash.
 * Losing a cached preference is always preferable to losing the board.
 */

/**
 * Read a key, parse it as JSON, and validate its shape. Never throws.
 *
 * The fallback is typed separately from the value so callers can pass `null`
 * to distinguish "absent or unusable" from a legitimately empty stored value.
 */
export function readJson<T, F = T>(
  key: string,
  isValid: (value: unknown) => value is T,
  fallback: F
): T | F {
  if (typeof window === 'undefined') return fallback
  let raw: string | null
  try {
    raw = localStorage.getItem(key)
  } catch {
    return fallback // storage disabled by policy / private mode
  }
  if (raw === null) return fallback

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    // Corrupt or truncated. Drop it so the next read starts clean instead of
    // paying the parse cost (and failing) on every single render.
    removeItem(key)
    return fallback
  }

  if (!isValid(parsed)) {
    removeItem(key)
    return fallback
  }
  return parsed
}

/** Serialise and store a value. Returns false if it could not be persisted. */
export function writeJson(key: string, value: unknown): boolean {
  if (typeof window === 'undefined') return false
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false // quota exceeded, storage disabled — non-fatal by design
  }
}

/** Read a raw string. Returns `null` when absent or unreadable. Never throws. */
export function readItem(key: string): string | null {
  if (typeof window === 'undefined') return null
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

/** Store a raw string. Returns false if it could not be persisted. */
export function writeItem(key: string, value: string): boolean {
  if (typeof window === 'undefined') return false
  try {
    localStorage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

/** Remove a key. Never throws. */
export function removeItem(key: string): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(key)
  } catch {
    // nothing sensible to do
  }
}

/** Type guard: an array of strings. */
export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

/** Type guard: a flat object of boolean flags (e.g. checklist overrides). */
export function isBooleanRecord(value: unknown): value is Record<string, boolean> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === 'boolean')
  )
}
