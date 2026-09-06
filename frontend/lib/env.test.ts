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
  buildContentSecurityPolicy,
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
    // `port` included deliberately: a real window.location has one, and leaving it undefined
    // made every stub look like it was served from the default port. getTileBaseUrl() reads it
    // to tell the dev server (:3000) apart from a compose stack on :8080.
    value: {
      hostname: url.hostname,
      origin: url.origin,
      href: url.href,
      protocol: url.protocol,
      port: url.port,
    },
  })
}

/** No build-time NEXT_PUBLIC_* – how the published image is built. */
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
    // labels, producing wss://einsatz-api.feuerwehr-musterdorf.ch – a host that does not
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

describe('production builds on arbitrary ports', () => {
  it.each([
    ['http://localhost:3000/', 'ws://localhost:3000'],
    ['http://127.0.0.1:8080/', 'ws://127.0.0.1:8080'],
    ['http://192.168.1.50:8080/', 'ws://192.168.1.50:8080'],
    ['https://localhost/', 'wss://localhost'],
  ])('uses the deployment origin at %s', (pageUrl, socketUrl) => {
    noBuildTimeEnv()
    vi.stubEnv('NODE_ENV', 'production')
    setRuntimeBackendOrigin('http://backend:8000')
    servedFrom(pageUrl)
    expect(getApiUrl()).toBe('/backend-api')
    expect(getWsUrl()).toBe(socketUrl)
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
  it('is what a custom Railway domain connects to – the case every guess got wrong', () => {
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

  it('does not mistake the compose stack on localhost for the dev server', () => {
    // A station running docker compose on one box and opening the board on that same box.
    // The old hostname-only check sent tiles to http://localhost:8080/styles/… – which is
    // Caddy, which routes everything that is not /api, /socket.io or /tiles to the frontend.
    // Offline tiles 404'd and the map went blank, while the same stack reached by LAN IP was
    // fine. Only the dev server's port 3000 means "talk to the tileserver container direct".
    noBuildTimeEnv()
    servedFrom('http://localhost:8080/')
    expect(getApiUrl()).toBe('/backend-api')
    expect(getWsUrl()).toBe('ws://localhost:8080')
    expect(getTileBaseUrl()).toBe('/tiles')
  })
})

/**
 * The Content-Security-Policy, which `middleware.ts` composes on every document request.
 *
 * A test cannot read a live response header here – that would need a running server – so the
 * check happens at the seam instead: the header is a pure function of four environment values,
 * and the cases below are the deployment shapes it has to get right. The `connect-src` ones are
 * the point of the exercise; the last is a tripwire, so a later edit cannot quietly drop
 * `frame-ancestors` while nobody is looking.
 */
describe('the Content-Security-Policy header', () => {
  /** Pull one directive out of the assembled header. */
  function directive(csp: string, name: string): string {
    const found = csp.split('; ').find((d) => d === name || d.startsWith(`${name} `))
    if (!found) throw new Error(`no ${name} directive in: ${csp}`)
    return found
  }

  /** The sources of `connect-src`, without the directive name. */
  function connectSrc(env: Parameters<typeof buildContentSecurityPolicy>[0]): string[] {
    return directive(buildContentSecurityPolicy(env), 'connect-src').split(' ').slice(1)
  }

  it('names no backend of its own when nothing is configured', () => {
    // The published image on the compose stack, served from ONE origin: 'self' already covers
    // the API, the tiles and – per CSP3 – the same-origin WebSocket.
    const sources = connectSrc({})
    expect(sources).toContain("'self'")
    expect(sources).toContain('http://localhost:8000')
    expect(sources).toContain('https://*.railway.app')
    expect(sources).toContain('wss://*.railway.app')
    expect(sources).toContain('ws://localhost:*')
    expect(sources).toContain('http://localhost:8080')
    expect(sources).not.toContain('https://nominatim.openstreetmap.org')
    expect(sources).toContain('https://*.tile.openstreetmap.org')
    expect(sources).toContain('https://*.basemaps.cartocdn.com')
    expect(sources).toContain('https://server.arcgisonline.com')
    expect(sources.filter((s) => s.startsWith('wss://'))).toEqual(['wss://*.railway.app'])
  })

  it('withholds an API_URL the browser cannot resolve', () => {
    // docker-compose sets exactly this. A Docker service name in connect-src would put a host
    // in the policy that no browser can look up – the trap publicBackendOrigin() exists for,
    // and the reason this reuses that filter rather than restating the rule.
    expect(connectSrc({ apiUrl: 'http://backend:8000' })).toEqual(connectSrc({}))
    expect(connectSrc({ apiUrl: 'http://backend.railway.internal:8000' })).toEqual(connectSrc({}))
  })

  it('names a runtime API_URL as both an https and a wss origin', () => {
    // The case the whole change exists for: a split-origin deployment on a custom backend
    // domain, running the published image – which is built without any NEXT_PUBLIC_* variable.
    const sources = connectSrc({ apiUrl: 'https://kp-api.fwo.li' })
    expect(sources).toContain('https://kp-api.fwo.li')
    expect(sources).toContain('wss://kp-api.fwo.li')
  })

  it('still honours NEXT_PUBLIC_API_URL, and never lists a host twice', () => {
    // This change removes the *requirement* to set it, not the option.
    const both = connectSrc({
      apiUrl: 'https://kp-api.fwo.li',
      publicApiUrl: 'https://kp-api.fwo.li',
    })
    expect(both.filter((s) => s === 'https://kp-api.fwo.li')).toHaveLength(1)
    expect(both.filter((s) => s === 'wss://kp-api.fwo.li')).toHaveLength(1)

    expect(
      connectSrc({ apiUrl: 'https://kp-api.fwo.li', publicApiUrl: 'https://alt.example.org' }),
    ).toEqual(
      expect.arrayContaining([
        'https://kp-api.fwo.li',
        'wss://kp-api.fwo.li',
        'https://alt.example.org',
        'wss://alt.example.org',
      ]),
    )
  })

  it('honours NEXT_PUBLIC_WS_URL, which the build-time policy never did', () => {
    // A latent hole in the old header: getWsUrl() has always read this variable, but only
    // NEXT_PUBLIC_API_URL ever reached connect-src – so setting just this one aimed the socket
    // correctly and had the browser refuse it anyway.
    expect(connectSrc({ publicWsUrl: 'wss://ws.example.org' })).toContain('wss://ws.example.org')
    // The hostname rule reaches this value too, through the same filter.
    expect(connectSrc({ publicWsUrl: 'ws://backend:8000' })).toEqual(connectSrc({}))
  })

  it('leaves every other directive exactly as it was', () => {
    const csp = buildContentSecurityPolicy({ apiUrl: 'https://kp-api.fwo.li', isProduction: true })
    expect(directive(csp, 'default-src')).toBe("default-src 'self'")
    expect(directive(csp, 'script-src')).toBe("script-src 'self' 'unsafe-inline'")
    expect(directive(csp, 'style-src')).toBe("style-src 'self' 'unsafe-inline'")
    expect(directive(csp, 'font-src')).toBe("font-src 'self' data: http://localhost:8080")
    expect(directive(csp, 'frame-ancestors')).toBe("frame-ancestors 'none'")
    expect(directive(csp, 'form-action')).toBe("form-action 'self'")
    expect(directive(csp, 'base-uri')).toBe("base-uri 'self'")
    expect(directive(csp, 'object-src')).toBe("object-src 'none'")
  })

  it('names the backend in img-src, because the photos are served from it', () => {
    // The bug this covers: the backend was in connect-src and not in img-src, so a rapport
    // photo's <img> was refused by the policy while every fetch to the same host succeeded.
    const csp = buildContentSecurityPolicy({ apiUrl: 'https://kp-api.fwo.li', isProduction: true })
    expect(directive(csp, 'img-src')).toBe(
      "img-src 'self' data: blob: http://localhost:8000 https://kp-api.fwo.li " +
        'https://*.tile.openstreetmap.org https://tile.openstreetmap.org ' +
        'https://*.basemaps.cartocdn.com https://server.arcgisonline.com http://localhost:8080',
    )
    // And only the http half – a wss origin in img-src would be noise.
    expect(directive(csp, 'img-src')).not.toContain('wss://')
  })

  it('lets MapLibre spawn its tile worker from a blob URL', () => {
    // Without these the GL map never initialises: `default-src 'self'` refuses the blob: worker
    // and the only symptom in the field is an empty canvas – no error the operator can report.
    const csp = buildContentSecurityPolicy({ isProduction: true })
    expect(directive(csp, 'worker-src')).toBe("worker-src 'self' blob:")
    expect(directive(csp, 'child-src')).toBe('child-src blob:')
  })

  it('adds unsafe-eval only outside production, for the dev hot reload', () => {
    expect(directive(buildContentSecurityPolicy({}), 'script-src')).toBe(
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    )
  })

  it('never falls back to a wildcard', () => {
    // The easy way out of this problem would have been `connect-src *` or a blanket `wss:`.
    const sources = connectSrc({ apiUrl: 'https://kp-api.fwo.li' })
    for (const wildcard of ['*', 'wss:', 'ws:', 'https:', 'http:']) {
      expect(sources).not.toContain(wildcard)
    }
  })
})
