'use client'

import { useId, useLayoutEffect, useMemo, useRef, type CSSProperties } from 'react'

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
  useLayoutEffect(() => {
    const svg = ref.current?.querySelector('svg')
    if (svg) continueSnailClock(svg)
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

/**
 * One animation clock for every snail of this page load (ported from KP Front's
 * lib/snailLaunch.ts). The first snail starts it; a snail mounted later — the phase
 * changing from «Anmeldung wird vorbereitet» to «Serververbindung wird geprüft», a second
 * loading screen after the first — continues from there instead of replaying the
 * entrance, so a slow start reads as one sequence and not as the snail arriving twice.
 * There is no minimum display time: when the app is ready, the snail goes.
 */
let startedAt: number | undefined

function continueSnailClock(svg: Element) {
  const animations = svg.getAnimations?.({ subtree: true }) ?? []
  if (!animations.length) return // reduced motion, or a browser without the API
  if (startedAt === undefined) {
    const time = animations[0].currentTime
    startedAt = performance.now() - (typeof time === 'number' ? time : 0)
    return
  }
  const elapsed = performance.now() - startedAt
  animations.forEach((animation) => {
    animation.currentTime = elapsed
  })
}
