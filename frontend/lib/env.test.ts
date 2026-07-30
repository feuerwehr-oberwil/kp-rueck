/**
 * How the browser addresses the backend and the tile server.
 *
 * This is the code that decides whether a deployment works at all, and it can't be covered
 * by booting the stack in CI because it depends on the hostname the page is served from.
 * KP Rück was Railway-only for a long time and these helpers still carry that shape, so the
 * cases below are written as deployment topologies, not as branches.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  getApiUrl,
  getTileBaseUrl,
  getWsUrl,
  publicBackendOrigin,
  setRuntimeBackendOrigin,
} from './env'

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
  // The runtime origin is module state, set once per page load by the root layout.
  setRuntimeBackendOrigin(null)
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

describe('the runtime backend origin (API_URL, handed down by the root layout)', () => {
  it('is what a custom Railway domain connects to — the case every guess got wrong', () => {
    noBuildTimeEnv()
    setRuntimeBackendOrigin('https://kp-api.feuerwehr-musterhausen.ch')
    servedFrom('https://kp.feuerwehr-musterhausen.ch/')
    // Neither localhost nor *.up.railway.app, so this used to fall through to same-origin,
    // where nothing listens for /socket.io: no socket, no error, permanent 5s polling.
    expect(getWsUrl()).toBe('wss://kp-api.feuerwehr-musterhausen.ch')
  })

  it('outranks both build-time variables, which tie an image to one station', () => {
    noBuildTimeEnv()
    vi.stubEnv('NEXT_PUBLIC_WS_URL', 'wss://baked-in.example.org')
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://also-baked-in.example.org')
    setRuntimeBackendOrigin('https://kp-api.feuerwehr-musterhausen.ch')
    servedFrom('https://kp.feuerwehr-musterhausen.ch/')
    expect(getWsUrl()).toBe('wss://kp-api.feuerwehr-musterhausen.ch')
  })

  it('ignores a backend only reachable inside the container network', () => {
    // The compose stack sets API_URL=http://backend:8000. Handing that to the browser would
    // swap one silent failure for another, so it must stay on the same-origin path.
    expect(publicBackendOrigin('http://backend:8000')).toBeNull()
    expect(publicBackendOrigin('http://kp-rueck-backend.railway.internal:8000')).toBeNull()

    noBuildTimeEnv()
    setRuntimeBackendOrigin('http://backend:8000')
    servedFrom('https://einsatz.feuerwehr-musterdorf.ch/')
    expect(getWsUrl()).toBe('wss://einsatz.feuerwehr-musterdorf.ch')
  })

  it('accepts an address the browser can actually reach, and keeps only the origin', () => {
    expect(publicBackendOrigin('https://kp-rueck-api.up.railway.app')).toBe(
      'https://kp-rueck-api.up.railway.app'
    )
    expect(publicBackendOrigin('http://localhost:8000')).toBe('http://localhost:8000')
    expect(publicBackendOrigin('https://kp-api.example.ch/api/')).toBe('https://kp-api.example.ch')
  })

  it('treats an unset or unusable API_URL as no answer at all', () => {
    expect(publicBackendOrigin(undefined)).toBeNull()
    expect(publicBackendOrigin('')).toBeNull()
    expect(publicBackendOrigin('   ')).toBeNull()
    expect(publicBackendOrigin('kp-api.example.ch')).toBeNull()
    expect(publicBackendOrigin('ftp://kp-api.example.ch')).toBeNull()
  })

  it('leaves local development exactly as it was when nothing is configured', () => {
    noBuildTimeEnv()
    setRuntimeBackendOrigin(undefined)
    servedFrom('http://localhost:3000/')
    expect(getWsUrl()).toBe('ws://localhost:8000')
  })
})

describe('build-time overrides, for a station that builds its own image', () => {
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
