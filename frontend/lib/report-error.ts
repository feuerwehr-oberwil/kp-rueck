/**
 * Surface uncaught frontend errors to the station's OWN server log.
 *
 * A crash on the board is invisible to whoever runs the server: the error boundaries render a
 * calm fallback, the console message dies with the tab, and nobody hears about it until someone
 * mentions it weeks later. This posts to `/api/diag/client-error`, which logs on the station's
 * own machine — no consent needed and no network beyond the backend the app is already talking
 * to, because this is the app telling its own operator what happened.
 *
 * Whether that report is ALSO forwarded upstream is a separate, opt-in decision made in
 * Einstellungen → Fehlerberichte. Nothing here knows or cares; the server decides.
 *
 * Deliberately not using api-client: that module shows toasts and retries, and a diagnostics
 * path must be silent and must never retry a crash report into a loop. This must NEVER throw —
 * an error reporter that errors is worse than none.
 */

import { getApiUrl } from './env'

const MAX_REPORTS = 20 // per session — a wedged app shouldn't flood the server log
const seen = new Set<string>()
let sent = 0

export type ErrorKind = 'render' | 'error' | 'unhandledrejection'

export function reportClientError(
  err: unknown,
  ctx: { kind?: ErrorKind; componentStack?: string } = {},
): void {
  try {
    if (typeof window === 'undefined' || sent >= MAX_REPORTS) return
    const kind = ctx.kind ?? 'error'
    const message = (err instanceof Error ? err.message : String(err ?? 'unknown')).slice(0, 2000)
    const stack = err instanceof Error ? err.stack?.slice(0, 8000) : undefined
    // Dedupe on kind + message + the stack head, so the same throw firing on every render is
    // logged once rather than a thousand times.
    const key = `${kind}|${message}|${stack?.slice(0, 200) ?? ''}`
    if (seen.has(key)) return
    seen.add(key)
    sent++

    const body = JSON.stringify({
      kind,
      message,
      stack,
      componentStack: ctx.componentStack?.slice(0, 8000),
      path: window.location.pathname.slice(0, 400),
      build: process.env.NEXT_PUBLIC_APP_VERSION ?? 'unknown',
    })

    const url = `${getApiUrl()}/api/diag/client-error`
    // keepalive so the report survives the navigation/reload that usually follows a crash.
    void fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {
      /* offline, or the backend is the thing that's broken — nothing to do here */
    })
  } catch {
    /* diagnostics must never throw */
  }
}

/** Catch what escapes React: async handlers, event listeners, rejected promises. */
export function installGlobalErrorReporting(): void {
  if (typeof window === 'undefined') return
  window.addEventListener('error', (e) =>
    reportClientError(e.error ?? e.message, { kind: 'error' }),
  )
  window.addEventListener('unhandledrejection', (e) =>
    reportClientError(e.reason, { kind: 'unhandledrejection' }),
  )
}
