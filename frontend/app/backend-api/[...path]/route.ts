/**
 * API Route to proxy requests to the backend.
 * Using API routes instead of middleware for more reliable cookie handling.
 */
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

// Force Node.js runtime for reliable cookie handling
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Verbose request tracing is opt-in via DEBUG_API_PROXY=1 so production logs stay
// quiet and never echo cookie/token values. Errors are always logged.
const PROXY_DEBUG = process.env.DEBUG_API_PROXY === '1'
const debug = (...args: unknown[]) => {
  // eslint-disable-next-line no-console -- opt-in diagnostic tracing only
  if (PROXY_DEBUG) console.log(...args)
}

async function proxyRequest(request: NextRequest) {
  const backendUrl = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL

  if (!backendUrl) {
    console.error('[API Proxy] API_URL not configured!')
    return NextResponse.json({ error: 'Backend URL not configured' }, { status: 500 })
  }

  // Log backend URL once per request (helps debug connectivity)
  debug(`[API Proxy] Backend URL: ${backendUrl}`)

  // Get the path after /backend-api/
  const url = new URL(request.url)
  // Forward the path as received. We used to append a trailing slash here, on the theory
  // that FastAPI wants one — but only 76 of the backend's 346 routes are declared with a
  // slash. For the other 270 the append bought a guaranteed 307 plus a second request for
  // every single call, which the redirect-following below then silently absorbed: the edge
  // logs for the demo backend showed exactly 48x 307 and 48x 200 for 48 status polls.
  // Requests arrive here already stripped of any trailing slash (Next 308s them away), so
  // sending the path unchanged is the right default; the minority of slash-declared routes
  // still redirect once and are picked up by the loop below.
  const targetPath = url.pathname.replace('/backend-api', '')
  const targetUrl = `${backendUrl}${targetPath}${url.search}`

  // Get cookies from the request
  const cookieStore = await cookies()
  const accessToken = cookieStore.get('access_token')?.value
  const refreshToken = cookieStore.get('refresh_token')?.value

  // Fallback to raw header if cookies() doesn't work
  const rawCookie = request.headers.get('cookie')

  // Debug: Log cookie *presence* only (never values) for all requests
  debug(`[API Proxy] ${request.method} ${targetPath} | cookies(): access=${!!accessToken} refresh=${!!refreshToken} | raw: ${!!rawCookie}`)

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
    debug(`[API Proxy] WARNING: No cookies found for ${targetPath}`)
  }

  // Forward other headers (excluding problematic ones)
  // Skip content-length: fetch auto-sets it from the body (Blob)
  //
  // The x-forwarded-* headers are dropped rather than relayed: this route used to pass the
  // browser's copy straight through, and the backend keyed its login throttle, its request
  // rate limit and the audit log's IP attribution on it. Sending one header was enough to
  // pick your own address for all three. The backend now reads the entry its own outermost
  // proxy appended (middleware/rate_limit.client_ip), and not forwarding a client-supplied
  // value keeps this hop from muddying that chain.
  const skipHeaders = [
    'host',
    'cookie',
    'connection',
    'content-length',
    'x-forwarded-for',
    'x-forwarded-host',
    'x-forwarded-proto',
    'x-real-ip',
  ]
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

    // Follow redirects manually to preserve method, cookies, and enforce HTTPS
    let response = await fetch(targetUrl, {
      method: request.method,
      headers,
      body,
      redirect: 'manual',
    })

    // Follow up to 3 redirects (handles FastAPI trailing-slash + HTTP→HTTPS chains)
    let redirectCount = 0
    while ([301, 302, 307, 308].includes(response.status) && redirectCount < 3) {
      let location = response.headers.get('location')
      if (!location) break
      // Match the redirect to the scheme we actually reached the backend with. Railway's
      // edge terminates TLS, so its backend emits http:// Location headers for a request
      // that arrived over https — but forcing https unconditionally breaks a self-hosted
      // stack, where the backend is plain HTTP on the compose network and the upgraded URL
      // means a TLS handshake against a cleartext port (ERR_SSL_WRONG_VERSION_NUMBER).
      // FastAPI's trailing-slash redirect makes this the common path, not an edge case.
      if (targetUrl.startsWith('https://')) {
        location = location.replace(/^http:\/\//, 'https://')
      }
      debug(`[API Proxy] Following ${response.status} redirect to: ${location}`)
      response = await fetch(location, {
        method: request.method,
        headers,
        body,
        redirect: 'manual',
      })
      redirectCount++
    }

    // Debug: Log backend response status (presence of a cookie header only — never its value)
    if (response.status === 401) {
      debug(`[API Proxy] Backend returned 401 for ${targetPath} - cookie header sent: ${headers.has('Cookie')}`)
    }

    // Build response headers
    const responseHeaders = new Headers()

    // Forward Set-Cookie headers (log count only — values contain session tokens)
    const responseCookies = response.headers.getSetCookie()
    if (responseCookies.length > 0) {
      debug(`[API Proxy] Set-Cookie from backend for ${targetPath}: ${responseCookies.length} cookie(s)`)
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
  debug('[API Proxy] POST handler called:', request.url)
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
