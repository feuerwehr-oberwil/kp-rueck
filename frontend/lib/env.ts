/**
 * Runtime environment configuration
 *
 * Uses NEXT_PUBLIC_API_URL for production deployments.
 * Falls back to localhost:8000 for local development.
 *
 * Note: NEXT_PUBLIC_* vars are inlined at build time by Next.js.
 * The Dockerfile must pass them as build args for production builds.
 */

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
 * relies on its reverse proxy routing /socket.io to the backend; Railway, which has no such
 * proxy, is addressed directly by hostname convention.
 */
export function getWsUrl(): string {
  // Explicit WS URL takes highest priority
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
