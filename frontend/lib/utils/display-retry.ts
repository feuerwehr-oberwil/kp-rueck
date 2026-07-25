/**
 * Self-healing reload backoff for unattended screens.
 *
 * Wall displays (`/display/*`) run for hours with nobody at the keyboard, so an
 * error screen whose only recovery is a button press leaves a dead display
 * until someone physically walks over. These helpers back the automatic reload
 * used by both error boundaries that can cover a display:
 *
 * - `components/display-error.tsx` — a throw in the display PAGE
 * - `app/global-error.tsx`         — a throw in the root LAYOUT (providers),
 *                                    which no per-route error.tsx can catch
 *
 * Deliberately dependency-free (no React, no i18n, no design system):
 * global-error.tsx is the boundary of last resort, and whatever crashed the
 * layout may well be a thing those modules depend on.
 *
 * The delay backs off across consecutive failures. A flat retry would hot-loop
 * a genuinely broken deploy and turn every display in the station into a load
 * generator against an already-struggling backend.
 *
 * State lives in sessionStorage because each reload is a fresh document —
 * in-memory state cannot survive to inform the next delay.
 */

export const RETRY_DELAYS_MS = [15_000, 30_000, 60_000]

const ATTEMPT_KEY = 'display-error-attempts'

/**
 * A screen that has stayed up this long counts as recovered, so the next
 * unrelated fault starts its backoff from the beginning instead of inheriting
 * an hours-old attempt count.
 */
export const HEALTHY_UPTIME_MS = 120_000

/** True when the current document is an unattended wall display. */
export function isDisplayRoute(): boolean {
  if (typeof window === 'undefined') return false
  return window.location.pathname.startsWith('/display')
}

export function readRetryAttempts(): number {
  if (typeof window === 'undefined') return 0
  try {
    const raw = sessionStorage.getItem(ATTEMPT_KEY)
    const parsed = raw === null ? 0 : Number.parseInt(raw, 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
  } catch {
    return 0
  }
}

export function writeRetryAttempts(value: number): void {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.setItem(ATTEMPT_KEY, String(value))
  } catch {
    // Storage unavailable — we lose the backoff and retry at the base delay,
    // which still beats not retrying at all.
  }
}

/** Called once a screen has rendered healthily for a while. */
export function clearRetryAttempts(): void {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.removeItem(ATTEMPT_KEY)
  } catch {
    // nothing sensible to do
  }
}

/** Delay to use for the given attempt number, capped at the longest step. */
export function retryDelayFor(attempt: number): number {
  const index = Math.min(Math.max(attempt, 0), RETRY_DELAYS_MS.length - 1)
  return RETRY_DELAYS_MS[index]
}
