'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'

import { BootScreen } from '@/components/boot-screen'
import { launchCover, useBootGates } from '@/lib/boot-cover'
import { cn } from '@/lib/utils'

/** The longest a launch stays behind the snail. Below BootScreen's 9 s stuck hint on purpose: a
 *  workspace that merely loads slowly is not a wedged start, and the cover must not offer
 *  «Neu starten» over it — past this, whatever has not arrived arrives in view. */
export const BOOT_COVER_MAX_MS = 8_000
/** …and it lifts with a short fade, so the finished workspace appears rather than cuts in. */
export const BOOT_COVER_FADE_MS = 240

/** The routes a launch can land on that open a workspace. Everything else (login, the
 *  Microsoft callback, the wall displays, the public forms) brings its own first screen. */
const COVERED_ROUTES = new Set(['/', '/map', '/feld', '/settings', '/events', '/training'])

export function isCoveredRoute(pathname: string | null) {
  return pathname !== null && COVERED_ROUTES.has(pathname)
}

type Phase = 'on' | 'leaving' | 'off'

/**
 * The launch cover: the boot snail over the WHOLE app until the route it landed on is usable —
 * session decided and the workspace's first data in (lib/boot-cover.ts, «gates») — then one
 * fade, revealing a complete workspace. Under it the app assembles itself unseen: no
 * «Wird geladen …» surface, no skeleton, no top bar (BootScreen suppresses the bar). Those stay
 * for what they are for: later navigation and switching inside the app.
 *
 * Only a LAUNCH (a document load on a covered route) is covered. The cover is mounted once in
 * the root layout, which App Router keeps across client navigations, so once it is off it stays
 * off; it never covers a working screen again. It is server-rendered, so it is the first paint
 * and its snail starts the launch's one arrival there (lib/snail-clock.ts; after the Microsoft
 * callback it stands, handed over).
 */
export function BootCover() {
  const pathname = usePathname()
  const tLogin = useTranslations('login.protectedRoute')
  const tCommon = useTranslations('common')
  const [phase, setPhase] = useState<Phase>(() => (isCoveredRoute(pathname) ? 'on' : 'off'))
  const [capped, setCapped] = useState(false)
  const gates = useBootGates()

  useEffect(() => {
    if (phase !== 'on') return
    // From the launch, not from hydration: performance.now() counts from the navigation.
    const timer = setTimeout(() => setCapped(true), Math.max(0, BOOT_COVER_MAX_MS - performance.now()))
    return () => clearTimeout(timer)
  }, [phase])

  // A launch that leaves the covered routes (signed out → /login, a viewer → /display/board)
  // is not opening a workspace any more; that page shows itself.
  const release = phase === 'on' && (gates.open || capped || !isCoveredRoute(pathname))

  useEffect(() => {
    if (!release) return
    // One frame: the commit that opened the last gate paints under the cover first, and a gate
    // that closes again in that frame (a page swapping its pieces) cancels this. The timeout is
    // the floor for a browser that withholds frames (a busy main thread, a background tab).
    const go = () => setPhase('leaving')
    const frame = requestAnimationFrame(go)
    const timer = setTimeout(go, 100)
    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(timer)
    }
  }, [release])

  // The boot stages below (ProtectedRoute) show their own boot screen again once this is gone.
  useEffect(() => {
    if (phase === 'off') launchCover.set(false)
  }, [phase])

  useEffect(() => {
    if (phase !== 'leaving') return
    const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
    const timer = setTimeout(() => setPhase('off'), still ? 0 : BOOT_COVER_FADE_MS)
    return () => clearTimeout(timer)
  }, [phase])

  if (phase === 'off') return null

  const fallback = pathname === '/feld' ? tCommon('loading') : tLogin('preparingLogin')
  return (
    <div
      data-boot-cover={phase}
      aria-busy={phase === 'on'}
      className={cn(
        'fixed inset-0 z-[300] bg-background transition-opacity ease-out motion-reduce:transition-none',
        phase === 'leaving' && 'pointer-events-none opacity-0',
      )}
      style={{ transitionDuration: `${BOOT_COVER_FADE_MS}ms` }}
    >
      <BootScreen phase={gates.label ?? fallback} />
    </div>
  )
}
