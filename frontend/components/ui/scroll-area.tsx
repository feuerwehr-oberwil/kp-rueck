'use client'

import * as React from 'react'
import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area'

import { cn } from '@/lib/utils'

/**
 * A vertically scrolling area with the board's slim bar. `fadeEnd`: while more content waits
 * below, a 12px shade in the `--border` tone sits on the bottom edge – visible over a tile and
 * over the blank between two sections alike – telling a list that ends from one that runs on
 * under the footer (assignment dialog, hill climb r6).
 */
function ScrollArea({
  className,
  children,
  fadeEnd = false,
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.Root> & { fadeEnd?: boolean }) {
  const viewportRef = React.useRef<HTMLDivElement>(null)
  const moreBelow = useMoreBelow(viewportRef, fadeEnd)
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      className={cn('relative', className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        ref={viewportRef}
        data-slot="scroll-area-viewport"
        // `[&>div]:!block`: Radix wraps the children in a `display: table` div, which grows to
        // the widest unbreakable line inside — one long code line in the Hilfe made the whole
        // text column wider than the phone and cut every paragraph off at the right edge
        // (overflow sweep, 03.10.). This area only ever scrolls vertically (one vertical
        // ScrollBar below), so the content is laid out at the viewport's width instead.
        className="focus-visible:ring-ring/50 size-full rounded-[inherit] transition-[color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:outline-1 [&>div]:!block"
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      {moreBelow && (
        <div
          aria-hidden
          data-slot="scroll-area-more-below"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-3 bg-linear-to-t from-border/60 to-transparent"
        />
      )}
      <ScrollBar />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  )
}

/** Whether the viewport has content below its bottom edge – re-measured on scroll and whenever
 *  the viewport or its content changes size (a filter switch, a section folding). */
function useMoreBelow(viewportRef: React.RefObject<HTMLDivElement | null>, enabled: boolean): boolean {
  const [moreBelow, setMoreBelow] = React.useState(false)
  React.useEffect(() => {
    const viewport = viewportRef.current
    if (!enabled || !viewport) return
    const measure = () => setMoreBelow(viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight > 1)
    measure()
    viewport.addEventListener('scroll', measure, { passive: true })
    const observer = new ResizeObserver(measure)
    observer.observe(viewport)
    if (viewport.firstElementChild) observer.observe(viewport.firstElementChild)
    return () => {
      viewport.removeEventListener('scroll', measure)
      observer.disconnect()
    }
  }, [viewportRef, enabled])
  return enabled && moreBelow
}

function ScrollBar({
  className,
  orientation = 'vertical',
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>) {
  return (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      data-slot="scroll-area-scrollbar"
      orientation={orientation}
      className={cn(
        // Radix paints its own bar in the DOM, so the slim ::-webkit-scrollbar
        // rules in globals.css never reach it. Matched by hand instead, or the
        // dialogs would keep a visibly fatter bar than the rest of the board.
        'flex touch-none p-px transition-colors select-none',
        orientation === 'vertical' &&
          'h-full w-1.5 border-l border-l-transparent',
        orientation === 'horizontal' &&
          'h-1.5 flex-col border-t border-t-transparent',
        className,
      )}
      {...props}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb
        data-slot="scroll-area-thumb"
        className="bg-muted-foreground/45 hover:bg-muted-foreground relative flex-1 rounded-full transition-colors"
      />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  )
}

export { ScrollArea, ScrollBar }
