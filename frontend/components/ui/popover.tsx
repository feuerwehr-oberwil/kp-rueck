'use client'

import * as React from 'react'
import * as PopoverPrimitive from '@radix-ui/react-popover'

import { cn } from '@/lib/utils'
import { ignoreToastLayer } from '@/lib/toast-layer'

function Popover({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />
}

function PopoverTrigger({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

function PopoverContent({
  className,
  align = 'center',
  sideOffset = 4,
  // Radix defaults this to 0, which lets a panel sit flush against the glass with its
  // border merged into the screen edge — and, worse, tells the operator nothing about
  // whether anything was cut. Keeping 8px off every edge means an overlay that had to be
  // shifted still *reads* as a whole panel. A property of the screen being finite, not of
  // any one call site, so it belongs here rather than at the four call sites that had
  // already discovered it by hand. NOTE: this only shifts — a panel wider than the
  // viewport still overflows, so a fixed `w-[...]` above ~360px needs its own clamp.
  collisionPadding = 8,
  onInteractOutside,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        // Dismissing a toast must never dismiss the popover behind it.
        onInteractOutside={ignoreToastLayer(onInteractOutside)}
        className={cn(
          // NO exit animation, deliberately. Radix's `Presence` keeps a closed
          // Content mounted until its `animate-out` has run, and `DismissableLayer`
          // goes on writing an inline `pointer-events: auto` onto it for that whole
          // time — so for ~150ms after dismissal an all-but-invisible, fully
          // hit-testable panel sat over whatever was behind it and ate the
          // operator's next click. Inside a dialog that click is the modal's own X,
          // which is why closing it seemed to need two clicks.
          // A `data-[state=closed]:pointer-events-none` class does NOT fix this:
          // Radix's inline style wins over the stylesheet. Dropping the exit
          // keyframes makes `animationName` resolve to `none`, so Presence unmounts
          // the layer synchronously and the dead element never exists at all.
          // The enter animation stays — it shows where the panel came from.
          //
          // max-h/overflow: without a clamp Radix grows the popper to fit its
          // content and then shifts it to fit the viewport — a long list ends up
          // starting at a negative y with its first rows off-screen and no way to
          // scroll to them. Same clamp dropdown-menu, select and context-menu
          // already carry, so every popover in the app stays reachable.
          'bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 max-h-(--radix-popover-content-available-height) w-72 origin-(--radix-popover-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-md border p-4 shadow-md outline-hidden',
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
}

function PopoverAnchor({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />
}

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor }
