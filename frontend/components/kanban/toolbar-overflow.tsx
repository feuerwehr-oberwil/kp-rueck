'use client'

/**
 * The footer toolbar strip, with the controls that do not fit collected behind
 * «⋯ Mehr (N)».
 *
 * Why it exists: measured at 1280px with the Meldungs-Seitenleiste open,
 * Rapporte, Drucken, Übungs-Steuerung and Ansicht sat outside the strip
 * entirely — four functions with no way to reach them — and the strip overflowed
 * by 72px even without the sidebar, rendering «Ansic» with no ellipsis to say so.
 *
 * How it decides: by measuring, not by a breakpoint list. A hidden copy of the
 * whole row is laid out at its natural width; the visible row then takes as many
 * items as the container can actually hold, minus the width of the «Mehr» button
 * itself when one is needed. So the same code serves a 1280 board with two
 * sidebars and a 2560 board with none — and at any width where everything fits,
 * the button is not rendered at all. Items always overflow from the END, so the
 * order the operator learned never changes; what moves is only where the row is
 * cut.
 *
 * The panel holds the REAL controls, not lookalikes: each item can supply a
 * `panelNode` (the same control with its label forced on, since the strip drops
 * labels below `xl`). A copy that only mimicked the control would drift.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { MoreHorizontal } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

export interface ToolbarOverflowItem {
  key: string
  /** The control as it sits in the strip. */
  node: ReactNode
  /** The same control drawn for the vertical panel; falls back to `node`. */
  panelNode?: ReactNode
  /** Group divider drawn before this item (never before the first one). */
  separatorBefore?: boolean
}

/** The `gap-0.5` between items, in px — the measurement has to add it back. */
const ITEM_GAP = 2

/**
 * How many items fit, left to right, given their natural widths.
 *
 * Pure, and exported, because this is the whole feature: the DOM around it only
 * supplies three numbers. Returns `widths.length` when everything fits — that is
 * what makes the «Mehr» button disappear on a wide board instead of sitting
 * there empty.
 *
 * `available - 1`: sub-pixel layout rounds against us often enough that fitting
 * exactly to the last pixel clips the final item.
 */
export function computeVisibleCount(
  widths: number[],
  moreWidth: number,
  available: number,
  gap: number = ITEM_GAP,
): number {
  const fits = (used: number) => used <= available - 1
  if (widths.length === 0) return 0
  const total = widths.reduce((sum, width) => sum + width + gap, 0) - gap
  if (fits(total)) return widths.length
  // Nothing fits beside the button itself — everything goes in the panel.
  let used = moreWidth + gap
  let count = 0
  for (const width of widths) {
    if (!fits(used + width)) break
    used += width + gap
    count += 1
  }
  return count
}

function Separator() {
  return <div className="h-4 w-px shrink-0 bg-border mx-1" />
}

export function ToolbarOverflow({
  items,
  moreLabel,
  moreTitle,
  className,
}: {
  items: ToolbarOverflowItem[]
  moreLabel: string
  /** Tooltip/accessible name; receives how many controls are behind the button. */
  moreTitle: (count: number) => string
  className?: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const measureRef = useRef<HTMLDivElement>(null)
  const [visibleCount, setVisibleCount] = useState(items.length)
  const [open, setOpen] = useState(false)
  // Which controls exist at all — not the array identity, which is fresh on
  // every board render. The observers below only need rebuilding when the SET
  // changes; a width change is what the observers are for.
  const itemsKey = items.map((item) => item.key).join('|')

  const measure = useCallback(() => {
    const container = containerRef.current
    const row = measureRef.current
    if (!container || !row) return
    const cells = Array.from(row.children) as HTMLElement[]
    // The last cell is the «Mehr» button's own stand-in.
    const moreWidth = cells.length ? cells[cells.length - 1].getBoundingClientRect().width : 0
    const widths = cells.slice(0, -1).map((cell) => cell.getBoundingClientRect().width)
    setVisibleCount(computeVisibleCount(widths, moreWidth, container.clientWidth))
  }, [])

  useEffect(() => {
    measure()
    const container = containerRef.current
    const row = measureRef.current
    if (!container || !row) return
    // Both ends of the calculation move on their own: the container with the
    // window and the sidebars, the row with the locale, the label collapse and
    // with which controls exist at all (Rapporte, Übungs-Steuerung).
    const observer = new ResizeObserver(measure)
    observer.observe(container)
    observer.observe(row)
    return () => observer.disconnect()
  }, [measure, itemsKey])

  const visible = items.slice(0, visibleCount)
  const overflow = items.slice(visibleCount)

  const moreButton = (
    <Button
      size="xs"
      variant="ghost"
      className={cn(
        'px-2.5 transition-colors',
        open ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground',
      )}
      title={moreTitle(overflow.length)}
      aria-label={moreTitle(overflow.length)}
    >
      <MoreHorizontal className="size-3.5" />
      <span className="hidden text-xs xl:inline">{moreLabel}</span>
      <Badge variant="secondary" className="h-4 px-1.5 text-[11px] font-medium tabular-nums">
        {overflow.length}
      </Badge>
    </Button>
  )

  return (
    <div
      ref={containerRef}
      className={cn(
        // `overflow-x-auto` stays as the last line of defence — if a station ever
        // has a single control wider than the whole strip, this scrolls rather
        // than pushing the application sideways.
        'relative flex min-w-0 flex-1 items-center justify-center-safe gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        className,
      )}
    >
      {/* The ruler. Clipped to the container's own box so its natural width can
          never give the page a scrollbar, `invisible` so it never paints, and
          `inert` so nothing in it can be clicked, focused or read out. */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden inert>
        <div ref={measureRef} className="invisible flex w-max items-center gap-0.5">
          {items.map((item, index) => (
            <div key={item.key} className="flex shrink-0 items-center gap-0.5">
              {item.separatorBefore && index > 0 && <Separator />}
              {item.node}
            </div>
          ))}
          <div className="flex shrink-0 items-center gap-0.5">{moreButton}</div>
        </div>
      </div>

      {visible.map((item, index) => (
        <div key={item.key} className="flex shrink-0 items-center gap-0.5">
          {item.separatorBefore && index > 0 && <Separator />}
          {item.node}
        </div>
      ))}

      {overflow.length > 0 && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>{moreButton}</PopoverTrigger>
          <PopoverContent
            align="end"
            side="top"
            // Same offset as the other footer poppers: the trigger sits inside
            // the toolbar, so the offset has to clear the toolbar, not the button.
            sideOffset={20}
            className="w-56 p-1"
            // A control in here may open a popper of its own (Ansicht). Its
            // content is portalled, so interacting with it counts as "outside"
            // this panel and would close it — taking the nested popper's trigger
            // down with it.
            onInteractOutside={(event) => {
              const target = event.target as Element | null
              if (target?.closest('[data-radix-popper-content-wrapper]')) event.preventDefault()
            }}
          >
            <div
              className={cn(
                'flex flex-col gap-0.5',
                // The pills are built for a horizontal strip: centred and
                // shrink-to-fit. In a vertical list they read as a menu only if
                // they fill the width and line their glyphs up on the left.
                '[&_button]:w-full [&_button]:justify-start [&_a]:block [&_a]:w-full',
                // …and only if they are labelled. The strip drops labels below
                // `xl` (and «Übungs-Steuerung» below `2xl`) by putting `hidden`
                // on the label span; in here that would leave a column of bare
                // glyphs. `span.hidden` beats the plain `.hidden` utility on
                // specificity, so the label comes back without every control
                // needing a prop for it. Badges are `<span data-slot="badge">`
                // and carry no `hidden`, so they keep their own display.
                '[&_span.hidden]:inline',
              )}
              // Picking something here is done — the panel gets out of the way so
              // it does not sit on top of the sheet that just opened. On `click`,
              // not `pointerdown`: a `<Link>` inside would be unmounted before it
              // ever navigated. `data-keep-open` exempts a control that opens its
              // own popper from inside the panel.
              onClick={(event) => {
                const target = event.target as HTMLElement | null
                if (target?.closest('[data-keep-open]')) return
                setOpen(false)
              }}
            >
              {overflow.map((item, index) => (
                <div key={item.key}>
                  {item.separatorBefore && index > 0 && <div className="my-1 h-px bg-border" />}
                  {item.panelNode ?? item.node}
                </div>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  )
}
