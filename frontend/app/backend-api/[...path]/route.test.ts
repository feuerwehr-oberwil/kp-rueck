// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { gzipSync } from 'node:zlib'
import { MAX_PROXY_BODY_BYTES, PROXY_TIMEOUT_MS } from '@/lib/proxy-body'
import { GET, POST } from './route'

const cookieValues = vi.hoisted(() => new Map<string, string>())
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => cookieValues.has(name) ? { name, value: cookieValues.get(name) } : undefined,
    getAll: () => Array.from(cookieValues, ([name, value]) => ({ name, value })),
  }),
}))

const fetchMock = vi.fn<typeof fetch>()

function post(body: BodyInit, headers?: HeadersInit, signal?: AbortSignal) {
  return new NextRequest('https://station.example/backend-api/api/test', {
    method: 'POST', body, headers, signal,
  })
}

beforeEach(() => {
  vi.stubEnv('API_URL', 'http://backend:8000')
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  cookieValues.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe('bounded API proxy', () => {
  it.each(['header', 'cookie store'] as const)('forwards SSO browser proof with existing session cookies from the %s', async (source) => {
    cookieValues.set('access_token', 'expired-access')
    cookieValues.set('refresh_token', 'existing-refresh')
    cookieValues.set('microsoft_login_browser', 'transaction-proof')
    const cookieHeader = Array.from(cookieValues, ([name, value]) => `${name}=${value}`).join('; ')
    fetchMock.mockResolvedValue(new Response('signed in'))
    const response = await POST(post('callback', source === 'header' ? { cookie: cookieHeader } : undefined))
    expect(await response.text()).toBe('signed in')
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get('cookie')).toBe(cookieHeader)
  })

  it('rejects oversized Content-Length before reading or contacting the backend', async () => {
    const response = await POST(post('tiny', { 'content-length': String(MAX_PROXY_BODY_BYTES + 1) }))
    expect(response.status).toBe(413)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('counts chunked bodies rather than trusting a missing Content-Length', async () => {
    let reads = 0
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({
      pull(stream) {
        reads++
        stream.enqueue(new Uint8Array(1024 * 1024))
      },
      cancel,
    })
    const response = await POST(post(body))
    expect(response.status).toBe(413)
    expect(reads).toBeLessThanOrEqual(34)
    expect(cancel).toHaveBeenCalledOnce()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('preserves binary uploads, strips hop headers and replays a same-origin redirect', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, {
      status: 307, headers: { location: '/api/test/' },
    })).mockResolvedValueOnce(new Response('saved', { headers: { 'set-cookie': 'access_token=opaque; HttpOnly' } }))
    const response = await POST(post(new Uint8Array([0, 255, 128]), {
      'content-type': 'application/octet-stream',
      'transfer-encoding': 'chunked',
      'x-forwarded-for': 'attacker',
    }))
    expect(await response.text()).toBe('saved')
    expect(response.headers.get('set-cookie')).toContain('HttpOnly')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    for (const [, options] of fetchMock.mock.calls) {
      expect(new Headers(options?.headers).has('transfer-encoding')).toBe(false)
      expect(new Headers(options?.headers).has('x-forwarded-for')).toBe(false)
      expect(new Uint8Array(await new Response(options?.body).arrayBuffer())).toEqual(new Uint8Array([0, 255, 128]))
    }
    expect(String(fetchMock.mock.calls[1][0])).toBe('http://backend:8000/api/test/')
  })

  it('does not send cookies or an upload to a cross-origin redirect', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 307, headers: { location: 'https://other.example/' } }))
    expect((await POST(post('payload', { cookie: 'access_token=opaque' }))).status).toBe(502)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('cancels a stalled upload at its deadline before contacting the backend', async () => {
    vi.useFakeTimers()
    const cancel = vi.fn()
    const result = POST(post(new ReadableStream({ cancel })))
    await vi.advanceTimersByTimeAsync(PROXY_TIMEOUT_MS)
    expect((await result).status).toBe(504)
    expect(cancel).toHaveBeenCalledOnce()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(['deadline', 'disconnect'] as const)('aborts a slow upstream on %s', async (reason) => {
    vi.useFakeTimers()
    const abort = new AbortController()
    let upstreamSignal: AbortSignal | null | undefined
    fetchMock.mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      upstreamSignal = options?.signal
      upstreamSignal?.addEventListener('abort', () => reject(upstreamSignal?.reason), { once: true })
    }))
    const result = POST(post('small upload', undefined, abort.signal))
    await vi.advanceTimersByTimeAsync(0)
    if (reason === 'disconnect') abort.abort()
    else await vi.advanceTimersByTimeAsync(PROXY_TIMEOUT_MS)
    expect((await result).status).toBe(reason === 'disconnect' ? 499 : 504)
    expect(upstreamSignal?.aborted).toBe(true)
  })

  it('keeps cancellation connected while streaming the backend response', async () => {
    const cancel = vi.fn()
    fetchMock.mockResolvedValue(new Response(new ReadableStream({ cancel })))
    const response = await GET(new NextRequest('https://station.example/backend-api/api/download'))
    await response.body?.cancel()
    expect(cancel).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true)
  })

  it('streams a real gzip upstream response without its stale compressed length', async () => {
    vi.unstubAllGlobals() // Use Node fetch, including its actual decompression behavior.
    const payload = { message: 'Synthetic response '.repeat(200) }
    const encoded = gzipSync(JSON.stringify(payload))
    const upstream = createServer((_request, response) => {
      response.writeHead(200, {
        'content-type': 'application/json',
        'content-encoding': 'gzip',
        'content-length': encoded.byteLength,
      })
      response.end(encoded)
    })
    upstream.listen(0, '127.0.0.1')
    await once(upstream, 'listening')
    try {
      const address = upstream.address()
      if (!address || typeof address === 'string') throw new Error('No test HTTP listener')
      vi.stubEnv('API_URL', `http://127.0.0.1:${address.port}`)
      const response = await GET(new NextRequest('https://station.example/backend-api/api/test'))
      expect(response.headers.has('content-encoding')).toBe(false)
      expect(response.headers.has('content-length')).toBe(false)
      expect(await response.json()).toEqual(payload)
    } finally {
      await new Promise<void>((resolve, reject) => {
        upstream.close(error => error ? reject(error) : resolve())
        upstream.closeAllConnections()
      })
    }
  })
})
