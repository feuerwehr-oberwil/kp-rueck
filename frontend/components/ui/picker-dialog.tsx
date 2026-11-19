'use client'

import type { ReactNode } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useIsMobile } from '@/components/ui/use-mobile'
import { SurfaceStep, SurfaceStepEscHint, useOpenSurface } from '@/components/ui/surface-step'

/**
 * The frame of a «pick one person» window (Fahrer, Reko zuweisen, Rekos übertragen): a
 * centred dialog on a desk, a bottom sheet on a phone – the assignment dialog's switch
 * (ENT-10 A). Header (title, and one line under it – required: it is the dialog's
 * description, truncated with the full text in `title`), an optional `toolbar` that stays put
 * (search, «Person hinzufügen»), the list as the ONE scroller, and the `footer` answers – on
 * the phone equal halves standing on the keys, with grip and swipe-to-close through
 * `onOpenChange`.
 *
 * Fixed height on the phone (`h-[88dvh]`, the `modal-h-tall` cap) like the assignment and
 * Appell sheets: a sheet sized to its list shrinks with every letter searched and the search
 * field slides away under the thumb. The sheet opens without focusing a field
 * (`ui/sheet.tsx`), so a picker must not `autoFocus` its search on the phone either.
 *
 * `radioGroupLabel` makes the list the `radiogroup` of single-choice tiles
 * (`PersonPickTile single`); it names the group for a screen reader.
 *
 * On a desk it is an S window (512, dialog-frame.ts) – unless a work surface is open
 * (Fahrzeuge zuweisen, Einsatz-Detail, the Fahrzeuge sheet): then it opens INSIDE that
 * surface as a step (surface-step.tsx, owner pick 5A) with «← Zurück», Esc back to the
 * surface, and the list in two columns across the surface's width. Zurück and Esc are
 * `onOpenChange(false)`, like Abbrechen.
 */
export function PickerDialog({
  open,
  onOpenChange,
  title,
  description,
  toolbar,
  children,
  footer,
  listTestId,
  radioGroupLabel,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description: ReactNode
  toolbar?: ReactNode
  children: ReactNode
  footer: ReactNode
  listTestId?: string
  radioGroupLabel?: string
}) {
  const isMobile = useIsMobile()
  const surface = useOpenSurface()
  const fullDescription = typeof description === 'string' ? description : undefined
  const listRole = radioGroupLabel ? { role: 'radiogroup', 'aria-label': radioGroupLabel } : {}

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          className="h-[88dvh] modal-h-tall gap-0 rounded-t-2xl [--close-centre:31px]"
        >
          <SheetHeader className="gap-1 px-4 pt-5 pb-3 pr-12 text-left">
            <SheetTitle className="text-lg leading-[1.375rem] font-semibold">{title}</SheetTitle>
            <SheetDescription className="truncate text-xs" title={fullDescription}>{description}</SheetDescription>
          </SheetHeader>
          {toolbar && <div className="flex shrink-0 flex-col gap-3 px-4 pb-3">{toolbar}</div>}
          <SheetBody data-testid={listTestId} {...listRole} className="space-y-2 px-4 pb-4">
            {children}
          </SheetBody>
          <SheetFooter className="mt-0 flex-row gap-2 border-t px-4 pt-3 pb-sheet-safe [&>*]:min-h-11 [&>*]:flex-1">
            {footer}
          </SheetFooter>
        </SheetContent>
      </Sheet>
    )
  }

  if (surface) {
    if (!open) return null
    return (
      <SurfaceStep host={surface} title={title} description={description} onBack={() => onOpenChange(false)}>
        {toolbar && <div className="flex shrink-0 flex-col gap-3 px-5 pb-3">{toolbar}</div>}
        <div
          data-testid={listTestId}
          {...listRole}
          // The surface's width is the step's: two columns of tiles (mock 5A); a section
          // caption (a `p` among the tiles) spans both.
          className="relative grid min-h-0 flex-1 auto-rows-min content-start gap-x-4 gap-y-2 overflow-y-auto overscroll-contain px-5 pb-3 lg:grid-cols-2 [&>p]:col-span-full [&>[data-slot=empty-state]]:col-span-full [&>*:only-child]:col-span-full"
        >
          {children}
        </div>
        <DialogFooter className="shrink-0 border-t px-5 py-3">
          <SurfaceStepEscHint host={surface} />
          {footer}
        </DialogFooter>
      </SurfaceStep>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex modal-h-tall flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="gap-1 px-5 pt-5 pb-3 pr-12">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="truncate" title={fullDescription}>{description}</DialogDescription>
        </DialogHeader>
        {toolbar && <div className="flex shrink-0 flex-col gap-3 px-5 pb-3">{toolbar}</div>}
        <div data-testid={listTestId} {...listRole} className="relative min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain px-5 pb-3">
          {children}
        </div>
        <DialogFooter className="border-t px-5 py-3">{footer}</DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
