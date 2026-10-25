'use client'

/**
 * A foldable section of the `/feld` detail page.
 *
 * The field page had grown to 4.1 phone screens with every part of the rapport
 * open at once, which is how a crew ends up scrolling past four blocks to reach
 * the one they need — in the rain, with the phone in a glove. Each block starts
 * closed and says in ONE line what is inside it ("4 Personen · 1 Fahrzeug"), so
 * folding costs no information: the summary is what the open block would have
 * told them, and it is what makes this different from simply hiding things.
 *
 * The children stay MOUNTED and are hidden with `hidden` rather than unmounted.
 * Half-typed text in a checklist's own search box, a photo mid-upload and the
 * scroll position all survive a fold that way; the page height does not, which
 * is the whole point.
 *
 * Phone-only by design. The KP's incident detail renders the same rapport with
 * everything open (`mount="kp"`): an operator on a desktop is scanning, not
 * scrolling, and a fold there would hide fields from the person who has to
 * check them.
 */

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'

import { cn } from '@/lib/utils'
import { useEffectEvent } from '@/lib/hooks/use-effect-event'
import { Reveal, REVEAL_MS } from '@/components/ui/reveal'

/**
 * How full the section is — read by the dot AND spelled out in the summary
 * line, never by colour alone (a phone screen in daylight is exactly where
 * colour-only status fails).
 */
export type FeldSectionState = 'filled' | 'todo' | 'optional'

export const FELD_STATE_DOT: Record<FeldSectionState, string> = {
  filled: 'bg-success',
  todo: 'bg-warning',
  optional: 'bg-muted-foreground/50',
}

interface FeldSectionProps {
  title: string
  /** One line, always present: what the closed section contains. */
  summary: string
  state: FeldSectionState
  defaultOpen?: boolean
  /**
   * Always open, no control. For the briefing: what the board knows about this
   * Schadenplatz is what the crew came to read, and a block that can be folded
   * away can be folded away by accident with a wet thumb.
   */
  alwaysOpen?: boolean
  /**
   * Desktop scale. On the phone every header is a 56px thumb target with room
   * to spare; in the board's detail the same block sits in a ~500px column
   * among three other things, where 56px per folded block is a scrollbar for
   * nothing. Same content, same fold, tighter box.
   */
  dense?: boolean
  /** Imperative open: increment to unfold the section from outside (e.g. the
   *  journey's «Rapport erfassen» opening the Kurzbericht). Scrolls into view
   *  like a tap would. 0 / undefined = never fired. */
  openSignal?: number
  /** «Take me there» (the Rapport-abschliessen question's rows, KP Front's
   *  pattern): increment to unfold, put the header just under the sticky bar,
   *  ring the section twice in ink and – with `jumpFocus` – put the caret in
   *  its first text field. A checklist section leaves `jumpFocus` off: the
   *  first input there is a search box, not the answer. */
  jumpSignal?: number
  jumpFocus?: boolean
  children: ReactNode
}

/** Class the jump puts on the section; the two-beat ring is in globals.css. */
const JUMP_RING_CLASS = 'feld-jump-ring'
/** The ring's 1.9 s plus a beat; also how long the reduced-motion static ring stays. */
const JUMP_RING_MS = 2000

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function FeldSection({
  title,
  summary,
  state,
  defaultOpen = false,
  alwaysOpen = false,
  dense = false,
  openSignal,
  jumpSignal,
  jumpFocus = false,
  children,
}: FeldSectionProps) {
  const [open, setOpen] = useState(defaultOpen || alwaysOpen)
  const ref = useRef<HTMLElement>(null)
  const shouldReveal = useRef(false)
  const bodyId = useId()

  // Opening a block near the bottom of the page put its content below the fold:
  // the crew tapped "Kurzbericht" and looked at the same screen as before. Scroll
  // the header to the top of the viewport instead — after the layout has grown,
  // hence the effect rather than a scroll inside the click handler. `scroll-mt`
  // keeps it clear of the sticky incident bar.
  useEffect(() => {
    if (!open || !shouldReveal.current) return
    shouldReveal.current = false
    // After the body's slide (Reveal), so the page is already tall enough
    // for the header to reach the top — scrolling while it still grows
    // stopped short at the old page end.
    const id = setTimeout(() => ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), REVEAL_MS)
    return () => clearTimeout(id)
  }, [open])

  useEffect(() => {
    if (!openSignal) return
    shouldReveal.current = true
    setOpen(true)
  }, [openSignal])

  // Reads the CURRENT open state and `jumpFocus` without re-running the jump
  // when the section folds or the prop changes.
  const land = useEffectEvent((el: HTMLElement) => {
    // A closed body is `hidden` + `inert` until Reveal lifts it, and the page
    // is not yet tall enough for the header to reach the top – so a closed
    // section is measured after its slide, an open one straight away.
    const delay = open ? 0 : REVEAL_MS + 50
    const focus = jumpFocus
    setOpen(true)
    let ringTimer: ReturnType<typeof setTimeout> | undefined
    const timer = setTimeout(() => {
      // `block: 'start'` + the section's `scroll-mt-16`: the header lands just
      // under the sticky identity bar, never centred (a tall section centred
      // puts the heading the row named off the top of the screen).
      el.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' })
      // Class, not state, so the same row tapped twice restarts the beats. The
      // section's className never changes between renders, so React leaves it be.
      el.classList.remove(JUMP_RING_CLASS)
      void el.offsetWidth
      el.classList.add(JUMP_RING_CLASS)
      ringTimer = setTimeout(() => el.classList.remove(JUMP_RING_CLASS), JUMP_RING_MS)
      if (focus) el.querySelector<HTMLElement>('textarea, input')?.focus({ preventScroll: true })
    }, delay)
    return () => {
      clearTimeout(timer)
      if (ringTimer) clearTimeout(ringTimer)
      el.classList.remove(JUMP_RING_CLASS)
    }
  })
  useEffect(() => {
    const el = ref.current
    if (!jumpSignal || !el) return
    return land(el)
  }, [jumpSignal])

  if (alwaysOpen) {
    return (
      <section className="overflow-hidden rounded-xl border border-border bg-card/50">
        <div className={cn('flex items-center gap-2.5 px-3', dense ? 'min-h-9 py-1.5' : 'min-h-14 py-3')}>
          <span className={cn('size-2 shrink-0 rounded-full', FELD_STATE_DOT[state])} aria-hidden="true" />
          <h2 className="min-w-0 flex-1 text-sm font-semibold">{title}</h2>
        </div>
        <div className={cn('space-y-3 border-t border-border/60 px-3', dense ? 'pb-3 pt-2' : 'pb-4 pt-3')}>{children}</div>
      </section>
    )
  }

  return (
    <section ref={ref} className="scroll-mt-16 overflow-hidden rounded-xl border border-border bg-card/50">
      <button
        type="button"
        onClick={() => {
          shouldReveal.current = !open
          setOpen(v => !v)
        }}
        aria-expanded={open}
        aria-controls={bodyId}
        className={cn(
          'flex w-full cursor-pointer items-center gap-2.5 px-3 text-left transition-colors hover:bg-muted/40',
          dense ? 'min-h-9 py-1.5' : 'min-h-14 py-3',
        )}
      >
        <span className={cn('size-2 shrink-0 rounded-full', FELD_STATE_DOT[state])} aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">{title}</span>
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">{summary}</span>
        </span>
        {open ? (
          <ChevronUp className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        ) : (
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        )}
      </button>
      {/* Slides open/closed (Reveal). `keepMounted`: a closed section keeps
          its body (and whatever was typed into it) — it is hidden, not
          unmounted, exactly as before. */}
      <Reveal open={open} keepMounted id={bodyId}>
        <div className={cn('space-y-3 border-t border-border/60 px-3', dense ? 'pb-3 pt-2' : 'pb-4 pt-3')}>
          {children}
        </div>
      </Reveal>
    </section>
  )
}
