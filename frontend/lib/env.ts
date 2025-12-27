/**
 * Runtime environment configuration
 *
 * In production, uses Next.js rewrites to proxy API requests through /backend-api
 * This avoids CORS issues and doesn't require build-time env vars.
 *
 * In development (localhost), calls the backend directly.
 */

export function getApiUrl(): string {
  // Client-side: check if we're in production (non-localhost)
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname

    // In production (any non-localhost domain), use the proxy path
    // Next.js rewrites will forward /backend-api/* to the actual backend
    if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
      return '/backend-api'
    }
  }

  // Server-side or localhost: use env var or default
  const envUrl = process.env.NEXT_PUBLIC_API_URL
  if (envUrl) {
    return envUrl
  }

  return 'http://localhost:8000'
}
