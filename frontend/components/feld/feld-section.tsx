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

import { useId, useState, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * How full the section is — read by the dot AND spelled out in the summary
 * line, never by colour alone (a phone screen in daylight is exactly where
 * colour-only status fails).
 */
export type FeldSectionState = 'filled' | 'todo' | 'optional'

const STATE_DOT: Record<FeldSectionState, string> = {
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
  children: ReactNode
}

export function FeldSection({ title, summary, state, defaultOpen = false, children }: FeldSectionProps) {
  const [open, setOpen] = useState(defaultOpen)
  const bodyId = useId()

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card/50">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        aria-controls={bodyId}
        className="flex min-h-14 w-full cursor-pointer items-center gap-2.5 px-3 py-3 text-left transition-colors hover:bg-muted/40"
      >
        <span className={cn('size-2 shrink-0 rounded-full', STATE_DOT[state])} aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">{title}</span>
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">{summary}</span>
        </span>
        <ChevronRight
          className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')}
          aria-hidden="true"
        />
      </button>
      <div id={bodyId} hidden={!open} className="space-y-3 border-t border-border/60 px-3 pb-4 pt-3">
        {children}
      </div>
    </section>
  )
}
