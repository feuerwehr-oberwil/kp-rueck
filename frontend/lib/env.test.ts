/**
 * How the browser addresses the backend and the tile server.
 *
 * This is the code that decides whether a deployment works at all, and it can't be covered
 * by booting the stack in CI because it depends on the hostname the page is served from.
 * KP Rück was Railway-only for a long time and these helpers still carry that shape, so the
 * cases below are written as deployment topologies, not as branches.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { getApiUrl, getTileBaseUrl, getWsUrl } from './env'

/** Pretend the page is served from `href`. Only hostname/origin are read. */
function servedFrom(href: string) {
  const url = new URL(href)
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { hostname: url.hostname, origin: url.origin, href: url.href, protocol: url.protocol },
  })
}

/** No build-time NEXT_PUBLIC_* — how the published image is built. */
function noBuildTimeEnv() {
  vi.stubEnv('NEXT_PUBLIC_API_URL', '')
  vi.stubEnv('NEXT_PUBLIC_WS_URL', '')
  vi.stubEnv('NEXT_PUBLIC_TILE_URL', '')
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('self-hosted behind one origin (the docker-compose stack)', () => {
  it('reaches the API through the same-origin proxy path', () => {
    noBuildTimeEnv()
    servedFrom('https://einsatz.feuerwehr-musterdorf.ch/')
    expect(getApiUrl()).toBe('/backend-api')
  })

  it('opens the WebSocket on its own origin, not a guessed hostname', () => {
    noBuildTimeEnv()
    servedFrom('https://einsatz.feuerwehr-musterdorf.ch/')
    // Regression: the Railway naming convention used to be applied to ANY host with 3+
    // labels, producing wss://einsatz-api.feuerwehr-musterdorf.ch — a host that does not
    // exist, so live board updates never connected on a self-hosted deployment.
    expect(getWsUrl()).toBe('wss://einsatz.feuerwehr-musterdorf.ch')
  })

  it('keeps ws:// on a plain-HTTP LAN install', () => {
    noBuildTimeEnv()
    servedFrom('http://192.168.1.50:8080/')
    // Hardcoding wss:// here would fail the handshake on a station LAN with no TLS.
    expect(getWsUrl()).toBe('ws://192.168.1.50:8080')
  })

  it('loads offline tiles from its own origin', () => {
    noBuildTimeEnv()
    servedFrom('https://einsatz.feuerwehr-musterdorf.ch/')
    expect(getTileBaseUrl()).toBe('/tiles')
  })
})

describe('Railway (frontend and backend on separate hostnames)', () => {
  it('addresses the backend service by naming convention', () => {
    noBuildTimeEnv()
    servedFrom('https://kp-rueck-demo.up.railway.app/')
    expect(getWsUrl()).toBe('wss://kp-rueck-demo-api.up.railway.app')
  })
})

describe('explicit configuration always wins', () => {
  it('honours NEXT_PUBLIC_WS_URL', () => {
    noBuildTimeEnv()
    vi.stubEnv('NEXT_PUBLIC_WS_URL', 'wss://ws.example.org')
    servedFrom('https://einsatz.feuerwehr-musterdorf.ch/')
    expect(getWsUrl()).toBe('wss://ws.example.org')
  })

  it('derives the WebSocket URL from NEXT_PUBLIC_API_URL', () => {
    noBuildTimeEnv()
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.example.org')
    servedFrom('https://einsatz.feuerwehr-musterdorf.ch/')
    expect(getWsUrl()).toBe('wss://api.example.org')
  })
})

describe('local development', () => {
  it('talks to the backend and tileserver containers directly', () => {
    noBuildTimeEnv()
    servedFrom('http://localhost:3000/')
    expect(getApiUrl()).toBe('http://localhost:8000')
    expect(getWsUrl()).toBe('ws://localhost:8000')
    expect(getTileBaseUrl()).toBe('http://localhost:8080')
  })
})
