/**
 * Runtime environment configuration
 *
 * Published images use same-origin HTTP and runtime WebSocket configuration.
 * NEXT_PUBLIC_* values are build-time overrides for source builds/development.
 */

/**
 * The backend origin the browser is allowed to address directly, handed down by the
 * server at request time (root layout → `<RuntimeBackendOrigin>`), because the value
 * lives in `API_URL` – a *runtime* variable the browser otherwise never sees.
 *
 * Module-level, and only ever written on the client: during SSR this module is shared
 * by every request in the process, so storing per-request state here would be a leak.
 */
let runtimeBackendOrigin: string | null = null
let runtimeCartoApiKey: string | null = null

/**
 * Reduce a configured backend URL to an origin the *browser* can actually open a
 * connection to, or `null` if it cannot.
 *
 * `API_URL` is not automatically a public address. The compose stack sets
 * `API_URL=http://backend:8000` – a Docker service name that resolves inside the
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
 * The same vetting as `publicBackendOrigin()`, for a value that is already a WebSocket URL.
 *
 * `NEXT_PUBLIC_WS_URL` names `wss://…`, and `publicBackendOrigin()` deliberately refuses any
 * scheme but http/https. Rather than copy the hostname rule – the one thing that must never
 * exist twice – the scheme is mapped to http for the check and back afterwards.
 */
function publicWebsocketOrigin(raw: string | null | undefined): string | null {
  if (!raw) return null
  const vetted = publicBackendOrigin(raw.trim().replace(/^ws/, 'http'))
  return vetted ? vetted.replace(/^http/, 'ws') : null
}

/** `https://host` → `wss://host`, `http://host` → `ws://host`. */
function asWebsocketOrigin(origin: string): string {
  return origin.replace(/^http/, 'ws')
}

/** What the CSP builder needs to know about the environment it is running in. */
export interface CspEnvironment {
  /** Runtime `API_URL`. The only source that knows where THIS deployment's backend is. */
  apiUrl?: string | null
  /** Build-time `NEXT_PUBLIC_API_URL` – an override for a station building its own image. */
  publicApiUrl?: string | null
  /** Build-time `NEXT_PUBLIC_WS_URL` – same, for a socket endpoint elsewhere. */
  publicWsUrl?: string | null
  /** `NODE_ENV === 'production'`; dev hot reload needs `'unsafe-eval'`. */
  isProduction?: boolean
}

/**
 * Assemble the Content-Security-Policy header.
 *
 * This lives here, and is called from `middleware.ts` per request, because `connect-src` has
 * to name the backend – and on a split-origin deployment (Railway) the backend is only known
 * at *runtime*, from `API_URL`. It used to be built in `next.config.mjs`, which Next serialises
 * into the route manifest during `next build`: the header was then fixed for the life of the
 * image, and its only backend entry came from `NEXT_PUBLIC_API_URL`. The published images are
 * built without that variable on purpose, so a station on a custom backend domain got a socket
 * that was aimed correctly and a browser that refused to open it.
 *
 * That also made `NEXT_PUBLIC_API_URL` load-bearing for two unrelated jobs – an API override
 * *and* the only channel into the CSP – which is why it could not be dropped from a deployment
 * that had it set. Now it is an override again, and nothing more.
 *
 * Backend origins go through `publicBackendOrigin()`, the same filter `getWsUrl()` uses: the
 * compose stack sets `API_URL=http://backend:8000`, a Docker service name, and naming it in
 * `connect-src` would put a hostname in the policy that no browser can resolve. Compose is
 * served from one origin anyway, where `'self'` already covers the API, the tiles and (per
 * CSP3) the same-origin WebSocket.
 */
export function buildContentSecurityPolicy(env: CspEnvironment = {}): string {
  // Runtime first, then the build-time overrides. Each contributes both its https origin (the
  // API calls) and the matching wss origin (the Socket.IO upgrade).
  const backendOrigins: string[] = []
  // The http half on its own, for `img-src`: the backend serves the rapport/Reko photos as
  // ordinary files, and an `<img src>` is governed by img-src, not connect-src. Naming the
  // backend in one and not the other is exactly how a photo came back as a broken-image icon
  // in local development with no network error and no 401 to point at – Chrome refused the
  // subresource before it was ever requested. The ws entries have no business in img-src.
  const backendImageOrigins: string[] = []
  for (const raw of [env.apiUrl, env.publicApiUrl]) {
    const origin = publicBackendOrigin(raw)
    if (!origin) continue
    backendOrigins.push(origin, asWebsocketOrigin(origin))
    backendImageOrigins.push(origin)
  }
  const wsOverride = publicWebsocketOrigin(env.publicWsUrl)
  if (wsOverride) backendOrigins.push(wsOverride)

  // A Set keeps insertion order and stops a station that sets NEXT_PUBLIC_API_URL to the same
  // value as API_URL from getting every host twice.
  const connectSrc = [
    ...new Set([
      "'self'",
      'http://localhost:8000',
      'https://*.railway.app',
      ...backendOrigins,
      'https://*.tile.openstreetmap.org',
      'https://*.basemaps.cartocdn.com',
      'https://server.arcgisonline.com',
      'http://localhost:8080',
      'ws://localhost:*',
      'wss://*.railway.app',
    ]),
  ]

  return [
    "default-src 'self'",
    // Scripts: self + inline (Next.js hydration) + eval (dev hot reload)
    env.isProduction
      ? "script-src 'self' 'unsafe-inline'"
      : "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    // Styles: self + inline (Tailwind CSS)
    "style-src 'self' 'unsafe-inline'",
    // Images: self + data URIs + blob + the backend (photos) + map tile servers
    `img-src ${[
      ...new Set([
        "'self'",
        'data:',
        'blob:',
        'http://localhost:8000',
        ...backendImageOrigins,
        'https://*.tile.openstreetmap.org',
        'https://tile.openstreetmap.org',
        'https://*.basemaps.cartocdn.com',
        'https://server.arcgisonline.com',
        'http://localhost:8080',
      ]),
    ].join(' ')}`,
    // Fonts: self + data URIs + the tile server (MapLibre glyph ranges live under /fonts)
    "font-src 'self' data: http://localhost:8080",
    // Connect: self + API + WebSocket + map tiles + local tile server
    `connect-src ${connectSrc.join(' ')}`,
    // Workers: MapLibre compiles its tile worker into a blob: URL and spawns it from there.
    // Without this the map never initialises – `default-src 'self'` refuses the blob, and the
    // only symptom is an empty canvas. `child-src` says the same thing for engines that
    // predate `worker-src`.
    "worker-src 'self' blob:",
    "child-src blob:",
    // Frame ancestors: prevent clickjacking
    "frame-ancestors 'none'",
    // Form actions: only to self
    "form-action 'self'",
    // Base URI: only self
    "base-uri 'self'",
    // Object sources: none (no plugins)
    "object-src 'none'",
  ].join('; ')
}

/**
 * Publish the server's `API_URL` to the client. Called during render of a client
 * component in the root layout, so it is set before any effect opens a socket.
 */
export function setRuntimeBackendOrigin(raw: string | null | undefined): void {
  if (typeof window === 'undefined') return
  runtimeBackendOrigin = publicBackendOrigin(raw)
}

/**
 * Publish the runtime CARTO key to the browser.
 *
 * CARTO raster URLs require the key as a `?key=` query parameter, so this value is visible in
 * tile requests by design. Keeping it in `CARTO_API_KEY` still prevents it being committed or
 * baked into the shared frontend image, and lets each deployment rotate it without a rebuild.
 */
export function setRuntimeCartoApiKey(raw: string | null | undefined): void {
  if (typeof window === 'undefined') return
  runtimeCartoApiKey = raw?.trim() || null
}

export function getCartoApiKey(): string | null {
  return runtimeCartoApiKey
}

/** Only the local development server talks directly to the published dev ports. */
function isLocalDevServer(): boolean {
  if (process.env.NODE_ENV === 'production' || typeof window === 'undefined') return false
  const { hostname, port } = window.location
  return (hostname === 'localhost' || hostname === '127.0.0.1') && port === '3000'
}

export function getApiUrl(): string {
  // Server-side or explicit env var: always prefer NEXT_PUBLIC_API_URL
  const envUrl = process.env.NEXT_PUBLIC_API_URL
  if (envUrl) {
    return envUrl
  }

  return isLocalDevServer() ? 'http://localhost:8000' : '/backend-api'
}

/**
 * Base URL of the offline tile server.
 *
 * Local development talks to the tileserver container directly on :8080. A deployed stack
 * puts it behind the same origin as the app (the reverse proxy routes /tiles/* to the
 * tileserver), so the browser needs no second host – and no CSP exception, since 'self'
 * already covers it.
 *
 * The discriminator is a non-production build on the DEV SERVER'S PORT, not just the hostname.
 * It used to be the hostname,
 * which quietly broke the single most ordinary self-host setup there is: a station running
 * the compose stack on one box and opening `http://localhost:8080` on that same box. There,
 * `localhost` sent the browser to `http://localhost:8080/styles/…` – which is Caddy, which
 * routes anything that isn't /api, /socket.io or /tiles to the FRONTEND. Offline tiles 404'd
 * and the map went blank, while the identical stack reached by LAN IP worked. Port 3000 is
 * the Next dev server in `docker-compose.dev.yml` and in `pnpm dev`; nothing else in this
 * project defaults to that port. A production build on :3000 still uses its own origin.
 */
export function getTileBaseUrl(): string {
  const envUrl = process.env.NEXT_PUBLIC_TILE_URL
  if (envUrl) {
    return envUrl
  }

  return isLocalDevServer() ? 'http://localhost:8080' : '/tiles'
}

/**
 * Get the direct backend URL for WebSocket connections.
 *
 * WebSocket connections cannot go through the Next.js API proxy (/backend-api) because API
 * routes only handle HTTP, not WebSocket upgrades. A single-origin deployment therefore
 * relies on its reverse proxy routing /socket.io to the backend; a split-origin deployment
 * (Railway) has to name the backend host.
 *
 * The sources, in order – the first one that answers wins:
 *
 * 1. the runtime `API_URL` the server handed us. It is the only source that is both
 *    correct per deployment and free of a rebuild, which is why it outranks the
 *    `NEXT_PUBLIC_*` pair: those are inlined at build time and so tie an image to one
 *    station;
 * 2. `NEXT_PUBLIC_WS_URL`, then `NEXT_PUBLIC_API_URL` – overrides, kept for a build that
 *    sets them (local `.env.local`, a station building its own image);
 * 3. guesses from `window.location`: the Railway `X` → `X-api` hostname convention, then
 *    same-origin. Last resort for a deployment that tells the browser nothing.
 */
export function getWsUrl(): string {
  // Runtime configuration beats anything baked into the bundle: it is the only source that
  // knows where THIS deployment's backend is. Without it, a Railway install on a custom
  // domain fell through to same-origin – no socket, no error, 5-second polling forever.
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
    if (!isLocalDevServer()) {
      // Railway runs the frontend and backend as two services on two hostnames with no
      // shared proxy in front, so the socket has to be addressed directly by convention:
      // X.up.railway.app → X-api.up.railway.app.
      if (hostname.endsWith('.up.railway.app')) {
        const parts = hostname.split('.')
        return `wss://${parts[0]}-api.${parts.slice(1).join('.')}`
      }
      // Everywhere else the deployment sits behind ONE origin that routes /socket.io to
      // the backend (deploy/Caddyfile), so same-origin is correct. Applying the Railway
      // guess here would point at a hostname that doesn't exist – and hardcoding wss://
      // would break a plain-HTTP LAN install, hence deriving the scheme from the origin.
      return origin.replace(/^http/, 'ws')
    }
  }

  return 'ws://localhost:8000'
}
