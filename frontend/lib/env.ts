/**
 * Runtime environment configuration
 * This allows the API URL to be determined at runtime, not build time
 */

export function getApiUrl(): string {
  // Client-side: determine based on current location
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname

    console.log('[getApiUrl] Client-side detection - hostname:', hostname)

    // If we're on the production frontend domain, always use HTTPS for backend
    if (hostname.includes('railway.app') || hostname.includes('up.railway.app')) {
      console.log('[getApiUrl] Railway detected, using HTTPS')
      // Always use HTTPS in production
      return 'https://fwo-kp-api.up.railway.app'
    }

    console.log('[getApiUrl] Not Railway, falling through to env var or localhost')
  } else {
    console.log('[getApiUrl] Server-side (no window), using env var:', process.env.NEXT_PUBLIC_API_URL)
  }

  // Server-side: use env variable or default to localhost
  // For Railway production builds, this should use the HTTPS URL
  if (process.env.NEXT_PUBLIC_API_URL) {
    // Ensure HTTPS is used in production even if env var is set to HTTP
    const apiUrl = process.env.NEXT_PUBLIC_API_URL
    if (apiUrl.includes('railway.app') && apiUrl.startsWith('http://')) {
      console.log('[getApiUrl] Converting HTTP to HTTPS:', apiUrl)
      return apiUrl.replace('http://', 'https://')
    }
    console.log('[getApiUrl] Using env var as-is:', apiUrl)
    return apiUrl
  }

  console.log('[getApiUrl] Defaulting to localhost')
  return 'http://localhost:8000'
}
