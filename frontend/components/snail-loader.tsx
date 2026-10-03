'use client'

import { useId, useLayoutEffect, useMemo, useRef, type CSSProperties } from 'react'

import { snailClockFor } from '@/lib/snail-clock'
import { cn } from '@/lib/utils'

import snailSvg from '../public/firefighter-snail-loader.svg?raw'

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
  const html = useMemo(() => ({ __html: snailSvg.replaceAll('fs-', `fs${id}-`) }), [id])
  // Before paint. The launch's first snail is adopted as it is: server-rendered, it has been
  // arriving since the first paint, hydration keeps the same SVG (same markup, no remount),
  // and its arrival's progress becomes the launch's clock. Any later snail — another boot
  // stage, a remount, the next document after the Microsoft callback — is set to that clock,
  // so it stands instead of driving in again.
  useLayoutEffect(() => {
    const svg = ref.current?.querySelector('svg')
    if (!svg) return
    const at = snailClockFor(() => arrivalProgress(svg))
    if (at === null) return
    svg.getAnimations?.({ subtree: true }).forEach((animation) => {
      animation.currentTime = at
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

/** How long this snail's own animations have run (ms), or null without any (reduced
 *  motion). The arrival is a 630 ms one-shot whose clock stops at its end, so the time is
 *  read from the longest-running animation — the idle loops keep counting from the start. */
function arrivalProgress(svg: Element): number | null {
  const times = (svg.getAnimations?.({ subtree: true }) ?? [])
    .map((animation) => animation.currentTime)
    .filter((time): time is number => typeof time === 'number')
  return times.length ? Math.max(...times) : null
}
