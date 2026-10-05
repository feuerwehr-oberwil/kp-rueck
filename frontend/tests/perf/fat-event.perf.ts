import { loadavg } from 'node:os'
import { test, request as pwRequest, type APIRequestContext, type APIResponse, type Page } from '@playwright/test'
import { io, type Socket } from 'socket.io-client'
import { FAT_PRESETS, actionMix, fatEvent, type FatAction, type FatEvent, type FatPreset, type FatResource } from '../../test-utils/fat-event'
// the app's own reload scheduler: a simulated device reloads exactly as the board does
import { ReloadScheduler } from '../../lib/reload-scheduler'
import { DEV_ADMIN_PASSWORD, DEV_ADMIN_USERNAME } from '../constants'

// How a LARGE or LONG Ereignis behaves end to end. This is a measurement, not a check. It plays
// a fat Ereignis (test-utils/fat-event, calibrated against real user actions on prod) into a real
// backend while simulated devices follow it the way every open board does. Then it opens the
// board and the map in a CPU-throttled browser. It prints a report and asserts nothing beyond
// «it ran».
//
//   just fat-perf large        # throwaway Postgres + built app + this spec, then cleans up
//
// Needs a THROWAWAY deployment: it tops the roster up and leaves a big Ereignis behind.
// The CPU throttle only exists in Chromium, so the project runs there alone.

const PRESET = process.env.FAT_PRESET as FatPreset | undefined
/** tablet ≈ 4–6× slower than a dev laptop */
const CPU_THROTTLE = Number(process.env.FAT_CPU ?? 4)
/** seconds of «real peak» load after the build-up: the record's write peak, × scale */
const STEADY_SECONDS = Number(process.env.FAT_STEADY ?? 60)
const API = process.env.API_BASE_URL || 'http://localhost:8000'

test.skip(!PRESET, 'measurement only: run through `just fat-perf <preset>`')
if (PRESET && !(PRESET in FAT_PRESETS)) throw new Error(`FAT_PRESET: unknown preset «${PRESET}» (${Object.keys(FAT_PRESETS).join(', ')})`)
test.describe.configure({ mode: 'serial' })
test.setTimeout(60 * 60_000)

const ms = (n: number) => (Number.isFinite(n) ? `${Math.round(n)} ms` : '–')
const kb = (n: number) => (n > 4 * 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`)
const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? NaN }
const p5095 = (xs: number[]) => `${ms(pct(xs, 50))}/${ms(pct(xs, 95))}`
const sleep = (n: number) => new Promise((r) => setTimeout(r, n))
// eslint-disable-next-line no-console -- the report IS the output
const line = (s: string) => { console.log(s) }

async function ok(res: APIResponse, what: string) {
  if (!res.ok()) throw new Error(`${what}: HTTP ${res.status()} ${(await res.text()).slice(0, 300)}`)
  return res
}
async function timed<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const t = performance.now()
  const v = await fn()
  return [v, performance.now() - t]
}

/** The board's load, request for request (`operations-context.tsx · loadData`). */
function boardLoad(eventId: string) {
  return {
    version: `/api/incidents/sync-version?event_id=${eventId}`,
    wave1: [
      `/api/incidents/?event_id=${eventId}`,
      '/api/personnel/',
      '/api/materials/',
      '/api/settings/',
      '/api/vehicles/',
      `/api/events/${eventId}/restliste`,
    ],
    wave2: [
      `/api/events/${eventId}/special-functions/`,
      `/api/assignments/by-event/${eventId}`,
      `/api/reko/event/${eventId}/summaries`,
    ],
  }
}

let fat: FatEvent
let eventId: string
let eventName: string
let storageState: Awaited<ReturnType<APIRequestContext['storageState']>>

/**
 * One open board on another device: a socket on the `operations` room, and on every push the
 * full board load, debounced and single-flight exactly as the board's ReloadScheduler does it.
 * Plus the side polls every open board makes (Aufträge every 5 s, notifications every 10 s).
 */
async function device(eventId: string, stats: DeviceStats) {
  const api = await pwRequest.newContext({ baseURL: API, storageState })
  const load = boardLoad(eventId)
  const reload = async () => {
    const t = performance.now()
    try {
      await api.get(load.version)
      const r1 = await Promise.all(load.wave1.map((u) => api.get(u)))
      const r2 = await Promise.all(load.wave2.map((u) => api.get(u)))
      const bad = [...r1, ...r2].find((r) => !r.ok())
      if (bad) { stats.errors[bad.status()] = (stats.errors[bad.status()] ?? 0) + 1; return }
      const incidents = await r1[0].text()
      stats.reloads.push(performance.now() - t)
      stats.boardBytes = incidents.length + (await Promise.all([...r1.slice(1), ...r2].map((r) => r.body()))).reduce((a, b) => a + b.length, 0)
      // which marked write this reload is the first to carry (the steady window's lag probe)
      for (const [token, sent] of stats.pending) if (incidents.includes(token)) { stats.lag.push(performance.now() - sent); stats.pending.delete(token) }
    } catch {
      stats.errors.network = (stats.errors.network ?? 0) + 1
    }
  }
  const scheduler = new ReloadScheduler({ load: reload })
  // as websocket-client.ts: a fresh short-lived token before every (re)connect, and the room
  // joined again on every connect
  const socket: Socket = io(API, {
    path: '/socket.io/', transports: ['websocket'],
    auth: (cb) => { void api.get('/api/auth/ws-token').then((r) => r.json()).then(({ token }) => cb({ token }), () => cb({})) },
  })
  socket.on('connect', () => socket.emit('join', { room: 'operations' }))
  socket.on('disconnect', () => { stats.disconnects++ })
  await new Promise<void>((resolve, reject) => { socket.once('connect', () => resolve()); socket.once('connect_error', reject) })
  for (const ev of ['incident_update', 'personnel_update', 'vehicle_update', 'material_update', 'special_function_update', 'assignment_update', 'assignments_transferred']) {
    socket.on(ev, () => { stats.pushes++; scheduler.requestDebounced() })
  }
  let stop = false
  // the polling fallback (operations-context.tsx): while the socket is down, ask for the sync
  // version every ~5 s and reload when it moved
  const poll = (async () => {
    let version: string | null = null
    while (!stop) {
      await sleep(5_000 * (0.8 + Math.random() * 0.4))
      if (socket.connected || stop) continue
      try {
        const v = (await (await api.get(`/api/incidents/sync-version?event_id=${eventId}`)).json()).version
        if (v !== version) { version = v; stats.polledReloads++; await scheduler.requestAuto() }
      } catch {
        stats.errors.network = (stats.errors.network ?? 0) + 1
      }
    }
  })()
  const side = (async () => {
    for (let k = 0; !stop; k++) {
      try {
        const [, t] = await timed(() => api.get(`/api/incident-groups/?event_id=${eventId}`))
        stats.side.push(t)
        if (k % 2 === 0) await api.get(`/api/notifications/?event_id=${eventId}`)
      } catch {
        // a reset connection is a finding, not the end of the run
        stats.errors.network = (stats.errors.network ?? 0) + 1
      }
      await sleep(5_000 * (0.8 + Math.random() * 0.4))
    }
  })()
  await scheduler.request()
  return async () => { stop = true; scheduler.dispose(); socket.close(); await Promise.all([side, poll]).catch(() => {}); await api.dispose() }
}
interface DeviceStats { reloads: number[]; side: number[]; pushes: number; disconnects: number; polledReloads: number; boardBytes: number; errors: Record<string, number>; lag: number[]; pending: Map<string, number> }
const deviceStats = (): DeviceStats => ({ reloads: [], side: [], pushes: 0, disconnects: 0, polledReloads: 0, boardBytes: 0, errors: {}, lag: [], pending: new Map() })

/** Play one desk's actions in order; resolves logical indices to the ids the server handed out. */
async function play(api: APIRequestContext, actions: FatAction[], ids: { incidents: string[]; roster: Record<FatResource, string[]> }, lat: Record<string, number[]>, statuses: Record<string, number>) {
  const slots = new Map<number, string>()
  for (const a of actions) {
    const t = performance.now()
    let res: APIResponse
    try {
      const inc = 'incident' in a ? ids.incidents[a.incident] : ''
      switch (a.kind) {
        case 'checkIn': res = await api.post(`/api/personnel/check-in/${ids.roster.personnel[a.person]}/in?event_id=${eventId}`); break
        case 'create': {
          res = await api.post('/api/incidents/', { data: { event_id: eventId, title: a.title, type: a.type, priority: a.priority, status: 'incoming', location_address: `${a.title}, 4104 Oberwil`, location_lat: a.lat, location_lng: a.lng } })
          if (res.ok()) ids.incidents[a.incident] = (await res.json()).id
          break
        }
        case 'status': res = await api.post(`/api/incidents/${inc}/status`, { data: { from_status: a.from, to_status: a.to } }); break
        case 'update': res = await api.patch(`/api/incidents/${inc}`, { data: a.patch }); break
        case 'assign': {
          res = await api.post(`/api/incidents/${inc}/assign`, { data: { resource_type: a.resource, resource_id: ids.roster[a.resource][a.index] } })
          if (res.ok()) slots.set(a.slot, (await res.json()).id)
          break
        }
        case 'unassign': {
          const id = slots.get(a.slot)
          if (!id) { statuses['unassign: never assigned'] = (statuses['unassign: never assigned'] ?? 0) + 1; continue }
          res = await api.post(`/api/incidents/${inc}/unassign/${id}`)
          break
        }
        case 'specialFunction': res = await api.post(`/api/events/${eventId}/special-functions/`, { data: { personnel_id: ids.roster.personnel[a.person], function_type: a.fn } }); break
      }
    } catch {
      statuses[`${a.kind} network error`] = (statuses[`${a.kind} network error`] ?? 0) + 1
      continue
    }
    const kind = a.kind === 'assign' ? `assign ${a.resource}` : a.kind
    ;(lat[kind] ??= []).push(performance.now() - t)
    const key = `${kind} ${res.status()}`
    if (!res.ok()) statuses[key] = (statuses[key] ?? 0) + 1
  }
}

test('server: build the Ereignis up, action by action, with every board open', async () => {
  fat = fatEvent(FAT_PRESETS[PRESET!])
  const login = await pwRequest.newContext({ baseURL: API })
  await ok(await login.post('/api/auth/login', { form: { username: DEV_ADMIN_USERNAME, password: DEV_ADMIN_PASSWORD } }), 'login')
  storageState = await login.storageState()
  await login.dispose()
  const api = await pwRequest.newContext({ baseURL: API, storageState })

  // The roster first: the dev seed has some of it, the rest is a neighbouring Feuerwehr.
  const roster = { personnel: [] as string[], vehicle: [] as string[], material: [] as string[] }
  const have = async () => {
    const usable = (xs: { id: string; status?: string; out_of_service?: boolean }[]) => xs.filter((x) => x.status !== 'unavailable' && !x.out_of_service).map((x) => x.id)
    roster.personnel = usable(await (await ok(await api.get('/api/personnel/'), 'personnel')).json())
    roster.vehicle = usable(await (await ok(await api.get('/api/vehicles/'), 'vehicles')).json())
    roster.material = usable(await (await ok(await api.get('/api/materials/'), 'materials')).json())
  }
  await have()
  for (let k = roster.personnel.length; k < fat.roster.personnel; k++) await ok(await api.post('/api/personnel/', { data: { name: `Nachbar ${k}`, role: 'AdF', status: 'available' } }), 'personnel')
  for (let k = roster.vehicle.length; k < fat.roster.vehicles; k++) await ok(await api.post('/api/vehicles/', { data: { name: `Fz ${k}`, type: 'TLF', display_order: 100 + k, status: 'available', radio_call_sign: `Nachbar ${k}` } }), 'vehicle')
  for (let k = roster.material.length; k < fat.roster.materials; k++) await ok(await api.post('/api/materials/', { data: { name: `Pumpe ${k}`, type: 'Tauchpumpen', location: 'Depot', status: 'available' } }), 'material')
  await have()

  eventName = `Fat Ereignis · ${PRESET}`
  eventId = (await (await ok(await api.post('/api/events/', { data: { name: eventName, training_flag: false } }), 'event')).json()).id

  // Every device has the board open from the start, and a heartbeat asks the server for the
  // cheapest thing it has: when the load stalls the event loop, it shows up there first.
  const devices = Array.from({ length: fat.devices }, deviceStats)
  const stops = await Promise.all(devices.map((s) => device(eventId, s)))
  let stop = false
  const heartbeat: number[] = []
  const netErrors = { heartbeat: 0, writes: 0 }
  const beat = (async () => { while (!stop) { const [, t] = await timed(() => api.get('/health').catch(() => { netErrors.heartbeat++ })); heartbeat.push(t); await sleep(20) } })()

  const lat: Record<string, number[]> = {}
  const statuses: Record<string, number> = {}
  const ids = { incidents: [] as string[], roster: { personnel: roster.personnel, vehicle: roster.vehicle, material: roster.material } }
  const desks = await Promise.all(Array.from({ length: fat.writers }, () => pwRequest.newContext({ baseURL: API, storageState })))
  const buildFrom = performance.now()
  const reloadsBefore = devices.map((d) => d.reloads.length)
  try {
    // the desks write concurrently, each its own Einsätze and its own share of the roster
    await Promise.all(desks.map((desk, w) => play(desk, fat.actions.filter((a) => a.writer === w), ids, lat, statuses)))
  } finally {
    stop = true
  }
  await beat
  const buildMs = performance.now() - buildFrom
  const buildReloads = devices.flatMap((d, k) => d.reloads.slice(reloadsBefore[k]))

  const mix = actionMix(fat.actions)
  line(`\n── ${PRESET} (×${fat.options.scale}, ${fat.options.hours} h) ─────────────────────────────`)
  // a shared machine skews every number below: a run under load is not comparable to one without
  line(`machine load           ${loadavg().map((x) => x.toFixed(1)).join(' / ')} (1/5/15 min)`)
  line(`Ereignis               ${fat.incidents} Einsätze (${fat.open} still open at the end) · ${fat.actions.length} actions · roster ${fat.roster.personnel}/${fat.roster.vehicles}/${fat.roster.materials} · ${fat.devices} devices, ${fat.writers} writing`)
  line(`action mix             ${JSON.stringify(mix)}`)
  line(`build-up               ${(buildMs / 1000).toFixed(1)} s for ${fat.actions.length} actions, as fast as ${fat.writers} desks can send them (≈ ${Math.round((fat.options.hours * 3_600_000) / buildMs)}× real time)`)
  line(`refused writes         ${Object.keys(statuses).length ? JSON.stringify(statuses) : 'none'}`)
  for (const [kind, xs] of Object.entries(lat).sort()) {
    const q = Math.max(1, Math.floor(xs.length / 4))
    line(`  ${kind.padEnd(20)} p50/p95 ${p5095(xs).padEnd(15)} first quarter ${p5095(xs.slice(0, q)).padEnd(15)} last quarter ${p5095(xs.slice(-q))}`)
  }
  line(`device reload p50/p95  ${p5095(buildReloads)}   (${buildReloads.length} full board loads by ${fat.devices} devices during the build-up)`)
  line(`heartbeat p50/p99/max  ${ms(pct(heartbeat, 50))}/${ms(pct(heartbeat, 99))}/${ms(Math.max(...heartbeat))}   (cheapest request while all that runs: event-loop stalls)${netErrors.heartbeat ? ` · ${netErrors.heartbeat} failed` : ''}`)

  // The steady window: the record's write peak (113 writes in 10 min, × scale) against the
  // full-grown board, with every device following. This is what the end of a long Ereignis
  // feels like, and the write → other device lag is the number a crew notices.
  const perSecond = (113 / 600) * fat.options.scale
  const steadyFrom = devices.map((d) => d.reloads.length)
  const sideFrom = devices.map((d) => d.side.length)
  heartbeat.length = 0
  stop = false
  const beat2 = (async () => { while (!stop) { const [, t] = await timed(() => api.get('/health').catch(() => { netErrors.heartbeat++ })); heartbeat.push(t); await sleep(20) } })()
  const writeMs: number[] = []
  const live = ids.incidents.filter(Boolean)
  const end = performance.now() + STEADY_SECONDS * 1000
  for (let n = 0; performance.now() < end; n++) {
    const token = `probe-${n}-${Date.now().toString(36)}`
    const inc = live[Math.floor(Math.random() * live.length)]
    const sent = performance.now()
    for (const d of devices) d.pending.set(token, sent)
    const [, t] = await timed(async () => ok(await api.patch(`/api/incidents/${inc}`, { data: { internal_notes: token } }), 'probe'))
    writeMs.push(t)
    await sleep(Math.max(0, 1000 / perSecond - t) * (0.5 + Math.random()))
  }
  await sleep(5_000)
  stop = true
  await beat2
  const steadyReloads = devices.flatMap((d, k) => d.reloads.slice(steadyFrom[k]))
  const lags = devices.flatMap((d) => d.lag)
  const missed = devices.reduce((a, d) => a + d.pending.size, 0)
  line(`\nsteady window (${STEADY_SECONDS} s at ${perSecond.toFixed(2)} writes/s, the record's peak × ${fat.options.scale})`)
  line(`write p50/p95          ${p5095(writeMs)}`)
  line(`write → other device   p50/p95/max ${ms(pct(lags, 50))}/${ms(pct(lags, 95))}/${ms(Math.max(...lags))}   (${lags.length} arrivals${missed ? `, ${missed} never arrived` : ''})`)
  line(`device reload p50/p95  ${p5095(steadyReloads)}   ·  ${(steadyReloads.length / fat.devices / (STEADY_SECONDS / 60)).toFixed(1)} reloads per device per minute`)
  line(`side polls p50/p95     ${p5095(devices.flatMap((d, k) => d.side.slice(sideFrom[k])))}   (Aufträge)`)
  line(`heartbeat p50/p99/max  ${ms(pct(heartbeat, 50))}/${ms(pct(heartbeat, 99))}/${ms(Math.max(...heartbeat))}`)
  const errs = devices.reduce<Record<string, number>>((acc, d) => { for (const [k, v] of Object.entries(d.errors)) acc[k] = (acc[k] ?? 0) + v; return acc }, {})
  if (Object.keys(errs).length) line(`device errors          ${JSON.stringify(errs)}`)
  const dropped = devices.reduce((a, d) => a + d.disconnects, 0)
  // a socket the server drops (ping timeout while its event loop stalls) leaves that board on
  // the 5 s polling fallback until it reconnects
  line(`sockets dropped        ${dropped} over the whole run · ${devices.reduce((a, d) => a + d.polledReloads, 0)} reloads came from the polling fallback`)
  await Promise.all(stops.map((s) => s()))

  // What a device joining late pays: the board load, one request at a time, on a quiet server.
  const load = boardLoad(eventId)
  line(`\nboard load, cold (p50 of 5, quiet server)  ·  ${kb(devices[0].boardBytes)} per full load`)
  for (const url of [load.version, ...load.wave1, ...load.wave2, `/api/incident-groups/?event_id=${eventId}`, `/api/notifications/?event_id=${eventId}`]) {
    const t: number[] = []
    let bytes = 0
    for (let k = 0; k < 5; k++) {
      const [res, d] = await timed(async () => ok(await api.get(url), url))
      bytes = (await res.body()).length
      t.push(d)
    }
    line(`  ${url.replace(eventId, ':id').replace(/\?event_id=.*/, '').padEnd(42)} ${ms(pct(t, 50)).padStart(7)}   ${kb(bytes)}`)
  }
  await Promise.all(desks.map((d) => d.dispose()))
  await api.dispose()
})

// ------------------------------------------------------------------------------------------------

/** Collect main-thread long tasks and frame times from the first byte on. */
async function instrument(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __fat: { long: number[]; frames: number[]; recording: boolean } }
    w.__fat = { long: [], frames: [], recording: false }
    new PerformanceObserver((list) => { for (const e of list.getEntries()) w.__fat.long.push(e.duration) }).observe({ type: 'longtask', buffered: true })
    let last = performance.now()
    const tick = (now: number) => { if (w.__fat.recording) w.__fat.frames.push(now - last); last = now; requestAnimationFrame(tick) }
    requestAnimationFrame(tick)
  })
}
const fatState = (page: Page) => page.evaluate(() => {
  const w = window as unknown as { __fat: { long: number[]; frames: number[]; recording: boolean } }
  const out = { long: [...w.__fat.long], frames: [...w.__fat.frames] }
  w.__fat.long = []; w.__fat.frames = []
  return out
})
const recording = (page: Page, on: boolean) => page.evaluate((v) => { (window as unknown as { __fat: { recording: boolean } }).__fat.recording = v }, on)
const longSummary = (long: number[]) => `${long.length} long tasks, ${ms(long.reduce((a, b) => a + b, 0))} blocked, worst ${ms(Math.max(0, ...long))}`

/** Wait until `selector` has stopped growing (no change for `quietMs`). */
async function settled(page: Page, selector: string, quietMs = 1500, timeout = 180_000) {
  const until = Date.now() + timeout
  let last = -1
  let since = Date.now()
  while (Date.now() < until) {
    const n = await page.locator(selector).count()
    if (n !== last) { last = n; since = Date.now() } else if (n > 0 && Date.now() - since >= quietMs) return n
    await sleep(100)
  }
  return last
}

test('browser: open the board and the map on a throttled tablet', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'CPU throttling is a Chromium feature')
  test.skip(!eventId, 'the server phase did not run')
  await page.context().addCookies(storageState.cookies)
  await page.addInitScript(([key, id]) => { localStorage.setItem(key, id) }, ['kp-rueck-selected-event', eventId])
  await instrument(page)
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE })

  // what the open board asks the server for, by itself
  const requests: string[] = []
  page.on('request', (r) => { if (r.url().includes('/api/')) requests.push(new URL(r.url()).pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ':id')) })

  const t0 = performance.now()
  await page.goto('/')
  await page.locator('[data-testid="incident-card"]').first().waitFor({ state: 'visible', timeout: 180_000 })
  const first = performance.now() - t0
  const cards = await settled(page, '[data-testid="incident-card"]')
  const ready = performance.now() - t0
  const open = await fatState(page)
  line(`\nbrowser (CPU ×${CPU_THROTTLE}) — ${fat.incidents} Einsätze in the Ereignis, ${cards} cards rendered`)
  line(`open → first card      ${ms(first)}`)
  line(`open → board settled   ${ms(ready)}   ·  ${longSummary(open.long)}`)

  // idle: what one open board costs the server per minute, against prod's ~108 requests
  requests.length = 0
  await page.waitForTimeout(30_000)
  const idle = await fatState(page)
  const perPath = requests.reduce<Record<string, number>>((acc, p) => { acc[p] = (acc[p] ?? 0) + 1; return acc }, {})
  line(`idle 30 s              ${requests.length * 2} requests/min (prod record: ~108 per device)  ·  ${longSummary(idle.long)}`)
  line(`  ${Object.entries(perPath).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([p, n]) => `${p} ×${n}`).join('  ·  ')}`)

  // another device creates an Einsatz: how long until this board shows it
  const api = page.request
  const title = `Fremdgerät ${Date.now().toString(36)}`
  const t1 = performance.now()
  await ok(await api.post(`${API}/api/incidents/`, { data: { event_id: eventId, title, type: 'elementarereignis', priority: 'high', status: 'incoming', location_address: title, location_lat: 47.4989, location_lng: 7.5567 } }), 'remote create')
  await page.getByText(title).first().waitFor({ state: 'attached', timeout: 60_000 })
  const remote = await fatState(page)
  line(`remote create → shown  ${ms(performance.now() - t1)}   ·  ${longSummary(remote.long)}`)

  // the search box, the way an operator looks for an address mid-Einsatz
  const search = page.locator('#search-input')
  if (await search.count()) {
    await recording(page, true)
    const t2 = performance.now()
    await search.pressSequentially('Mühle', { delay: 80 })
    await page.waitForTimeout(500)
    await recording(page, false)
    const typed = await fatState(page)
    line(`search «Mühle»         ${ms(performance.now() - t2 - 500)} to type · frame p95 ${ms(pct(typed.frames, 95))}  ·  ${longSummary(typed.long)}`)
    await search.fill('')
  }
  await page.screenshot({ path: test.info().outputPath('board.png') })

  // the map: one marker per located Einsatz
  const t3 = performance.now()
  await page.goto('/map')
  await page.locator('.maplibregl-canvas').waitFor({ state: 'visible', timeout: 120_000 })
  const markers = await settled(page, '.maplibregl-marker', 1500, 120_000)
  const mapReady = performance.now() - t3
  const mapOpen = await fatState(page)
  line(`open map → settled     ${ms(mapReady)}   ·  ${markers} DOM markers  ·  ${longSummary(mapOpen.long)}`)

  // pan the map for two seconds, the way a finger does, from a spot with no marker under it
  const box = (await page.locator('.maplibregl-canvas').boundingBox())!
  const bare = await page.evaluate(({ x, y, w, h }) => {
    const canvas = document.querySelector('.maplibregl-canvas')
    for (let r = 0; r < 0.45; r += 0.02) {
      for (let a = 0; a < 2 * Math.PI; a += Math.PI / 12) {
        const px = x + w / 2 + Math.cos(a) * r * w
        const py = y + h / 2 + Math.sin(a) * r * h
        if (document.elementFromPoint(px, py) === canvas) return { px, py }
      }
    }
    return null
  }, { x: box.x, y: box.y, w: box.width, h: box.height })
  const cx = bare?.px ?? box.x + box.width / 2
  const cy = bare?.py ?? box.y + box.height / 2
  await recording(page, true)
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  for (let i = 0; i < 60; i++) { await page.mouse.move(cx + Math.sin(i / 6) * 250, cy + Math.cos(i / 8) * 150); await page.waitForTimeout(16) }
  await page.mouse.up()
  await page.waitForTimeout(300)
  await recording(page, false)
  const pan = await fatState(page)
  line(`map pan: frame p50/p95/max ${ms(pct(pan.frames, 50))}/${ms(pct(pan.frames, 95))}/${ms(Math.max(...pan.frames))}  ·  ${longSummary(pan.long)}`)
  await page.screenshot({ path: test.info().outputPath('map.png') })
  line('')
})
