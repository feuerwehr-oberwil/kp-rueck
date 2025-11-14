/**
 * Runtime environment configuration
 * This allows the API URL to be determined at runtime, not build time
 */

export function getApiUrl(): string {
  // Client-side: determine based on current location
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname

    // If we're on the production frontend domain, always use HTTPS for backend
    if (hostname.includes('railway.app') || hostname.includes('up.railway.app')) {
      // Always use HTTPS in production
      return 'https://fwo-kp-api.up.railway.app'
    }
  }

  // Server-side: use env variable or default to localhost
  // For Railway production builds, this should use the HTTPS URL
  if (process.env.NEXT_PUBLIC_API_URL) {
    // Ensure HTTPS is used in production even if env var is set to HTTP
    const apiUrl = process.env.NEXT_PUBLIC_API_URL
    if (apiUrl.includes('railway.app') && apiUrl.startsWith('http://')) {
      return apiUrl.replace('http://', 'https://')
    }
    return apiUrl
  }

  return 'http://localhost:8000'
}

export const API_URL = getApiUrl()
