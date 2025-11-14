/**
 * Runtime environment configuration
 * This allows the API URL to be determined at runtime, not build time
 */

export function getApiUrl(): string {
  // ALWAYS force HTTPS for Railway API, regardless of env var
  // This is a safety check to prevent mixed content errors
  const envUrl = process.env.NEXT_PUBLIC_API_URL

  // If env URL contains railway.app, FORCE it to HTTPS
  if (envUrl && envUrl.includes('railway.app')) {
    const httpsUrl = envUrl.replace('http://', 'https://')
    console.log('[getApiUrl] Railway env detected, forcing HTTPS:', httpsUrl)
    return httpsUrl
  }

  // Client-side: determine based on current location
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname
    console.log('[getApiUrl] Client-side detection - hostname:', hostname)

    // If we're on the production frontend domain, always use HTTPS for backend
    if (hostname.includes('railway.app') || hostname.includes('up.railway.app')) {
      console.log('[getApiUrl] Railway hostname detected, using HTTPS')
      return 'https://fwo-kp-api.up.railway.app'
    }

    console.log('[getApiUrl] Not Railway, falling through')
  } else {
    console.log('[getApiUrl] Server-side (no window), env:', envUrl)
  }

  // Use env variable or default to localhost
  if (envUrl) {
    console.log('[getApiUrl] Using env var:', envUrl)
    return envUrl
  }

  console.log('[getApiUrl] Defaulting to localhost')
  return 'http://localhost:8000'
}
