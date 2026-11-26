import { execFileSync } from 'node:child_process'
import { test, request as pwRequest, type APIResponse } from '@playwright/test'
import { DEV_ADMIN_PASSWORD, DEV_ADMIN_USERNAME } from '../constants'

// Opening an Ereignis that already holds hundreds of notifications (owner, 16.11.2026: the
// Test Einsatz had 563 and the board took 1–2 minutes to become usable). A measurement, run by
// `just notification-storm`: a throwaway stack, an Übung with STORM_INCIDENTS cards, the
// notification rows written straight into its database, then the board opened on a
// CPU-throttled Chromium. Prints how long until the first card, until a click on it opens the
// detail, and how many toasts the load put up.

const STORM = process.env.STORM_NOTIFICATIONS ? Number(process.env.STORM_NOTIFICATIONS) : undefined
const INCIDENTS = Number(process.env.STORM_INCIDENTS ?? 120)
const CPU_THROTTLE = Number(process.env.STORM_CPU ?? 4)
const PG = process.env.STORM_PG_CONTAINER ?? ''
/** Only these notification types (comma-separated), to tell the mix apart. Default: all. */
const KINDS = process.env.STORM_KINDS?.split(',').filter(Boolean)
/** The board opens the Bereitschaft checklist once per Ereignis unless it is listed here. */
const CHECKLIST_DISMISSED_KEY = 'kp-board-checklistDismissedEvents'
const API = process.env.API_BASE_URL || 'http://localhost:8000'
/** Seconds of CPU profile after the first card (0 = none): prints the top functions by self time. */
const PROFILE_SECONDS = Number(process.env.STORM_PROFILE ?? 0)

test.skip(STORM === undefined || !PG, 'measurement only: run through `just notification-storm`')
test.setTimeout(15 * 60_000)

// the report IS the output
const line = (s: string) => { process.stdout.write(`${s}\n`) }
const ms = (n: number) => `${Math.round(n)} ms`

async function ok(res: APIResponse, what: string) {
  if (!res.ok()) throw new Error(`${what}: HTTP ${res.status()} ${(await res.text()).slice(0, 300)}`)
  return res
}

/** The notification mix of a long Übung: per card a stale-time warning and a crew waiting to
 *  be collected, the rest field and vehicle traffic. Oldest first, over the last three hours. */
function stormSql(eventId: string, incidentIds: string[], total: number): string {
  const mix: [type: string, severity: string, message: string][] = [
    ['time_overdue', 'warning', 'Einsatz seit über 60 Minuten offen'],
    // not `no_personnel`: the backend re-evaluates that one on every fetch and resolves a row
    // whose message is not its own, so it never reaches the browser
    ['field_pickup', 'warning', 'Trupp wartet auf Abholung'],
    ['field_report', 'info', 'Neuer Schadenplatz vom Feld'],
    ['vehicle_arrived', 'info', 'Fahrzeug am Einsatzort angekommen'],
    ['reko_submitted', 'info', 'Reko-Bericht eingereicht'],
  ]
  const kinds = mix.filter(([type]) => !KINDS || KINDS.includes(type))
  const rows: string[] = []
  for (let i = 0; i < total; i++) {
    const [type, severity, message] = kinds[i % kinds.length]
    const incident = incidentIds[i % incidentIds.length]
    const minutesAgo = Math.round(180 - (180 * i) / total)
    rows.push(
      `(gen_random_uuid(), '${type}', '${severity}', '${message} #${i}', '${incident}', '${eventId}', now() - interval '${minutesAgo} minutes', false)`,
    )
  }
  return `insert into notifications (id, type, severity, message, incident_id, event_id, created_at, dismissed) values ${rows.join(',\n')};`
}

test('open an Ereignis with a notification storm', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'CPU throttling is a Chromium feature')
  const login = await pwRequest.newContext({ baseURL: API })
  await ok(await login.post('/api/auth/login', { form: { username: DEV_ADMIN_USERNAME, password: DEV_ADMIN_PASSWORD } }), 'login')
  const storageState = await login.storageState()
  await login.dispose()
  const api = await pwRequest.newContext({ baseURL: API, storageState })

  const event = await (await ok(await api.post('/api/events/', { data: { name: 'Test Einsatz', training_flag: true } }), 'event')).json()
  const incidentIds: string[] = []
  for (let i = 0; i < INCIDENTS; i++) {
    const res = await ok(await api.post('/api/incidents/', {
      data: { event_id: event.id, title: `Wasser im Keller ${i}`, type: 'elementarereignis', priority: 'medium', location_address: `Hauptstrasse ${i + 1}, Oberwil` },
    }), 'incident')
    incidentIds.push((await res.json()).id)
  }
  if (STORM) execFileSync('docker', ['exec', '-i', PG, 'psql', '-q', '-U', 'kprueck', '-d', 'kprueck'], { input: stormSql(event.id, incidentIds, STORM) })
  // what the board will actually be handed – the same evaluation the browser's first fetch runs
  const served: { dismissed: boolean; severity: string }[] = await (await ok(await api.get(`/api/notifications/?event_id=${event.id}`), 'notifications')).json()
  const active = served.filter((n) => !n.dismissed)
  const bySeverity = Object.entries(Object.groupBy(active, (n) => n.severity)).map(([k, v]) => `${v?.length} ${k}`).join(', ')
  await api.dispose()

  await page.context().addCookies(storageState.cookies)
  // the Ereignis open, and its Bereitschaft checklist closed (the board opens it once per new
  // Ereignis, and it would take the click below)
  await page.addInitScript(([key, checklistKey, id]) => {
    localStorage.setItem(key, id)
    localStorage.setItem(checklistKey, JSON.stringify([id]))
  }, ['kp-rueck-selected-event', CHECKLIST_DISMISSED_KEY, event.id])
  // every toast sonner ever mounted, and the main thread's long tasks
  await page.addInitScript(() => {
    const w = window as unknown as { __storm: { toasts: Set<string>; long: number[] } }
    w.__storm = { toasts: new Set(), long: [] }
    new PerformanceObserver((list) => { for (const e of list.getEntries()) w.__storm.long.push(e.duration) }).observe({ type: 'longtask', buffered: true })
    new MutationObserver(() => {
      document.querySelectorAll('[data-sonner-toast]').forEach((el, i) => w.__storm.toasts.add(el.textContent?.slice(0, 80) ?? String(i)))
    }).observe(document, { childList: true, subtree: true })
  })
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE })

  const t0 = performance.now()
  await page.goto('/')
  const card = page.locator('[data-testid="incident-card"]').first()
  await card.waitFor({ state: 'visible', timeout: 300_000 })
  const firstCard = performance.now() - t0
  if (PROFILE_SECONDS > 0) {
    await cdp.send('Profiler.enable')
    await cdp.send('Profiler.start')
    await page.waitForTimeout(PROFILE_SECONDS * 1000)
    const { profile } = await cdp.send('Profiler.stop')
    const dt = (profile.endTime - profile.startTime) / 1000 / Math.max(1, profile.samples?.length ?? 1)
    const self = new Map<string, number>()
    for (const node of profile.nodes) {
      const { functionName, url, lineNumber, columnNumber } = node.callFrame
      const key = `${functionName || '(anonymous)'}  ${url.split('/').pop()}:${lineNumber + 1}:${columnNumber + 1}`
      self.set(key, (self.get(key) ?? 0) + (node.hitCount ?? 0) * dt)
    }
    line(`\nCPU profile, ${PROFILE_SECONDS} s after the first card – top self time:`)
    for (const [key, t] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 25)) line(`  ${ms(t).padStart(9)}  ${key}`)
  }
  // «usable»: the operator clicks the first card and its detail opens
  await card.click({ timeout: 300_000 })
  await page.getByRole('dialog').first().waitFor({ state: 'visible', timeout: 300_000 })
  const usable = performance.now() - t0
  // The notifications arrive on their own fetch, after mount, so the click above may beat them.
  // Wait for their first toast – a storm that never shows is a failed run, not a fast one – and
  // time a second click once they are in: that is the board the operator is left with.
  let firstToast = NaN
  let afterStorm = NaN
  if (active.length > 0) {
    // Notification-specific, from the recorder that saw every toast since load (so one that came
    // and went already counts): the storm summary, or one of the seeded messages («… #12»).
    await page.waitForFunction(
      () => [...(window as unknown as { __storm: { toasts: Set<string> } }).__storm.toasts]
        .some((text) => /(offene|weitere) Meldung|#\d+/.test(text)),
      undefined,
      { timeout: 300_000, polling: 100 },
    )
    firstToast = performance.now() - t0
    await page.keyboard.press('Escape')
    await page.getByRole('dialog').first().waitFor({ state: 'hidden', timeout: 300_000 })
    const t1 = performance.now()
    await card.click({ timeout: 300_000 })
    await page.getByRole('dialog').first().waitFor({ state: 'visible', timeout: 300_000 })
    afterStorm = performance.now() - t1
  }
  await page.waitForTimeout(10_000)
  const { toasts, long } = await page.evaluate(() => {
    const s = (window as unknown as { __storm: { toasts: Set<string>; long: number[] } }).__storm
    return { toasts: s.toasts.size, long: s.long }
  })

  line(`\n${STORM} notifications (${KINDS?.join(', ') ?? 'every kind'}) on ${INCIDENTS} cards, CPU ×${CPU_THROTTLE}`)
  line(`open → first card          ${ms(firstCard)}`)
  line(`open → card click answered ${ms(usable)}`)
  line(`served to the board        ${active.length} active (${bySeverity || 'none'})`)
  if (active.length > 0) {
    line(`open → notifications shown ${ms(firstToast)}`)
    line(`click after the storm      ${ms(afterStorm)} to the detail`)
  }
  line(`toasts mounted             ${toasts}`)
  line(`long tasks                 ${long.length}, ${ms(long.reduce((a, b) => a + b, 0))} blocked, worst ${ms(Math.max(0, ...long))}`)
})
