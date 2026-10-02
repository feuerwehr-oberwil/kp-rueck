import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

import styles from './shell-loader.module.css'

/**
 * The in-app loading signal: a trail running along the snail's shell spiral.
 *
 * The path is the `fs-shell-trail` path of `public/firefighter-snail-loader.svg`, the
 * mascot KP Front and KP Rück share (edited in kp-front, copied here byte-identical).
 * KP Front reads it out of the SVG at runtime; here it is inline so the loader needs no
 * bundler trick and renders on the server. Two checks keep the copies honest:
 * `shell-loader.test.tsx` compares it with our SVG, and the `snail-drift` CI job
 * (`scripts/check-snail-drift.mjs`) compares both with kp-front's.
 */
export const SHELL_TRAIL_PATH =
  'M534 550 C477 519 454 441 487 360 C515 290 580 245 636 262 C691 271 724 311 721 362 C718 418 673 471 625 480 C579 490 539 471 527 431 C515 394 538 345 572 325 C608 302 639 318 650 341 C665 373 641 407 615 411 C591 415 570 390 595 371'

export type ShellLoaderSize = 'inline' | 'surface'

const PX: Record<ShellLoaderSize, number> = { inline: 20, surface: 48 }

/**
 * Decorative on its own (`aria-hidden`): beside a label in a busy button, or inside
 * `LoadingStatus`. Sized by its width/height attributes, so a size class wins — inside a
 * shadcn Button it takes the button's icon size like the icon it replaces.
 */
export function ShellLoader({ size = 'inline', className }: { size?: ShellLoaderSize; className?: string }) {
  const px = PX[size]
  return (
    <svg
      viewBox="480 245 270 315"
      width={px}
      height={px}
      fill="none"
      stroke="currentColor"
      strokeWidth="14"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
      data-slot="shell-loader"
      className={cn('pointer-events-none shrink-0 overflow-visible', className)}
    >
      <path d={SHELL_TRAIL_PATH} opacity=".12" />
      <path d={SHELL_TRAIL_PATH} pathLength={100} className={styles.trail} />
    </svg>
  )
}

/**
 * A stand-alone loading state: the trail plus words, announced politely. The words are
 * required — a spinner alone says neither what is loading nor that anything is.
 * `surface` stacks a 48px trail above the words for an empty dialog or panel; `inline`
 * puts a 20px trail beside them for a row in a list. The caller owns placement.
 */
export function LoadingStatus({
  children,
  size = 'inline',
  className,
}: {
  children: ReactNode
  size?: ShellLoaderSize
  className?: string
}) {
  return (
    <span
      role="status"
      className={cn(
        'inline-flex items-center gap-2 text-muted-foreground',
        size === 'surface' && 'flex-col gap-3 text-center',
        className,
      )}
    >
      <ShellLoader size={size} className={size === 'surface' ? 'text-foreground' : undefined} />
      <span>{children}</span>
    </span>
  )
}
