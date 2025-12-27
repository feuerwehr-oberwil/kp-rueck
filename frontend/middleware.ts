import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * Middleware to proxy /backend-api/* requests to the actual backend.
 * Uses fetch() for true server-side proxying (not client redirect).
 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Only handle /backend-api/* requests
  if (!pathname.startsWith('/backend-api')) {
    return NextResponse.next()
  }

  const backendUrl = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL

  if (!backendUrl) {
    console.error('[Middleware] API_URL not configured!')
    return new NextResponse(JSON.stringify({ error: 'Backend URL not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Remove /backend-api prefix and build target URL
  const targetPath = pathname.replace('/backend-api', '')
  const targetUrl = `${backendUrl}${targetPath}${request.nextUrl.search}`

  try {
    // Try multiple ways to get cookies (Railway edge caching may interfere)
    // Method 1: Next.js cookies API
    const cookiesApi = request.cookies
    const accessTokenApi = cookiesApi.get('access_token')?.value
    const refreshTokenApi = cookiesApi.get('refresh_token')?.value

    // Method 2: Raw header (fallback)
    const rawCookieHeader = request.headers.get('cookie')

    // Use whichever method found the tokens
    let cookieHeader: string | null = null
    if (accessTokenApi || refreshTokenApi) {
      const cookieParts: string[] = []
      if (accessTokenApi) cookieParts.push(`access_token=${accessTokenApi}`)
      if (refreshTokenApi) cookieParts.push(`refresh_token=${refreshTokenApi}`)
      cookieHeader = cookieParts.join('; ')
    } else if (rawCookieHeader) {
      // Use raw header if API didn't work
      cookieHeader = rawCookieHeader
    }

    console.log(`[Middleware] ${request.method} ${targetPath} - api: ${!!accessTokenApi}, raw: ${!!rawCookieHeader}`)

    // Build headers to forward
    const headers = new Headers()

    // Set the Cookie header from our extracted cookies
    if (cookieHeader) {
      headers.set('Cookie', cookieHeader)
    }

    // Forward other headers (excluding host and cookie)
    request.headers.forEach((value, key) => {
      const lowerKey = key.toLowerCase()
      if (lowerKey !== 'host' && lowerKey !== 'cookie') {
        headers.set(key, value)
      }
    })

    // Proxy the request server-side
    console.log(`[Middleware] Proxying to ${targetUrl}`)
    const response = await fetch(targetUrl, {
      method: request.method,
      headers,
      body: request.method !== 'GET' && request.method !== 'HEAD' ? await request.text() : undefined,
      credentials: 'include', // Ensure cookies are sent
    })

    console.log(`[Middleware] Backend response: ${response.status} for ${targetPath}`)

    // Build response headers
    const responseHeaders = new Headers()

    // Handle Set-Cookie headers specially - they need to be preserved individually
    // The Headers API can merge them, so use getSetCookie() to get all cookies
    const responseCookies = response.headers.getSetCookie()
    if (responseCookies.length > 0) {
      console.log(`[Middleware] Forwarding ${responseCookies.length} Set-Cookie header(s) for ${targetPath}`)
    }
    responseCookies.forEach(cookie => {
      responseHeaders.append('Set-Cookie', cookie)
    })

    // Copy other headers
    response.headers.forEach((value, key) => {
      const lowerKey = key.toLowerCase()
      // Skip headers that shouldn't be forwarded or already handled
      if (!['content-encoding', 'transfer-encoding', 'set-cookie'].includes(lowerKey)) {
        responseHeaders.set(key, value)
      }
    })

    // Prevent edge caching for API requests
    responseHeaders.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
    responseHeaders.set('Pragma', 'no-cache')
    responseHeaders.set('Expires', '0')

    // Return proxied response
    return new NextResponse(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    })
  } catch (error) {
    console.error('[Middleware] Proxy error:', error)
    return new NextResponse(JSON.stringify({ error: 'Proxy failed' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

export const config = {
  matcher: '/backend-api/:path*',
}
