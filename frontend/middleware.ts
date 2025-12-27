import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * Middleware to proxy /backend-api/* requests to the actual backend.
 * This runs at request time, so it can read runtime environment variables.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Only handle /backend-api/* requests
  if (pathname.startsWith('/backend-api')) {
    const backendUrl = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL

    if (!backendUrl) {
      console.error('[Middleware] API_URL not configured!')
      return new NextResponse('Backend URL not configured', { status: 500 })
    }

    // Remove /backend-api prefix and proxy to actual backend
    const targetPath = pathname.replace('/backend-api', '')
    const targetUrl = `${backendUrl}${targetPath}${request.nextUrl.search}`

    // Clone the request headers
    const headers = new Headers(request.headers)

    // Forward the request to the backend
    return NextResponse.rewrite(new URL(targetUrl))
  }

  return NextResponse.next()
}

export const config = {
  matcher: '/backend-api/:path*',
}
