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
