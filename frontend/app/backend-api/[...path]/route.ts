/**
 * API Route to proxy requests to the backend.
 * Using API routes instead of middleware for more reliable cookie handling.
 */
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

// Force Node.js runtime for reliable cookie handling
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function proxyRequest(request: NextRequest) {
  const backendUrl = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL

  if (!backendUrl) {
    console.error('[API Proxy] API_URL not configured!')
    return NextResponse.json({ error: 'Backend URL not configured' }, { status: 500 })
  }

  // Get the path after /backend-api/
  const url = new URL(request.url)
  const targetPath = url.pathname.replace('/backend-api', '')
  const targetUrl = `${backendUrl}${targetPath}${url.search}`

  // Debug: log all incoming headers
  const allHeaders: Record<string, string> = {}
  request.headers.forEach((value, key) => {
    allHeaders[key] = key.toLowerCase() === 'cookie' ? value.substring(0, 50) + '...' : value.substring(0, 100)
  })
  console.log(`[API Proxy] Headers for ${targetPath}:`, JSON.stringify(allHeaders, null, 2))

  // Try multiple methods to get cookies
  // Method 1: cookies() from next/headers
  const cookieStore = await cookies()
  const accessToken = cookieStore.get('access_token')?.value
  const refreshToken = cookieStore.get('refresh_token')?.value

  // Method 2: Raw header from request
  const rawCookie = request.headers.get('cookie')

  console.log(`[API Proxy] ${request.method} ${targetPath} - cookies(): ${!!accessToken}, raw: ${!!rawCookie}`)

  // Build headers
  const headers = new Headers()

  // Forward cookies - try cookies() first, then raw header
  if (accessToken || refreshToken) {
    const cookieParts: string[] = []
    if (accessToken) cookieParts.push(`access_token=${accessToken}`)
    if (refreshToken) cookieParts.push(`refresh_token=${refreshToken}`)
    headers.set('Cookie', cookieParts.join('; '))
  } else if (rawCookie) {
    headers.set('Cookie', rawCookie)
  }

  // Forward other headers (excluding problematic ones)
  const skipHeaders = ['host', 'cookie', 'connection', 'content-length']
  request.headers.forEach((value, key) => {
    if (!skipHeaders.includes(key.toLowerCase())) {
      headers.set(key, value)
    }
  })

  try {
    console.log(`[API Proxy] Proxying to ${targetUrl}`)

    // Get request body for non-GET requests
    let body: string | undefined
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      body = await request.text()
    }

    const response = await fetch(targetUrl, {
      method: request.method,
      headers,
      body,
    })

    console.log(`[API Proxy] Backend response: ${response.status} for ${targetPath}`)

    // Build response headers
    const responseHeaders = new Headers()

    // Forward Set-Cookie headers
    const responseCookies = response.headers.getSetCookie()
    if (responseCookies.length > 0) {
      console.log(`[API Proxy] Forwarding ${responseCookies.length} Set-Cookie header(s)`)
    }
    responseCookies.forEach(cookie => {
      responseHeaders.append('Set-Cookie', cookie)
    })

    // Forward other headers
    response.headers.forEach((value, key) => {
      const lowerKey = key.toLowerCase()
      if (!['content-encoding', 'transfer-encoding', 'set-cookie'].includes(lowerKey)) {
        responseHeaders.set(key, value)
      }
    })

    // Prevent caching
    responseHeaders.set('Cache-Control', 'no-store, no-cache, must-revalidate')

    return new NextResponse(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    })
  } catch (error) {
    console.error('[API Proxy] Error:', error)
    return NextResponse.json({ error: 'Proxy failed' }, { status: 502 })
  }
}

export async function GET(request: NextRequest) {
  return proxyRequest(request)
}

export async function POST(request: NextRequest) {
  return proxyRequest(request)
}

export async function PUT(request: NextRequest) {
  return proxyRequest(request)
}

export async function PATCH(request: NextRequest) {
  return proxyRequest(request)
}

export async function DELETE(request: NextRequest) {
  return proxyRequest(request)
}
