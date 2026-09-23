/**
 * The transport under `apiClient`: one `request()` with timeout, retry and
 * backoff, the error toasts and the session-expiry signal, and the tab-wide
 * REST reachability the stale-data banner listens to.
 *
 * Moved out of `lib/api-client.ts` verbatim (2026-09-23). The module-level
 * state below exists ONCE per tab — `api-client` delegates here and
 * re-exports `getRestReachable` / `onRestReachableChange`, so nothing may
 * keep a second copy of it.
 */

import { getApiUrl } from '../env'
import { toast } from 'sonner'
import { translateOutsideReact } from '../i18n-messages'
import { ApiError, NetworkError } from './types'

/**
 * Hard ceiling on a single request. Generous on purpose: a command post on a saturated
 * uplink is slow but still worth waiting for, and cutting off a real response is worse
 * than waiting. This exists to bound a connection that will never answer at all, not to
 * enforce latency.
 */
export const REQUEST_TIMEOUT_MS = 20_000

/**
 * Ceiling for ONE photo upload attempt.
 *
 * Longer than a normal request because a photo is megabytes over LTE, and the
 * caller retries: a phone that lost the network mid-picture gets another go
 * rather than a lost photo. The pictures are downscaled to ~1920 px before they
 * get here (`components/reko/photo-upload.tsx`), which is what makes a minute
 * generous rather than tight.
 */
export const PHOTO_UPLOAD_TIMEOUT_MS = 60_000

// ── REST connectivity (module-level, one per tab) ────────────────────────────
// Mirrors the notification-context outage pattern: ONE persistent toast per
// outage (fixed id, Infinity duration) instead of a new "Verbindungsfehler"
// toast per failed poll, dismissed by the first request that gets through
// again. Consumers (the stale-data banner) subscribe so a REST outage raises
// the permanent band even while the WebSocket still claims to be connected.
const CONNECTION_TOAST_ID = 'api-connection-lost'
let restReachable = true
let outageToastVisible = false
const restListeners = new Set<(reachable: boolean) => void>()

/** Last known REST reachability: false after a request exhausted its retries
 *  on a network-layer failure, true again once any request is answered. */
export function getRestReachable(): boolean {
  return restReachable
}

/** Subscribe to reachability transitions. Returns an unsubscribe function. */
export function onRestReachableChange(listener: (reachable: boolean) => void): () => void {
  restListeners.add(listener)
  return () => {
    restListeners.delete(listener)
  }
}

function setRestReachable(reachable: boolean) {
  if (restReachable === reachable) return
  restReachable = reachable
  restListeners.forEach((listener) => listener(reachable))
}

/** A request exhausted its retries on a network-layer failure. */
export function markRestUnreachable(skipToast: boolean) {
  setRestReachable(false)
  if (!skipToast && !outageToastVisible) {
    outageToastVisible = true
    toast.error(translateOutsideReact('errors.api.connectionTitle'), {
      id: CONNECTION_TOAST_ID,
      description: translateOutsideReact('errors.api.connectionDescription'),
      duration: Infinity,
    })
  }
}

/** A request was answered (any status code): the server is reachable again. */
export function markRestReachable() {
  setRestReachable(true)
  if (outageToastVisible) {
    outageToastVisible = false
    toast.dismiss(CONNECTION_TOAST_ID)
  }
}

/** What `request()` accepts on top of `fetch`'s own options. */
export type RequestOptions = RequestInit & { skipToast?: boolean; maxRetries?: number; onHeaders?: (headers: Headers) => void }

/**
 * Sleep function for retry delays
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Calculate exponential backoff delay
 */
function getBackoffDelay(retryCount: number): number {
  // Exponential backoff: 1s, 2s, 4s, 8s, max 16s
  const baseDelay = 1000
  const maxDelay = 16000
  const delay = Math.min(baseDelay * Math.pow(2, retryCount), maxDelay)
  // Add jitter (±20%) to prevent thundering herd
  const jitter = delay * 0.2 * (Math.random() - 0.5)
  return Math.round(delay + jitter)
}

/**
 * Main request method with retry logic and error notifications
 */
export async function request<T>(endpoint: string, options?: RequestOptions): Promise<T> {
  // Always resolved per request, so the browser picks up the runtime URL.
  const baseUrl = getApiUrl()
  const url = `${baseUrl}${endpoint}`
  const method = options?.method || 'GET'
  const isGetRequest = method === 'GET'
  const skipToast = options?.skipToast || false
  const maxRetries = options?.maxRetries ?? (isGetRequest ? 3 : 1) // Retry GET requests by default, not mutations


  let lastError: Error | null = null

  for (let retryCount = 0; retryCount <= maxRetries; retryCount++) {
    try {
      const response = await fetch(url, {
        ...options,
        credentials: 'include', // Send cookies for authentication
        // Without this a request could hang indefinitely – a dead-but-open TCP connection
        // never rejects on its own. One hung GET was enough to wedge the polling loop for
        // good: `startPolling()` cannot re-arm while `isPollingActive` is still true, and
        // only a WebSocket 'connected' transition resets it. The board then sat there
        // quietly not updating. Callers may override for genuinely slow routes (exports,
        // PDF generation) by passing their own signal.
        signal: options?.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: {
          'Content-Type': 'application/json',
          ...options?.headers,
        },
      })

      // The server answered (any status): the connection works. Clears the
      // outage toast/state the moment the first request gets through again.
      markRestReachable()

      if (!response.ok) {
        let errorText = ''
        try {
          errorText = await response.text()
        } catch {
          errorText = translateOutsideReact('errors.api.noErrorDetails')
        }

        // Don't log 401 errors for sync config - expected when not authenticated
        const shouldLog = !(response.status === 401 && endpoint === '/api/sync/config')
        if (shouldLog) {
          // Use console.warn to avoid triggering Next.js error overlay
          console.warn(`[API Error] ${method} ${endpoint}: ${response.status} ${response.statusText}`, errorText)
        }

        // Don't throw error for 401 on sync config - it's handled gracefully by the component
        if (response.status === 401 && endpoint === '/api/sync/config') {
          throw new Error('Unauthorized') // Silent error that will be caught
        }

        // Try to parse as JSON for better error messages
        let errorMessage = `${response.status} ${response.statusText}`
        try {
          const errorJson = JSON.parse(errorText)
          if (errorJson.detail) {
            errorMessage = errorJson.detail
          }
        } catch {
          // Not JSON, use text error if available
          if (errorText && errorText.length < 200) {
            errorMessage = errorText
          }
        }

        // Determine if we should retry based on status code
        const isRetryable = response.status >= 500 || response.status === 429 || response.status === 408

        if (isRetryable && retryCount < maxRetries) {
          const delay = getBackoffDelay(retryCount)
          await sleep(delay)
          continue // Retry
        }

        // Final error - create ApiError with status code for proper error handling
        const isConflict = response.status === 409
        const error = new ApiError(errorMessage, response.status, isConflict)

        // A 401 means the session is gone (auth endpoints don't go through
        // this client). Tell the auth layer so it can clear the user and
        // show "Sitzung abgelaufen" – without this, every mutation after
        // token expiry fails silently and optimistic UI just reverts.
        if (response.status === 401 && typeof window !== 'undefined') {
          window.dispatchEvent(new Event('kp:session-expired'))
        }

        // Don't show toast for 401 Unauthorized - the session-expired event
        // above produces a single, specific message instead
        // Don't show toast for 409 Conflict - let the caller handle it with context-specific message
        if (!skipToast && response.status !== 401 && !isConflict) {
          toast.error(translateOutsideReact('errors.api.title'), {
            description: errorMessage,
          })
        }
        throw error
      }

      // Response metadata the parsed body can't carry (e.g. X-Total-Count, which tells
      // the board whether it is showing everything). Non-breaking on purpose: the return
      // type stays the parsed body, so the ~85 existing call sites are untouched.
      options?.onHeaders?.(response.headers)

      // Handle empty responses (e.g., DELETE operations with 204 No Content)
      const contentType = response.headers.get('content-type')
      if (response.status === 204 || !contentType || contentType.indexOf('application/json') === -1) {
        return undefined as T
      }

      const data = await response.json()
      return data

    } catch (error) {
      lastError = error as Error

      // Network errors are always retryable.
      //
      // The message is deliberately NOT inspected any more. It used to require
      // `.includes('fetch')`, which only matches Chrome's "Failed to fetch" – Safari
      // throws `TypeError: Load failed` and Firefox "NetworkError when attempting to
      // fetch resource". On Safari every offline request therefore fell through to the
      // generic re-throw below: no "Verbindung verloren" toast, and GETs threw instead of
      // degrading softly, so ~85 read call sites silently changed contract per browser.
      // Any TypeError out of `fetch()` is a network-layer failure; that is the check.
      //
      // AbortError is the request timeout below – also a network failure, also retryable.
      const isTimeout = error instanceof DOMException && error.name === 'TimeoutError'
      if (error instanceof TypeError || isTimeout) {
        if (retryCount < maxRetries) {
          const delay = getBackoffDelay(retryCount)
          await sleep(delay)
          continue // Retry
        }

        // Final network error. ONE persistent toast per outage instead of
        // one per failed request — 50 polls during an outage used to stack
        // 50 "Verbindungsfehler" toasts. Also flips the reachability flag
        // the stale-data banner subscribes to.
        markRestUnreachable(skipToast)
        if (isGetRequest) {
          // Reads degrade softly: polling callers treat undefined as "no
          // fresh data" and keep showing the last known state.
          return undefined as T
        }
        // Mutations must fail loudly so the caller's catch (rollback,
        // toast, refresh) runs – otherwise the optimistic UI state keeps
        // claiming a write succeeded that was never sent.
        throw new NetworkError()
      }

      // Re-throw other errors (like our API errors)
      throw error
    }
  }

  // Should not reach here, but just in case
  if (lastError) {
    throw lastError
  }
  throw new Error(translateOutsideReact('errors.api.unknown'))
}
