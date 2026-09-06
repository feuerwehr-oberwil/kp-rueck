/**
 * API Route to proxy requests to the backend.
 * Using API routes instead of middleware for more reliable cookie handling.
 */
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { PROXY_TIMEOUT_MS, ProxyRequestError, readProxyBody } from '@/lib/proxy-body'

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

  // Build headers
  const headers = new Headers()

  // Preserve every cookie, including SSO browser proof alongside existing sessions.
  const cookieHeader = request.headers.get('cookie')
    ?? (await cookies()).getAll().map(({ name, value }) => `${name}=${value}`).join('; ')
  if (cookieHeader) {
    headers.set('Cookie', cookieHeader)
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
    'transfer-encoding',
    'keep-alive',
    'te',
    'trailer',
    'upgrade',
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

  const controller = new AbortController()
  const abort = () => controller.abort(request.signal.reason)
  request.signal.addEventListener('abort', abort, { once: true })
  if (request.signal.aborted) abort()
  const timeout = setTimeout(() => {
    controller.abort(new DOMException('Proxy timed out', 'TimeoutError'))
    request.signal.removeEventListener('abort', abort)
  }, PROXY_TIMEOUT_MS)
  const cleanup = () => {
    clearTimeout(timeout)
    request.signal.removeEventListener('abort', abort)
  }
  let releaseBody = () => {}
  let streaming = false

  try {
    const buffered = await readProxyBody(request, controller.signal)
    releaseBody = buffered.release
    const body = buffered.body

    // Follow redirects manually to preserve method, cookies, and enforce HTTPS
    let response = await fetch(targetUrl, {
      method: request.method,
      headers,
      body,
      redirect: 'manual',
      signal: controller.signal,
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
      // Never forward credentials/body to a different origin through a redirect.
      const redirectUrl = new URL(location, targetUrl)
      if (redirectUrl.origin !== new URL(targetUrl).origin) {
        await response.body?.cancel()
        throw new ProxyRequestError(502, 'Invalid backend redirect')
      }
      await response.body?.cancel()
      debug(`[API Proxy] Following ${response.status} redirect`)
      response = await fetch(redirectUrl, {
        method: request.method,
        headers,
        body,
        redirect: 'manual',
        signal: controller.signal,
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

    // fetch decompresses upstream bodies. Their wire length no longer describes the
    // stream we return; let Next/Caddy frame it instead of truncating the decoded body.
    response.headers.forEach((value, key) => {
      const lowerKey = key.toLowerCase()
      if (!['content-encoding', 'content-length', 'transfer-encoding', 'set-cookie'].includes(lowerKey)) {
        responseHeaders.set(key, value)
      }
    })

    // Prevent caching
    responseHeaders.set('Cache-Control', 'no-store, no-cache, must-revalidate')

    // Keep cancellation/deadline active while downloads stream to the caller.
    const reader = response.body?.getReader()
    const responseBody = reader ? new ReadableStream<Uint8Array>({
      async pull(stream) {
        try {
          const { done, value } = await reader.read()
          if (done) {
            cleanup()
            stream.close()
          } else {
            stream.enqueue(value)
          }
        } catch (error) {
          cleanup()
          stream.error(error)
        }
      },
      async cancel(reason) {
        controller.abort(reason)
        cleanup()
        await reader.cancel(reason)
      },
    }) : null
    const result = new NextResponse(responseBody, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    })
    streaming = responseBody !== null
    return result
  } catch (error) {
    if (error instanceof ProxyRequestError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    if (controller.signal.aborted) {
      const status = request.signal.aborted ? 499 : 504
      return NextResponse.json({ error: status === 499 ? 'Request cancelled' : 'Backend timed out' }, { status })
    }
    // Errors can contain a URL with a share token; do not log the exception object.
    console.error('[API Proxy] Backend request failed')
    return NextResponse.json({ error: 'Proxy failed' }, { status: 502 })
  } finally {
    releaseBody()
    if (!streaming) cleanup()
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
