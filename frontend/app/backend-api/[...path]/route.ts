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

  // Log backend URL once per request (helps debug connectivity)
  console.log(`[API Proxy] Backend URL: ${backendUrl}`)

  // Get the path after /backend-api/
  const url = new URL(request.url)
  let targetPath = url.pathname.replace('/backend-api', '')
  // Ensure trailing slash for FastAPI (Next.js strips it via 308, causing redirect chains)
  if (targetPath && !targetPath.endsWith('/') && !targetPath.includes('.')) {
    targetPath += '/'
  }
  const targetUrl = `${backendUrl}${targetPath}${url.search}`

  // Get cookies from the request
  const cookieStore = await cookies()
  const accessToken = cookieStore.get('access_token')?.value
  const refreshToken = cookieStore.get('refresh_token')?.value

  // Fallback to raw header if cookies() doesn't work
  const rawCookie = request.headers.get('cookie')

  // Debug: Log cookie status for all requests
  console.log(`[API Proxy] ${request.method} ${targetPath} | cookies(): access=${!!accessToken} refresh=${!!refreshToken} | raw: ${!!rawCookie}`)

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
  } else {
    console.log(`[API Proxy] WARNING: No cookies found for ${targetPath}`)
  }

  // Forward other headers (excluding problematic ones)
  const skipHeaders = ['host', 'cookie', 'connection', 'content-length']
  request.headers.forEach((value, key) => {
    if (!skipHeaders.includes(key.toLowerCase())) {
      headers.set(key, value)
    }
  })

  try {
    // Get request body for non-GET requests
    // Use arrayBuffer() to preserve binary data (text() corrupts file uploads)
    let body: ArrayBuffer | undefined
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      body = await request.arrayBuffer()
    }

    // Forward content-length for binary bodies
    if (body !== undefined) {
      headers.set('content-length', body.byteLength.toString())
    }

    // Follow redirects manually to preserve method, cookies, and enforce HTTPS
    let response = await fetch(targetUrl, {
      method: request.method,
      headers,
      body: body ? Buffer.from(body) : undefined,
      redirect: 'manual',
    })

    // Follow up to 3 redirects (handles FastAPI trailing-slash + HTTP→HTTPS chains)
    let redirectCount = 0
    while ([301, 302, 307, 308].includes(response.status) && redirectCount < 3) {
      let location = response.headers.get('location')
      if (!location) break
      // Ensure HTTPS (backend behind Railway proxy may emit http:// URLs)
      location = location.replace(/^http:\/\//, 'https://')
      console.log(`[API Proxy] Following ${response.status} redirect to: ${location}`)
      response = await fetch(location, {
        method: request.method,
        headers,
        body: body ? Buffer.from(body) : undefined,
        redirect: 'manual',
      })
      redirectCount++
    }

    // Debug: Log backend response status
    if (response.status === 401) {
      console.log(`[API Proxy] Backend returned 401 for ${targetPath} - Cookie header sent: ${headers.get('Cookie')?.substring(0, 50)}...`)
    }

    // Build response headers
    const responseHeaders = new Headers()

    // Forward Set-Cookie headers
    const responseCookies = response.headers.getSetCookie()
    if (responseCookies.length > 0) {
      console.log(`[API Proxy] Set-Cookie from backend for ${targetPath}:`, responseCookies)
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
  console.log('[API Proxy] POST handler called:', request.url)
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
