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
 * Get the direct backend URL for WebSocket connections.
 *
 * WebSocket connections cannot go through the Next.js API proxy (/backend-api)
 * because API routes only handle HTTP, not WebSocket upgrades. On Railway/production,
 * the WS client must connect directly to the backend domain.
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

  // Runtime fallback for non-localhost deployments without build-time env vars:
  // Derive backend URL from current hostname using Railway naming convention
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname
    if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
      // Railway pattern: frontend=X.up.railway.app → backend=X-api.up.railway.app
      const parts = hostname.split('.')
      if (parts.length >= 3) {
        return `wss://${parts[0]}-api.${parts.slice(1).join('.')}`
      }
      return `wss://${hostname}`
    }
  }

  return 'ws://localhost:8000'
}
