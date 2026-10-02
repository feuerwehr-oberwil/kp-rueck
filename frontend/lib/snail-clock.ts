/**
 * One animation clock for every boot snail of a launch (KP Front's rule, lib/snailLaunch.ts
 * there: the arrival is shown ONCE, a later stage never replays it).
 *
 * Within one document a module variable is enough: the first snail starts the clock, a
 * snail mounted later (another boot stage, a remount) continues from there. A launch can
 * also span two documents: the Microsoft callback redeems the code behind the snail and
 * then does a full page load of the app (it must — see app/auth/callback/page.tsx), whose
 * own start screen mounts a NEW snail in a NEW document. Without help that one drove in a
 * second time: «the snail loads in twice» (owner, prod, 02.10.2026). So a stage that
 * knowingly hands the start over to the next document calls `handOverSnailClock()` right
 * before it navigates, and the next document's first snail picks the clock up from
 * sessionStorage. Only an explicit handover counts, and only for a few seconds: a reload
 * the user asks for («Neu starten», F5) is a new launch and gets the arrival again.
 *
 * sessionStorage carries the exact clock, but only the client can read it — and the next
 * document's snail is server-rendered, paused (components/snail-loader.tsx), which holds it
 * off-screen at the arrival's first frame until hydration. So the handover also leaves a
 * short-lived cookie: the root layout turns it into `<html data-snail="standing">`, and
 * globals.css shows a paused snail STANDING there instead, from the very first paint.
 */

/** Read by app/layout.tsx (server) to render `<html data-snail="standing">`. */
export const SNAIL_STANDING_COOKIE = 'kp-rueck-snail'

const KEY = 'kp-rueck.snail-handover'
/** A handover older than this is a stale tab, not the next stage of the same start. */
export const SNAIL_HANDOVER_MAX_MS = 15_000

let startedAt: number | undefined // performance.now() of this launch's arrival start

function takeHandover(): number {
  try {
    document.cookie = `${SNAIL_STANDING_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax`
    document.documentElement.removeAttribute('data-snail')
  } catch {
    // not a browser
  }
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return 0
    sessionStorage.removeItem(KEY)
    const { start, at } = JSON.parse(raw) as { start: number; at: number }
    const now = Date.now()
    if (!(now - at >= 0 && now - at <= SNAIL_HANDOVER_MAX_MS)) return 0
    return Math.max(0, now - start)
  } catch {
    return 0 // no storage (private mode, sandbox): a second arrival is the worst case
  }
}

/** Milliseconds into this launch's snail animation; the first call starts the clock. */
export function snailClockElapsed(): number {
  if (startedAt === undefined) startedAt = performance.now() - takeHandover()
  return Math.max(0, performance.now() - startedAt)
}

/** Call right before a full page load that continues the same start (see above). */
export function handOverSnailClock(): void {
  if (startedAt === undefined) return
  try {
    const now = Date.now()
    sessionStorage.setItem(KEY, JSON.stringify({ start: now - (performance.now() - startedAt), at: now }))
    document.cookie = `${SNAIL_STANDING_COOKIE}=standing; Max-Age=${SNAIL_HANDOVER_MAX_MS / 1000}; Path=/; SameSite=Lax`
  } catch {
    // ignore: without storage the next document simply starts its own clock
  }
}

/** Tests only: forget this document's clock. */
export function resetSnailClock(): void {
  startedAt = undefined
}
