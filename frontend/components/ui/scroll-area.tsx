'use client'

import * as React from 'react'
import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area'

import { cn } from '@/lib/utils'

function ScrollArea({
  className,
  children,
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.Root>) {
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      className={cn('relative', className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
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
      <ScrollBar />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  )
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
