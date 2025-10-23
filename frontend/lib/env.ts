/**
 * Runtime environment configuration
 * This allows the API URL to be determined at runtime, not build time
 */

export function getApiUrl(): string {
  // In production on Railway, use window.location to construct backend URL
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname

    // If we're on the production frontend domain
    if (hostname.includes('railway.app') || hostname.includes('up.railway.app')) {
      // Use the backend URL from environment variable if available
      // This will be set at build time for Railway
      if (process.env.NEXT_PUBLIC_API_URL) {
        return process.env.NEXT_PUBLIC_API_URL
      }

      // Fallback: construct backend URL from frontend URL
      // If frontend is at: kp-rueck-frontend-production.up.railway.app
      // Backend should be at: fwo-kp-api.up.railway.app
      return 'https://fwo-kp-api.up.railway.app'
    }
  }

  // Server-side or localhost: use env variable or default to localhost
  return process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
}

export const API_URL = getApiUrl()
