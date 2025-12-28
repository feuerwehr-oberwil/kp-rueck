/**
 * Runtime environment configuration
 *
 * In production, calls the backend directly at kp-api.fwo.li.
 * Cookies work across subdomains because backend sets domain=".fwo.li".
 *
 * In development (localhost), calls the backend directly.
 */

export function getApiUrl(): string {
  // Client-side: check if we're in production (non-localhost)
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname

    // In production on fwo.li domain, use the API subdomain directly
    // Cookies work because backend sets domain=".fwo.li"
    if (hostname.endsWith('.fwo.li') || hostname === 'fwo.li') {
      return 'https://kp-api.fwo.li'
    }

    // For other non-localhost domains (e.g., railway.app), use proxy
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
