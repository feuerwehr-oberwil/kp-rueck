'use client'

import { useId, useLayoutEffect, useMemo, useRef, type CSSProperties } from 'react'

import { snailClockElapsed } from '@/lib/snail-clock'
import { cn } from '@/lib/utils'

import snailSvg from '../public/firefighter-snail-loader.svg?raw'

// Rendered paused (the SVG's own `snail-paused` hook): the server-rendered snail must not
// start its arrival before the client knows where this launch's clock stands — after the
// Microsoft callback it is already past the arrival and has to appear standing. Paused at
// 0 the arrival keyframe holds the snail off-screen to the left, so a start that is still
// waiting for JS shows the wordmark and the phase, and the snail drives in once. Reduced
// motion switches the animations off altogether, so the snail just stands there.
const PAUSED_SVG = snailSvg.replace('class="firefighter-snail ', 'class="firefighter-snail snail-paused ')

/**
 * The firefighter snail, inline. `public/firefighter-snail-loader.svg` is KP Front's
 * mascot, copied byte-identical (it is edited in kp-front; the `snail-drift` CI job
 * compares the two). The SVG owns its motion — a 630 ms arrival, then a standing idle —
 * and its own reduced-motion rule; it reads the shell colour from `--accent`, which in
 * Rück is shadcn's (blue) accent token, so the wrapper points it at the red `--primary`.
 *
 * Every instance renames the SVG's `fs-` ids, classes and keyframes, so two snails on one
 * page keep their own gradients. The markup is trusted, bundled artwork; the snail is
 * decorative and the screen around it says what is happening.
 */
export function SnailLoader({ className }: { className?: string }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const ref = useRef<HTMLDivElement>(null)
  // One object per instance: React re-writes innerHTML whenever it gets a NEW object, and
  // a re-inserted SVG restarts its animations (KP Front found this on 01.10.2026).
  const html = useMemo(() => ({ __html: PAUSED_SVG.replaceAll('fs-', `fs${id}-`) }), [id])
  // Before paint: put every animation where the launch's clock stands, then let it run.
  // The first snail of a launch starts at 0 (one arrival); any later one — another boot
  // stage, a remount, the next document after the Microsoft callback — continues the idle.
  useLayoutEffect(() => {
    const svg = ref.current?.querySelector('svg')
    if (!svg) return
    const elapsed = snailClockElapsed()
    // Lift the pause FIRST: a handed-over snail stands with its animations switched off
    // (globals.css, `data-snail="standing"`), and they only exist again once it is lifted.
    svg.classList.remove('snail-paused')
    svg.getAnimations?.({ subtree: true }).forEach((animation) => {
      animation.currentTime = elapsed
    })
  }, [])
  return (
    <div
      ref={ref}
      aria-hidden="true"
      className={cn('snail-loader', className)}
      style={{ '--accent': 'var(--primary)' } as CSSProperties}
      dangerouslySetInnerHTML={html}
    />
  )
}
