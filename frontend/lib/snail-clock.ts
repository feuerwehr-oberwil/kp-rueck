/**
 * One animation clock for every boot snail of a launch (KP Front's rule, lib/snailLaunch.ts
 * there: the arrival is shown ONCE, a later stage never replays it).
 *
 * The first snail of a launch IS the clock: it is server-rendered and starts its arrival at
 * the first paint, and hydration adopts that running SVG untouched — the clock is read off
 * its arrival animation (how far it has run), never imposed on it. A snail mounted later
 * (another boot stage, a remount) is set to that clock instead of starting over. A launch can
 * also span two documents: the Microsoft callback redeems the code behind the snail and
 * then does a full page load of the app (it must — see app/auth/callback/page.tsx), whose
 * own start screen mounts a NEW snail in a NEW document. Without help that one drove in a
 * second time: «the snail loads in twice» (owner, prod, 02.10.2026). So a stage that
 * knowingly hands the start over to the next document calls `handOverSnailClock()` right
 * before it navigates, and the next document's first snail picks the clock up from
 * sessionStorage. Only an explicit handover counts, and only for a few seconds: a reload
 * the user asks for («Neu starten», F5) is a new launch and gets the arrival again.
 *
 * sessionStorage carries the exact clock, but only the client can read it, and the next
 * document's snail would start its arrival at the first paint like any other. So the
 * handover also leaves a short-lived cookie: the root layout turns it into
 * `<html data-snail="standing">`, globals.css switches the snail's animations off there
 * (the drawing at rest), and the first snail of that document drops the attribute and sets
 * its freshly started animations to the handed-over clock — before the next paint.
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

/**
 * Where a newly mounted snail's animations have to stand, in ms — or `null` when this snail
 * is the launch's first and its running animation IS the clock (leave it alone).
 * `runningMs` reads how far that snail's own arrival has run; it is only asked when the
 * snail is the first, and after a handover has been taken (which re-creates them).
 */
export function snailClockFor(runningMs: () => number | null): number | null {
  if (startedAt === undefined) {
    const handedOver = takeHandover()
    if (handedOver > 0) {
      startedAt = performance.now() - handedOver
      return handedOver
    }
    startedAt = performance.now() - (runningMs() ?? 0)
    return null
  }
  return Math.max(0, performance.now() - startedAt)
}

/** Milliseconds into this launch's snail animation (starting the clock if nothing has). */
export function snailClockElapsed(): number {
  if (startedAt === undefined) snailClockFor(() => 0)
  return Math.max(0, performance.now() - (startedAt as number))
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
