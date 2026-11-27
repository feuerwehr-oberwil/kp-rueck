// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from './route'

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  vi.stubEnv('API_URL', 'http://backend:8000')
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('GET /ready (the demo wake page polls it from kp-rueck.ch)', () => {
  it('is ready only when the backend reports a reachable database', async () => {
    fetchMock.mockResolvedValue(new Response('{"status":"healthy"}', { status: 200 }))
    const response = await GET()
    expect(fetchMock.mock.calls[0][0]).toBe('http://backend:8000/health')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ready: true })
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
  })

  it.each([
    ['the database is down', () => Promise.resolve(new Response('{}', { status: 503 }))],
    ['the backend is still booting', () => Promise.reject(new TypeError('fetch failed'))],
  ])('answers 503 when %s', async (_, backend) => {
    fetchMock.mockImplementation(backend)
    const response = await GET()
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ ready: false })
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
  })
})
