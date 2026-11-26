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
import { emitAppEvent } from '../app-events'
import { toast } from 'sonner'
import { translateOutsideReact } from '../i18n-messages'
import { ApiError, NetworkError } from './types'
import { detailOf, errorCodeOf, errorParamsOf, messageForErrorCode } from './error-codes'

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
const restListeners = new Set<(reachable: boolean) => void>()

// ── One voice per outage ─────────────────────────────────────────────────────
// While the stale-data banner is up it IS the outage message («Verbindung
// verloren … Stand 09:20:49 · Neu verbinden»), so no red, never-expiring toast
// says it a second time over the cards (UX-DESKTOP-11 / UX-PHONE-11). The banner
// claims the voice while it shows; the outage toasts (this module's and the
// notification poll's) go through `showOutageToast`, which stays quiet while it
// is claimed, and a claim takes down the ones already up. Where no banner shows
// (a page that never loaded the board: login, /feld, /reko …) the toast is the
// only voice and says «Server nicht erreichbar – angezeigt wird der letzte Stand»
let outageVoiceClaims = 0
const outageToastsUp = new Set<string>()

/** Raise the sticky outage toast `id` unless a banner already says it. */
export function showOutageToast(id: string) {
  if (outageVoiceClaims > 0 || outageToastsUp.has(id)) return
  outageToastsUp.add(id)
  toast.error(translateOutsideReact('errors.api.connectionTitle'), { id, duration: Infinity })
}

/** Take the outage toast `id` down again (the condition cleared). */
export function dismissOutageToast(id: string) {
  if (!outageToastsUp.delete(id)) return
  toast.dismiss(id)
}

/** The stale banner is showing: it speaks for the outage. Returns the release. */
export function claimOutageVoice(): () => void {
  outageVoiceClaims += 1
  for (const id of outageToastsUp) toast.dismiss(id)
  outageToastsUp.clear()
  let released = false
  return () => {
    if (released) return
    released = true
    outageVoiceClaims -= 1
  }
}

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
  if (!skipToast) showOutageToast(CONNECTION_TOAST_ID)
}

/** A request was answered (any status code): the server is reachable again. */
export function markRestReachable() {
  setRestReachable(true)
  dismissOutageToast(CONNECTION_TOAST_ID)
}

/** What `request()` accepts on top of `fetch`'s own options. */
export type RequestOptions = RequestInit & {
  auth?: 'session' | 'link'
  skipToast?: boolean
  maxRetries?: number
  onHeaders?: (headers: Headers) => void
  /** `false`: a lost answer stays this caller's news and does not mark REST unreachable
   *  for the tab (the stale banner). For a side surface with its own «unavailable» state
   *  (the bell), whose one-shot miss must not raise the board-wide band. */
  reportsOutage?: boolean
}

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
 * One exchange with the backend: timeout, retries with backoff, the error toasts, the
 * session-expiry signal and the tab-wide reachability. Resolves to what `read` makes of the
 * answered 2xx response – read inside the retry loop, so a connection that drops while
 * the body streams is a network failure like one that drops before the headers. Rejects
 * with `ApiError` for an error status, and with `NetworkError` when no full answer came
 * after the retries – for a read as for a write, so «no answer» never passes for an
 * empty list. A caller that keeps its last state while offline catches
 * `NetworkError` (`NetworkError.isNetworkError`); the outage itself has one voice
 * (the stale banner or `showOutageToast`).
 */
async function send<R>(endpoint: string, options: RequestOptions | undefined, read: (response: Response) => Promise<R>): Promise<R> {
  // Always resolved per request, so the browser picks up the runtime URL.
  const baseUrl = getApiUrl()
  const url = `${baseUrl}${endpoint}`
  const method = options?.method || 'GET'
  const isGetRequest = method === 'GET'
  const skipToast = options?.skipToast || false
  // Only reads retry by default. A mutation whose response was lost (network drop, proxy
  // 502/504) may already have committed – replaying it could create a second incident,
  // send an alarm or print twice, or put an older text over a newer one. The caller's
  // catch decides what the operator sees; a retry there is a deliberate act.
  const maxRetries = options?.maxRetries ?? (isGetRequest ? 3 : 0)

  for (let retryCount = 0; ; retryCount++) {
    let response: Response
    try {
      response = await fetch(url, {
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
      if (response.ok) {
        // Response metadata the parsed body can't carry (e.g. X-Total-Count, which tells
        // the board whether it is showing everything).
        options?.onHeaders?.(response.headers)
        const result = await read(response)
        // A full answer: the connection works. Clears the outage toast/state the moment
        // the first request gets through again – not on headers whose body then breaks.
        markRestReachable()
        return result
      }
      // An error status is an answer too.
      markRestReachable()
    } catch (error) {
      // Any TypeError out of `fetch()` or the body stream is a network-layer failure
      // (Chrome «Failed to fetch», Safari «Load failed», Firefox «NetworkError …» – never
      // read the message), and a TimeoutError is the request timeout above. Both retry.
      const isTimeout = error instanceof DOMException && error.name === 'TimeoutError'
      if (!(error instanceof TypeError || isTimeout)) throw error
      if (retryCount < maxRetries) {
        await sleep(getBackoffDelay(retryCount))
        continue
      }
      // ONE persistent toast per outage instead of one per failed request, and the
      // reachability flag the stale-data banner subscribes to.
      if (options?.reportsOutage !== false) markRestUnreachable(skipToast)
      throw new NetworkError()
    }

    let errorText = ''
    try {
      errorText = await response.text()
    } catch {
      errorText = translateOutsideReact('errors.api.noErrorDetails')
    }
    // console.warn, not error: the Next.js error overlay must not take over the page.
    console.warn(`[API Error] ${method} ${endpoint}: ${response.status} ${response.statusText}`, errorText)

    let errorMessage = `${response.status} ${response.statusText}`
    let errorCode: string | undefined
    let errorParams: Record<string, string | number> | undefined
    try {
      const errorJson: unknown = JSON.parse(errorText)
      // A coded error is said in the operator's language; the German `detail` is the
      // fallback for a code this build does not know.
      errorCode = errorCodeOf(errorJson)
      errorParams = errorParamsOf(errorJson)
      errorMessage = messageForErrorCode(errorJson) ?? detailOf(errorJson) ?? errorMessage
    } catch {
      // Not JSON: the text itself, when it is short enough to be a message.
      if (errorText && errorText.length < 200) errorMessage = errorText
    }

    const isRetryable = response.status >= 500 || response.status === 429 || response.status === 408
    if (isRetryable && retryCount < maxRetries) {
      await sleep(getBackoffDelay(retryCount))
      continue
    }

    const isConflict = response.status === 409
    const error = new ApiError(errorMessage, response.status, isConflict, errorCode, errorParams)

    // Cookie-authenticated requests can signal session expiry. Share tokens expire
    // independently of the operator session (auth endpoints do not go through
    // this client). Tell the auth layer so it can clear the user and
    // show "Sitzung abgelaufen" – without this, every mutation after
    // token expiry fails silently and optimistic UI just reverts.
    if (response.status === 401 && options?.auth !== 'link' && typeof window !== 'undefined') {
      emitAppEvent('kp:session-expired')
    }

    // No toast for 401 (the session-expired event above says it once) nor for 409 (the
    // caller says it with context).
    if (!skipToast && response.status !== 401 && !isConflict) {
      toast.error(translateOutsideReact('errors.api.title'), {
        description: errorMessage,
      })
    }
    throw error
  }
}

/** What a JSON body can be: anything but nothing – `request<void>` is a tsc error. */
type Body = NonNullable<unknown> | null

/**
 * A route that answers JSON: resolves to its body, typed `T` (an alias of the generated
 * schema, `lib/api/wire.ts`). The transport does not validate the body – `T` is the
 * contract `docs/openapi.json` publishes. An answer without a JSON body is a contract
 * error here, not an `undefined` typed as `T`: a bodyless route uses `requestVoid`.
 */
export function request<T extends Body>(endpoint: string, options?: RequestOptions): Promise<T> {
  return send(endpoint, options, async (response) => {
    const contentType = response.headers.get('content-type') ?? ''
    if (response.status === 204 || !contentType.includes('application/json')) {
      console.warn(`[API Error] ${options?.method ?? 'GET'} ${endpoint}: ${response.status} without a JSON body`)
      throw new ApiError(translateOutsideReact('errors.api.unknown'), response.status)
    }
    const body: unknown = await response.json()
    return body as T
  })
}

/** A route that answers without a body (204), or whose body the caller does not read. */
export function requestVoid(endpoint: string, options?: RequestOptions): Promise<void> {
  return send(endpoint, options, async () => undefined)
}

/** A rejected share credential expires the link independently of a signed-in operator. */
export function linkRequest<T extends Body>(endpoint: string, options?: RequestOptions): Promise<T> {
  return request<T>(endpoint, { ...options, auth: 'link' })
}

/** `requestVoid` on a share link (see `linkRequest`). */
export function linkRequestVoid(endpoint: string, options?: RequestOptions): Promise<void> {
  return requestVoid(endpoint, { ...options, auth: 'link' })
}
