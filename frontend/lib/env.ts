/**
 * Runtime environment configuration
 *
 * Uses NEXT_PUBLIC_API_URL for production deployments.
 * Falls back to localhost:8000 for local development.
 *
 * Note: NEXT_PUBLIC_* vars are inlined at build time by Next.js.
 * The Dockerfile must pass them as build args for production builds.
 */

/**
 * The backend origin the browser is allowed to address directly, handed down by the
 * server at request time (root layout → `<RuntimeBackendOrigin>`), because the value
 * lives in `API_URL` — a *runtime* variable the browser otherwise never sees.
 *
 * Module-level, and only ever written on the client: during SSR this module is shared
 * by every request in the process, so storing per-request state here would be a leak.
 */
let runtimeBackendOrigin: string | null = null

/**
 * Reduce a configured backend URL to an origin the *browser* can actually open a
 * connection to, or `null` if it cannot.
 *
 * `API_URL` is not automatically a public address. The compose stack sets
 * `API_URL=http://backend:8000` — a Docker service name that resolves inside the
 * container network and nowhere else; handing that to the browser would replace one
 * silent failure with another. A single-label hostname is exactly that shape, and
 * `*.railway.internal` is Railway's equivalent for private networking.
 */
export function publicBackendOrigin(raw: string | null | undefined): string | null {
  if (!raw) return null

  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null

  const host = url.hostname
  const isLoopback = host === 'localhost' || host === '127.0.0.1' || host === '[::1]'
  if (!isLoopback) {
    // Container/service names, not addresses: `backend`, `frontend.railway.internal`.
    if (!host.includes('.')) return null
    if (host.endsWith('.internal')) return null
  }

  return `${url.protocol}//${url.host}`
}

/**
 * Publish the server's `API_URL` to the client. Called during render of a client
 * component in the root layout, so it is set before any effect opens a socket.
 */
export function setRuntimeBackendOrigin(raw: string | null | undefined): void {
  if (typeof window === 'undefined') return
  runtimeBackendOrigin = publicBackendOrigin(raw)
}

export function getApiUrl(): string {
  // Server-side or explicit env var: always prefer NEXT_PUBLIC_API_URL
  const envUrl = process.env.NEXT_PUBLIC_API_URL
  if (envUrl) {
    return envUrl
  }

  // Client-side: for non-localhost domains, use proxy
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname
    if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
      return '/backend-api'
    }
  }

  return 'http://localhost:8000'
}

/**
 * Base URL of the offline tile server.
 *
 * Local development talks to the tileserver container directly on :8080. A deployed stack
 * puts it behind the same origin as the app (the reverse proxy routes /tiles/* to the
 * tileserver), so the browser needs no second host — and no CSP exception, since 'self'
 * already covers it.
 */
export function getTileBaseUrl(): string {
  const envUrl = process.env.NEXT_PUBLIC_TILE_URL
  if (envUrl) {
    return envUrl
  }

  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname
    if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
      return '/tiles'
    }
  }

  return 'http://localhost:8080'
}

/**
 * Get the direct backend URL for WebSocket connections.
 *
 * WebSocket connections cannot go through the Next.js API proxy (/backend-api) because API
 * routes only handle HTTP, not WebSocket upgrades. A single-origin deployment therefore
 * relies on its reverse proxy routing /socket.io to the backend; a split-origin deployment
 * (Railway) has to name the backend host.
 *
 * The sources, in order — the first one that answers wins:
 *
 * 1. the runtime `API_URL` the server handed us. It is the only source that is both
 *    correct per deployment and free of a rebuild, which is why it outranks the
 *    `NEXT_PUBLIC_*` pair: those are inlined at build time and so tie an image to one
 *    station;
 * 2. `NEXT_PUBLIC_WS_URL`, then `NEXT_PUBLIC_API_URL` — overrides, kept for a build that
 *    sets them (local `.env.local`, a station building its own image);
 * 3. guesses from `window.location`: the Railway `X` → `X-api` hostname convention, then
 *    same-origin. Last resort for a deployment that tells the browser nothing.
 */
export function getWsUrl(): string {
  // Runtime configuration beats anything baked into the bundle: it is the only source that
  // knows where THIS deployment's backend is. Without it, a Railway install on a custom
  // domain fell through to same-origin — no socket, no error, 5-second polling forever.
  if (runtimeBackendOrigin) {
    return runtimeBackendOrigin.replace(/^http/, 'ws')
  }

  // Explicit WS URL takes priority over the remaining guesses
  const wsUrl = process.env.NEXT_PUBLIC_WS_URL
  if (wsUrl) {
    return wsUrl
  }

  // Use NEXT_PUBLIC_API_URL (inlined at build time via Dockerfile ARG)
  const apiUrl = process.env.NEXT_PUBLIC_API_URL
  if (apiUrl) {
    return apiUrl.replace(/^http/, 'ws')
  }

  // Runtime fallback for deployments with no build-time env var.
  if (typeof window !== 'undefined') {
    const { hostname, origin } = window.location
    if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
      // Railway runs the frontend and backend as two services on two hostnames with no
      // shared proxy in front, so the socket has to be addressed directly by convention:
      // X.up.railway.app → X-api.up.railway.app.
      if (hostname.endsWith('.up.railway.app')) {
        const parts = hostname.split('.')
        return `wss://${parts[0]}-api.${parts.slice(1).join('.')}`
      }
      // Everywhere else the deployment sits behind ONE origin that routes /socket.io to
      // the backend (deploy/Caddyfile), so same-origin is correct. Applying the Railway
      // guess here would point at a hostname that doesn't exist — and hardcoding wss://
      // would break a plain-HTTP LAN install, hence deriving the scheme from the origin.
      return origin.replace(/^http/, 'ws')
    }
  }

  return 'ws://localhost:8000'
}
