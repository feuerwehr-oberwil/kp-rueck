'use client'

/**
 * A foldable block: a header that says in ONE line what is inside it
 * ("4 Personen"), and the body under it.
 *
 * Two users, both deliberate:
 *
 * * The KP's incident detail folds the Schadenplatz-Rapport's lists
 *   (`feld-rapport-form.tsx`, `mount="kp"`, `dense`): there the form is one of
 *   four things in a ~500px tab column, and a folded block that states what is
 *   in it answers «habe ich das schon ausgefüllt?» without opening anything.
 *   The summary is what the open block would have said, which is what makes a
 *   fold different from simply hiding things.
 * * The `/feld` briefing renders it `alwaysOpen`: what the board knows about this
 *   Schadenplatz is what the crew came to read, and a block that can be folded
 *   away can be folded away by accident with a wet thumb.
 *
 * The `/feld` rapport itself folds nothing any more (owner pick 1B, 24.11.2026):
 * it is one open card of chips.
 *
 * The children stay MOUNTED and are hidden rather than unmounted, so half-typed
 * text in a fold survives closing it.
 */

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'

import { cn } from '@/lib/utils'
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
  children: ReactNode
}

export function FeldSection({
  title,
  summary,
  state,
  alwaysOpen = false,
  dense = false,
  children,
}: FeldSectionProps) {
  const [open, setOpen] = useState(alwaysOpen)
  const ref = useRef<HTMLElement>(null)
  const shouldReveal = useRef(false)
  const bodyId = useId()

  // Opening a block near the bottom of the page put its content below the fold:
  // the operator tapped "Material" and looked at the same screen as before.
  // Scroll the header to the top of its scroller instead — after the layout has
  // grown, hence the effect rather than a scroll inside the click handler.
  useEffect(() => {
    if (!open || !shouldReveal.current) return
    shouldReveal.current = false
    // After the body's slide (Reveal), so the page is already tall enough
    // for the header to reach the top — scrolling while it still grows
    // stopped short at the old page end.
    const id = setTimeout(() => ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), REVEAL_MS)
    return () => clearTimeout(id)
  }, [open])

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
    <section ref={ref} className="overflow-hidden rounded-xl border border-border bg-card/50">
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
