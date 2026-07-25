import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The reporter's job is to be boring: post once per distinct error, stop after a while, and
 * never make things worse. All three are tested here because all three fail silently — a
 * reporter that floods, or that throws inside a crash handler, only shows up in production.
 *
 * Module state (the dedupe set, the counter) is per-import, so each test re-imports.
 */

async function freshModule() {
  vi.resetModules()
  return import('./report-error')
}

const originalFetch = globalThis.fetch

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
})

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.unstubAllGlobals()
})

describe('reportClientError', () => {
  it('posts the sanitisable fields to the station’s own backend', async () => {
    const { reportClientError } = await freshModule()
    reportClientError(new Error('boom'), { kind: 'render' })

    expect(fetch).toHaveBeenCalledOnce()
    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toContain('/api/diag/client-error')
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.kind).toBe('render')
    expect(body.message).toBe('boom')
    // credentials + keepalive: the report has to survive the reload that usually follows a
    // crash, and has to carry the session so the server can attribute it.
    expect((init as RequestInit).keepalive).toBe(true)
    expect((init as RequestInit).credentials).toBe('include')
  })

  it('reports the same error once, however many times it fires', async () => {
    const { reportClientError } = await freshModule()
    const err = new Error('same')
    for (let i = 0; i < 50; i++) reportClientError(err, { kind: 'render' })

    // A render loop throwing identically is one bug, not fifty. Without this, the first
    // crash loop fills the deployer's log with the same line.
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('stops after the per-session cap even for distinct errors', async () => {
    const { reportClientError } = await freshModule()
    for (let i = 0; i < 60; i++) reportClientError(new Error(`distinct ${i}`))

    expect(vi.mocked(fetch).mock.calls.length).toBeLessThanOrEqual(20)
  })

  it('never throws, whatever it is handed', async () => {
    const { reportClientError } = await freshModule()
    // Called from componentDidCatch and from window.onerror — throwing here would replace a
    // recoverable crash with an unrecoverable one.
    expect(() => reportClientError(undefined)).not.toThrow()
    expect(() => reportClientError(null)).not.toThrow()
    expect(() => reportClientError({ weird: true })).not.toThrow()
    expect(() => reportClientError('a string')).not.toThrow()
  })

  it('swallows a failing fetch instead of surfacing an unhandled rejection', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    const { reportClientError } = await freshModule()

    // An unhandled rejection here would be caught by the very listener this module installs,
    // which is a loop. The .catch() in the module is what stops it.
    expect(() => reportClientError(new Error('boom'))).not.toThrow()
    await Promise.resolve()
  })
})
