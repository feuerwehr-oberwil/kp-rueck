'use client'

import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useIsMobile } from '@/components/ui/use-mobile'

/**
 * The frame of the Regie's two action sheets (an incident's ⋯, «Störung einspielen»): a
 * bottom sheet on the phone – grip, swipe to close, the body as the one scroller – and an M
 * dialog on a desk. `title` / `description` head it; `children` is the scrolling body.
 */
export function RegieSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description: ReactNode
  children: ReactNode
}) {
  const isMobile = useIsMobile()

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="max-h-[88dvh] modal-h-tall gap-0 rounded-t-2xl [--close-centre:31px]">
          <SheetHeader className="gap-1 px-4 pt-5 pb-3 pr-12 text-left">
            <SheetTitle className="text-lg leading-[1.375rem] font-semibold">{title}</SheetTitle>
            <SheetDescription className="text-xs">{description}</SheetDescription>
          </SheetHeader>
          <SheetBody className="space-y-5 px-4 pb-sheet-safe">{children}</SheetBody>
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" className="flex modal-h-tall flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="gap-1 px-5 pt-5 pb-3 pr-12">
          <DialogTitle className="break-words">{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="relative min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-5 pb-5">{children}</div>
      </DialogContent>
    </Dialog>
  )
}

/** A titled block inside a RegieSheet: the small grey label heading, then its rows. */
export function RegieSheetSection({ title, hint, children }: { title: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <div>
        <h3 className="type-label text-muted-foreground">{title}</h3>
        {hint && <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  )
}

/** One action in a RegieSheet: icon, name and one line saying what it does – the whole tile
 *  is the target. Two to a row in the Störung sheet, one per row in an incident's ⋯. */
export function RegieTile({
  icon: Icon,
  label,
  hint,
  onClick,
  disabled,
}: {
  icon: LucideIcon
  label: string
  hint: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <Button
      variant="outline"
      onClick={onClick}
      disabled={disabled}
      className="h-auto w-full min-w-0 items-start justify-start gap-2.5 px-3 py-2.5 text-left whitespace-normal"
    >
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0">
        <span className="block break-words">{label}</span>
        <span className="block text-xs font-normal break-words text-muted-foreground">{hint}</span>
      </span>
    </Button>
  )
}
