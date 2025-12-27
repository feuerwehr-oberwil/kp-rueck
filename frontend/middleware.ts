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
    // Debug: log incoming cookies
    const cookieHeader = request.headers.get('cookie')
    if (cookieHeader) {
      const hasAccessToken = cookieHeader.includes('access_token')
      console.log(`[Middleware] ${request.method} ${targetPath} - Cookie header present, access_token: ${hasAccessToken}`)
    } else {
      console.log(`[Middleware] ${request.method} ${targetPath} - No cookie header`)
    }

    // Build headers to forward - explicitly handle important headers
    const headers = new Headers()

    // Explicitly forward the Cookie header first
    if (cookieHeader) {
      headers.set('Cookie', cookieHeader)
    }

    // Forward other headers (excluding host)
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
    const cookies = response.headers.getSetCookie()
    if (cookies.length > 0) {
      console.log(`[Middleware] Forwarding ${cookies.length} Set-Cookie header(s) for ${targetPath}`)
    }
    cookies.forEach(cookie => {
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
