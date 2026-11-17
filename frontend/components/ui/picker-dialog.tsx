'use client'

import type { ReactNode } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useIsMobile } from '@/components/ui/use-mobile'

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
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description: ReactNode
  toolbar?: ReactNode
  children: ReactNode
  footer: ReactNode
  listTestId?: string
}) {
  const isMobile = useIsMobile()
  const fullDescription = typeof description === 'string' ? description : undefined

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
          <SheetBody data-testid={listTestId} className="space-y-2 px-4 pb-4">
            {children}
          </SheetBody>
          <SheetFooter className="mt-0 flex-row gap-2 border-t px-4 pt-3 pb-sheet-safe [&>*]:min-h-11 [&>*]:flex-1">
            {footer}
          </SheetFooter>
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex modal-h-tall flex-col gap-0 overflow-hidden p-0 sm:max-w-md">
        <DialogHeader className="gap-1 px-5 pt-5 pb-3 pr-12">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="truncate" title={fullDescription}>{description}</DialogDescription>
        </DialogHeader>
        {toolbar && <div className="flex shrink-0 flex-col gap-3 px-5 pb-3">{toolbar}</div>}
        <div data-testid={listTestId} className="relative min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain px-5 pb-3">
          {children}
        </div>
        <DialogFooter className="border-t px-5 py-3">{footer}</DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
