'use client'

import * as React from 'react'
import * as SheetPrimitive from '@radix-ui/react-dialog'
import { XIcon } from 'lucide-react'

import { cn } from '@/lib/utils'
import { ignoreToastLayer } from '@/lib/toast-layer'

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
          'fixed inset-0 bg-black/50',
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
        'data-[state=open]:animate-in data-[state=open]:fade-in-0 fixed inset-0 bg-black/50',
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

function SheetContent({
  className,
  children,
  side = 'right',
  hideCloseButton = false,
  overlayOffset,
  rightInset,
  elevated = false,
  nonModal = false,
  onInteractOutside,
  style,
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
}) {
  return (
    <SheetPortal>
      <SheetOverlay overlayOffset={overlayOffset} rightInset={rightInset} elevated={elevated} nonModal={nonModal} />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        // Dismissing a toast must never dismiss the slide-up behind it; any
        // other outside interaction still reaches the caller's own guard.
        onInteractOutside={ignoreToastLayer(onInteractOutside)}
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
            'data-[state=open]:slide-in-from-bottom inset-x-0 bottom-0 h-auto border-t rounded-t-lg',
          className,
        )}
        // Merge instead of letting a caller-provided `style` (even undefined,
        // spread via props) clobber the computed footer offset — that exact
        // clobbering made bottom sheets render flush to the viewport and clip
        // behind the footer toolbar.
        style={{
          ...(side === 'bottom' && overlayOffset ? { bottom: overlayOffset } : undefined),
          ...(side === 'bottom' && rightInset ? { right: rightInset } : undefined),
          ...style,
        }}
        {...props}
      >
        {children}
        {!hideCloseButton && (
          <SheetPrimitive.Close className="ring-offset-background focus:ring-ring data-[state=open]:bg-secondary absolute top-4 right-4 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none cursor-pointer">
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
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
