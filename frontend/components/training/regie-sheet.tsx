'use client'

import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ResponsiveDialog, ResponsiveDialogBody } from '@/components/ui/responsive-dialog'

/**
 * The frame of the Regie's two action sheets (an incident's ⋯, «Störung einspielen»): a
 * `ResponsiveDialog` – the one bottom sheet on the phone, an M dialog in the `panel` frame on
 * a desk, the body as the one scroller. `title` / `description` head it; `children` is the scrolling body.
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
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      size="md"
      frame="panel"
      titleClassName="break-words"
    >
      <ResponsiveDialogBody className="space-y-5 pb-5" sheetClassName="space-y-5 pb-sheet-safe">
        {children}
      </ResponsiveDialogBody>
    </ResponsiveDialog>
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
