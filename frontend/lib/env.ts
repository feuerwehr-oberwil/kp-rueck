/**
 * Runtime environment configuration
 *
 * Uses NEXT_PUBLIC_API_URL for production deployments.
 * Falls back to localhost:8000 for local development.
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
 * because API routes only handle HTTP, not WebSocket upgrades. On Railway,
 * the WS client must connect directly to the backend domain.
 */
export function getWsUrl(): string {
  // Explicit WS URL takes highest priority
  const wsUrl = process.env.NEXT_PUBLIC_WS_URL
  if (wsUrl) {
    return wsUrl
  }

  // Use NEXT_PUBLIC_API_URL directly (not the proxy path)
  const apiUrl = process.env.NEXT_PUBLIC_API_URL
  if (apiUrl) {
    return apiUrl.replace(/^http/, 'ws')
  }

  return 'ws://localhost:8000'
}
