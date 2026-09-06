import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/env', () => ({
  getApiUrl: () => 'http://test-backend',
}))

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), dismiss: vi.fn() }),
}))

import { apiClient, NetworkError } from './api-client'

describe('apiClient network failures', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('rejects mutations with NetworkError when the server is unreachable', async () => {
    // Regression: the client resolved `undefined` on final network failure,
    // so mutation callers' catch (rollback/toast/refresh) never ran and the
    // optimistic UI kept claiming success (audit item C2).
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    const promise = apiClient.updateIncident('some-id', { priority: 'high' })
    const assertion = expect(promise).rejects.toBeInstanceOf(NetworkError)
    await vi.runAllTimersAsync() // burn through retry backoff sleeps
    await assertion
  })

  it('resolves GETs to undefined when the server is unreachable (soft degrade for polling)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    const promise = apiClient.getIncidents('event-id')
    await vi.runAllTimersAsync()
    await expect(promise).resolves.toBeUndefined()
  })

  it('still resolves successful mutations with the response body', async () => {
    const body = { id: 'some-id', priority: 'high' }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      )
    )

    await expect(apiClient.updateIncident('some-id', { priority: 'high' })).resolves.toEqual(body)
  })
})

describe('field device logout', () => {
  afterEach(() => vi.unstubAllGlobals())

  it.each([204, 401])('accepts %s without expiring an interactive user session', async (status) => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status }))
    vi.stubGlobal('fetch', fetch)
    const dispatch = vi.spyOn(window, 'dispatchEvent')
    await expect(apiClient.logoutFeld('a/b?c')).resolves.toBeUndefined()
    expect(fetch).toHaveBeenCalledWith('http://test-backend/api/feld/logout?token=a%2Fb%3Fc', expect.objectContaining({ method: 'POST' }))
    expect(dispatch.mock.calls.some(([event]) => event.type === 'kp:session-expired')).toBe(false)
  })

  it('rejects a lost connection so the page keeps its credential', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Load failed')))
    await expect(apiClient.logoutFeld('bound-token')).rejects.toBeInstanceOf(NetworkError)
  })

  it('does not treat a server failure as revocation', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 503 })))
    await expect(apiClient.logoutFeld('bound-token')).rejects.toMatchObject({ status: 503 })
  })
})
