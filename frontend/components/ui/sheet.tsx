'use client'

import * as React from 'react'
import * as SheetPrimitive from '@radix-ui/react-dialog'
import { XIcon } from 'lucide-react'

import { cn } from '@/lib/utils'
import { ignoreToastLayer } from '@/lib/toast-layer'
import { OVERLAY_CLASS } from '@/components/ui/overlay'
import { registerBottomSheet, scheduleSheetTop } from '@/lib/viewport-insets'
import {
  HANDLE_SELECTOR,
  NO_DRAG_SELECTOR,
  SNAP_MS,
  canStartSwipe,
  dragOffset,
  releaseVelocity,
  shouldDismiss,
  swipeIntent,
} from '@/lib/sheet-swipe'

function Sheet({ ...props }: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />
}

function SheetTrigger({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetClose({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />
}

function SheetPortal({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Portal>) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />
}

function SheetOverlay({
  className,
  overlayOffset,
  rightInset,
  elevated,
  nonModal,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Overlay> & {
  overlayOffset?: string
  /** CSS length keeping the overlay (and, via SheetContent, a bottom sheet)
   *  clear of a right-side panel — e.g. the open notification sidebar. */
  rightInset?: string
  elevated?: boolean
  nonModal?: boolean
}) {
  // For non-modal sheets, use a simple div backdrop instead of Radix Overlay.
  //
  // It ABSORBS the pointer (`pointer-events-auto`), and its `bottom` stops at
  // the footer toolbar — which is the whole shape of a footer sheet: the
  // toolbar underneath stays live, everything the backdrop dims does not. It
  // used to be `pointer-events-none`, so the dimmed board still lit up its
  // hover states and handed clicks through to cards nobody was aiming at.
  if (nonModal) {
    return (
      <div
        data-slot="sheet-overlay"
        className={cn(
          'fixed inset-0',
          OVERLAY_CLASS,
          elevated ? 'z-[70]' : 'z-50',
          className,
        )}
        style={
          overlayOffset || rightInset
            ? {
                ...(overlayOffset ? { bottom: overlayOffset } : undefined),
                ...(rightInset ? { right: rightInset } : undefined),
              }
            : undefined
        }
      />
    )
  }

  return (
    <SheetPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn(
        // NO exit animation — see the note in dialog.tsx. Measured on a closed
        // mobile sheet: overlay `closed`, the full 375x667 viewport, inline and
        // computed `pointer-events: auto`, still mounted 300ms after dismissal.
        'data-[state=open]:animate-in data-[state=open]:fade-in-0 fixed inset-0',
        OVERLAY_CLASS,
        elevated ? 'z-[70]' : 'z-50',
        className,
      )}
      style={
        overlayOffset || rightInset
          ? {
              ...(overlayOffset ? { bottom: overlayOffset } : undefined),
              ...(rightInset ? { right: rightInset } : undefined),
            }
          : undefined
      }
      {...props}
    />
  )
}

/** The scrolling ancestor between `from` and the sheet (the sheet itself included). */
function scrollerWithin(from: Element | null, sheet: HTMLElement): HTMLElement | null {
  let node: Element | null = from
  while (node) {
    if (node instanceof HTMLElement) {
      const oy = getComputedStyle(node).overflowY
      if ((oy === 'auto' || oy === 'scroll') && node.scrollHeight > node.clientHeight) return node
    }
    if (node === sheet) break
    node = node.parentElement
  }
  return null
}

/**
 * Swipe-to-dismiss on a phone bottom sheet — the DOM half of lib/sheet-swipe.ts (the rules are
 * documented there). Native touch listeners rather than pointer events: a pull that starts over
 * a scroller has to be able to claim the gesture (`preventDefault` on a non-passive touchmove)
 * before the browser turns it into an overscroll and cancels the pointer. Mouse users keep the ✕
 * and the backdrop. Returns the cleanup.
 */
function attachSwipe(el: HTMLElement, requestClose: () => void): () => void {
  type Drag = {
    id: number
    x0: number
    y0: number
    scroller: HTMLElement | null
    engaged: boolean
    offset: number
    samples: { y: number; t: number }[]
  }
  let drag: Drag | null = null
  let snapTimer: ReturnType<typeof setTimeout> | undefined
  const reducedMotion = () =>
    typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  const settle = (animate: boolean) => {
    clearTimeout(snapTimer)
    el.style.transition = animate ? `transform ${SNAP_MS}ms ease-out` : 'none'
    el.style.transform = ''
    snapTimer = setTimeout(() => {
      el.style.transition = ''
      scheduleSheetTop()
    }, animate ? SNAP_MS : 0)
  }
  const touchOf = (e: TouchEvent, id: number) =>
    Array.from(e.changedTouches).find((t) => t.identifier === id) ?? null

  const onStart = (e: TouchEvent) => {
    if (e.touches.length !== 1) {
      if (drag?.engaged) settle(!reducedMotion())
      drag = null
      return
    }
    const target = e.target instanceof Element ? e.target : null
    const onHandle = !!target?.closest(HANDLE_SELECTOR)
    const scroller = onHandle ? null : scrollerWithin(target, el)
    const ok = canStartSwipe({
      onControl: !!target?.closest(NO_DRAG_SELECTOR),
      onHandle,
      scrollTop: scroller ? scroller.scrollTop : null,
    })
    if (!ok) return
    const t = e.touches[0]
    drag = {
      id: t.identifier, x0: t.clientX, y0: t.clientY, scroller, engaged: false, offset: 0,
      samples: [{ y: t.clientY, t: e.timeStamp }],
    }
  }

  const onMove = (e: TouchEvent) => {
    const d = drag
    if (!d) return
    const t = touchOf(e, d.id)
    if (!t) return
    const dx = t.clientX - d.x0
    const dy = t.clientY - d.y0
    if (!d.engaged) {
      const intent = swipeIntent(dx, dy)
      if (intent === 'reject') { drag = null; return }
      // a downward pull from the top of the content: claim it before the browser overscrolls
      if (dy > 0 && e.cancelable) e.preventDefault()
      if (intent === 'pending') return
      // the content may have moved under the finger since the press
      if (d.scroller && d.scroller.scrollTop > 0) { drag = null; return }
      d.engaged = true
      clearTimeout(snapTimer)
      el.style.transition = 'none'
    }
    if (e.cancelable) e.preventDefault()
    d.offset = dragOffset(dy)
    d.samples.push({ y: t.clientY, t: e.timeStamp })
    if (d.samples.length > 12) d.samples.shift()
    el.style.transform = `translateY(${d.offset}px)`
  }

  const onEnd = (e: TouchEvent) => {
    const d = drag
    if (!d || !touchOf(e, d.id)) return
    drag = null
    if (!d.engaged) return
    if (shouldDismiss(d.offset, releaseVelocity(d.samples))) {
      // straight back into place, then ask: a guarded `onOpenChange` (unsaved changes) may keep
      // the sheet open, and then it must be standing where it was
      settle(false)
      requestClose()
      return
    }
    settle(!reducedMotion())
  }

  const onCancel = (e: TouchEvent) => {
    const d = drag
    if (!d || !touchOf(e, d.id)) return
    drag = null
    if (d.engaged) settle(!reducedMotion())
  }

  el.addEventListener('touchstart', onStart, { passive: true })
  el.addEventListener('touchmove', onMove, { passive: false })
  el.addEventListener('touchend', onEnd)
  el.addEventListener('touchcancel', onCancel)
  return () => {
    clearTimeout(snapTimer)
    el.removeEventListener('touchstart', onStart)
    el.removeEventListener('touchmove', onMove)
    el.removeEventListener('touchend', onEnd)
    el.removeEventListener('touchcancel', onCancel)
  }
}

function SheetContent({
  className,
  children,
  side = 'right',
  hideCloseButton = false,
  overlayOffset,
  rightInset,
  elevated = false,
  nonModal = false,
  swipeToClose = true,
  onInteractOutside,
  onOpenAutoFocus,
  style,
  ref,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
  side?: 'top' | 'right' | 'bottom' | 'left'
  hideCloseButton?: boolean
  overlayOffset?: string
  /** Keeps a bottom sheet AND its backdrop clear of a right-side panel (the
   *  open notification sidebar) so the two sit side by side instead of the
   *  sheet sliding underneath. CSS length; only applied to `side="bottom"`. */
  rightInset?: string
  elevated?: boolean
  nonModal?: boolean
  /**
   * Phone bottom sheets: a grip at the top and swipe-down-to-close (lib/sheet-swipe.ts). On by
   * default — it is what the shape promises. The close goes through Radix, i.e. through the
   * caller's `onOpenChange`, so a form guarding that (useUnsavedChangesWarning) asks instead of
   * closing. `false` for a surface that owns the vertical gesture itself.
   */
  swipeToClose?: boolean
}) {
  const isBottom = side === 'bottom'
  // A desktop footer sheet is docked above the toolbar (offset, non-modal): no keyboard to
  // stand on, no grip, no swipe — a mouse has the ✕ and the backdrop.
  const docked = isBottom && (!!overlayOffset || nonModal)
  const swipe = isBottom && !docked && swipeToClose
  const phoneSheet = isBottom && !docked

  // A phone sheet never raises the keyboard by itself: Radix would focus the first field, and
  // on a phone that is half the screen gone before the operator chose a field. Focus goes to
  // the sheet (keyboard users Tab on from there); a caller's own handler still wins.
  const handleOpenAutoFocus = React.useCallback(
    (event: Event) => {
      onOpenAutoFocus?.(event)
      if (!phoneSheet || event.defaultPrevented) return
      event.preventDefault()
      if (event.target instanceof HTMLElement) event.target.focus({ preventScroll: true })
    },
    [onOpenAutoFocus, phoneSheet],
  )
  const closeRef = React.useRef<HTMLButtonElement | null>(null)

  // One callback ref does the per-mount work: Radix mounts the Content only while open, so
  // this is exactly «while the sheet is on screen».
  const attach = React.useCallback(
    (node: HTMLDivElement | null) => {
      if (!node || !isBottom) return
      const unregister = registerBottomSheet(node)
      const detach = swipe ? attachSwipe(node, () => closeRef.current?.click()) : undefined
      return () => {
        detach?.()
        unregister()
      }
    },
    [isBottom, swipe],
  )
  const mergedRef = React.useCallback(
    (node: HTMLDivElement | null) => {
      const cleanup = attach(node)
      if (typeof ref === 'function') ref(node)
      else if (ref) ref.current = node
      return () => {
        cleanup?.()
        if (typeof ref === 'function') ref(null)
        else if (ref) ref.current = null
      }
    },
    [attach, ref],
  )

  return (
    <SheetPortal>
      <SheetOverlay overlayOffset={overlayOffset} rightInset={rightInset} elevated={elevated} nonModal={nonModal} />
      <SheetPrimitive.Content
        ref={mergedRef}
        data-slot="sheet-content"
        data-side={side}
        data-docked={docked ? '' : undefined}
        data-swipe={swipe ? '' : undefined}
        // Dismissing a toast must never dismiss the slide-up behind it; any
        // other outside interaction still reaches the caller's own guard.
        onInteractOutside={ignoreToastLayer(onInteractOutside)}
        onOpenAutoFocus={handleOpenAutoFocus}
        className={cn(
          // The slide-out goes with it. The closed Content was measured lingering
          // over 375x587 with `pointer-events: auto` for the full 300ms — and
          // the panel has to leave with its backdrop, or the board shows through
          // under a still-sliding sheet. Entering still slides.
          'bg-background data-[state=open]:animate-in fixed flex flex-col gap-4 shadow-lg transition ease-in-out data-[state=open]:duration-500',
          elevated ? 'z-[70]' : 'z-50',
          side === 'right' &&
            'data-[state=open]:slide-in-from-right inset-y-0 right-0 h-full w-3/4 border-l sm:max-w-sm',
          side === 'left' &&
            'data-[state=open]:slide-in-from-left inset-y-0 left-0 h-full w-3/4 border-r sm:max-w-sm',
          side === 'top' &&
            'data-[state=open]:slide-in-from-top inset-x-0 top-0 h-auto border-b',
          side === 'bottom' &&
            'data-[state=open]:slide-in-from-bottom inset-x-0 bottom-0 h-auto border-t rounded-t-lg outline-none',
          className,
        )}
        // Merge instead of letting a caller-provided `style` (even undefined,
        // spread via props) clobber the computed footer offset — that exact
        // clobbering made bottom sheets render flush to the viewport and clip
        // behind the footer toolbar.
        style={{
          ...(side === 'bottom' && overlayOffset ? { bottom: overlayOffset } : undefined),
          // An undocked bottom sheet sits on `bottom-0`; while a keyboard is up globals.css
          // moves it into the visible band (`top: --vv-top; height: --vv-height`), footer on
          // the keys. Not inline: an inline `bottom` would beat that rule. lib/viewport-insets.ts.
          ...(side === 'bottom' && rightInset ? { right: rightInset } : undefined),
          ...style,
        }}
        {...props}
      >
        {swipe && (
          <div
            data-slot="sheet-grip"
            aria-hidden="true"
            className="absolute inset-x-0 top-0 z-10 flex h-5 touch-none items-start justify-center pt-2"
          >
            <span className="bg-muted-foreground/30 h-1 w-10 rounded-full" />
          </div>
        )}
        {children}
        {swipe && (
          // What the swipe presses: the close goes through Radix → the caller's onOpenChange.
          <SheetPrimitive.Close ref={closeRef} hidden tabIndex={-1} aria-hidden="true" data-slot="sheet-swipe-close" />
        )}
        {!hideCloseButton && (
          <SheetPrimitive.Close data-slot="sheet-close" className="ring-offset-background focus:ring-ring data-[state=open]:bg-secondary absolute top-4 right-4 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none cursor-pointer">
            <XIcon className="size-4" />
            <span className="sr-only">Close</span>
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Content>
    </SheetPortal>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-header"
      className={cn('flex flex-col gap-1.5 p-4', className)}
      {...props}
    />
  )
}

/**
 * The scrolling middle of a sheet with a fixed head and a footer that must stay on screen
 * (a form: «Abbrechen» / «Speichern» above the keyboard). Give the SheetContent a max height
 * (`modal-h-tall`) and `gap-0`; this takes what is left and scrolls.
 */
function SheetBody({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-body"
      className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain', className)}
      {...props}
    />
  )
}

function SheetFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn('mt-auto flex flex-col gap-2 p-4', className)}
      {...props}
    />
  )
}

function SheetTitle({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn('text-foreground font-semibold', className)}
      {...props}
    />
  )
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn('text-muted-foreground text-sm', className)}
      {...props}
    />
  )
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetBody,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
