'use client'

import { createContext, useContext, type ComponentProps, type KeyboardEventHandler, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { DialogSize } from '@/components/ui/dialog-frame'
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useIsMobile } from '@/components/ui/use-mobile'
import { SubjectLine, type Subject } from '@/components/ui/subject-line'

/** The desk frames. `plain` = DialogContent's own padded grid (p-6, gap-4), each part a cell
 *  of it. `panel` = PickerDialog's: no padding, a fixed head, the body as the one scroller, a
 *  hairline over the footer. */
type DeskFrame = 'plain' | 'panel'

const PANEL = {
  content: 'flex modal-h-tall flex-col gap-0 overflow-hidden p-0',
  header: 'gap-1 px-5 pt-5 pb-3 pr-12',
  toolbar: 'flex shrink-0 flex-col gap-3 px-5 pb-3',
  body: 'relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-3',
  footer: 'border-t px-5 py-3',
} as const

/** The one phone sheet frame (FRONTEND.md «Phone geometry»): the head is SheetHeader's frame,
 *  every row under it stands 24px in. */
const SHEET = {
  content: 'modal-h-tall gap-0 p-0',
  toolbar: 'flex shrink-0 flex-col gap-3 px-6 pb-3',
  body: 'px-6 pb-4',
  footer: 'mt-0 flex-row flex-wrap gap-2 border-t px-6 pt-3 pb-sheet-safe [&>*]:min-h-11 [&>*]:flex-1',
} as const

const FrameContext = createContext<{ phone: boolean; frame: DeskFrame }>({ phone: false, frame: 'plain' })

/**
 * A window that is a bottom sheet on a phone and a dialog on a desk – the frame every
 * «Sheet on the phone, Dialog on the desk» surface shares (PickerDialog, Kennzahlen, Neuer
 * Einsatz, Appell, the Regie sheets, …). Compose it from the parts below:
 *
 * ```tsx
 * <ResponsiveDialog open={open} onOpenChange={setOpen} title="…" description="…" size="md">
 *   <ResponsiveDialogToolbar>{search}</ResponsiveDialogToolbar>
 *   <ResponsiveDialogBody>{list}</ResponsiveDialogBody>
 *   <ResponsiveDialogFooter>{cancel}{save}</ResponsiveDialogFooter>
 * </ResponsiveDialog>
 * ```
 *
 * The phone always gets the one sheet frame: the head (title, `subject`, description, `status`)
 * in SheetHeader's frame with no classes, then toolbar, body and footer 24px in; the footer's
 * buttons are equal halves standing on the keys. Grip and swipe-to-close come with the sheet
 * and go through `onOpenChange`. `fill` gives the sheet a fixed height (88dvh), so a list that
 * filters does not shrink the sheet under the thumb.
 *
 * Every `className` here and on the parts styles the DESK only (`frame` picks the base it
 * merges onto) – a phone head takes no classes. A part's `sheetClassName` adds to the phone
 * frame where a part needs it (a body's spacing). A body with no footer under it ends with
 * `sheetClassName="pb-sheet-safe"`.
 */
export function ResponsiveDialog({
  open,
  onOpenChange,
  title,
  subject,
  description,
  hideDescription = false,
  truncateDescription = false,
  status,
  size,
  fill = false,
  frame = 'plain',
  surface,
  onKeyDown,
  className,
  headerClassName,
  titleClassName,
  descriptionClassName,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  /** The Einsatz the window is about, on its own line under the title (`incidentSubject(op)`). */
  subject?: Subject
  /** The line under the title. Without one the window has no description. */
  description?: ReactNode
  /** The description is for screen readers only. */
  hideDescription?: boolean
  /** Desk: the description keeps one line, its full text on hover. The phone head wraps it. */
  truncateDescription?: boolean
  /** A line under the description that must stay in view (a sync status). */
  status?: ReactNode
  /** The desk window's size (dialog-frame.ts). */
  size?: DialogSize
  fill?: boolean
  frame?: DeskFrame
  /** Names a work surface: a picker opened over it opens inside it as a step (surface-step.tsx). */
  surface?: string
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>
  className?: string
  headerClassName?: string
  titleClassName?: string
  descriptionClassName?: string
  children: ReactNode
}) {
  const phone = useIsMobile()
  // Without a description Radix must not point `aria-describedby` at one.
  const describedBy = description === undefined ? { 'aria-describedby': undefined } : {}
  const panel = frame === 'panel'

  if (phone) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          surface={surface}
          className={cn(SHEET.content, fill && 'h-[88dvh]')}
          onKeyDown={onKeyDown}
          {...describedBy}
        >
          <SheetHeader>
            <SheetTitle>{title}</SheetTitle>
            {subject && <SubjectLine subject={subject} />}
            {description !== undefined && (
              // Wraps, and breaks a word wider than the line (a long name), like SheetTitle.
              <SheetDescription className={cn('break-words', hideDescription && 'sr-only')}>{description}</SheetDescription>
            )}
            {status}
          </SheetHeader>
          <FrameContext.Provider value={{ phone, frame }}>{children}</FrameContext.Provider>
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size={size}
        surface={surface}
        className={cn(panel && PANEL.content, className)}
        onKeyDown={onKeyDown}
        {...describedBy}
      >
        <DialogHeader className={cn(panel && PANEL.header, headerClassName)}>
          <DialogTitle className={titleClassName}>{title}</DialogTitle>
          {subject && <SubjectLine subject={subject} />}
          {description !== undefined && (
            <DialogDescription
              className={cn(hideDescription && 'sr-only', truncateDescription && 'truncate', descriptionClassName)}
              title={truncateDescription && typeof description === 'string' ? description : undefined}
            >
              {description}
            </DialogDescription>
          )}
          {status}
        </DialogHeader>
        <FrameContext.Provider value={{ phone, frame }}>{children}</FrameContext.Provider>
      </DialogContent>
    </Dialog>
  )
}

/** Rows that stay put between the head and the body: a search, filters, «Person hinzufügen». */
export function ResponsiveDialogToolbar({ className, children }: { className?: string; children: ReactNode }) {
  const { phone, frame } = useContext(FrameContext)
  const base = phone ? SHEET.toolbar : frame === 'panel' ? PANEL.toolbar : undefined
  return <div className={cn(base, !phone && className)}>{children}</div>
}

/** The body, the window's one scroller. Takes a div's props (a test id, a `radiogroup` role). */
export function ResponsiveDialogBody({
  className,
  sheetClassName,
  ...props
}: ComponentProps<'div'> & { sheetClassName?: string }) {
  const { phone, frame } = useContext(FrameContext)
  if (phone) return <SheetBody className={cn(SHEET.body, sheetClassName)} {...props} />
  return <div className={cn(frame === 'panel' && PANEL.body, className)} {...props} />
}

/** The answers, the main one last. On the phone they are equal halves; a child with
 *  `basis-full!` takes a row of its own (`!`: it must beat the frame's `flex-1`). Takes a div's props (`PICKER_FOOTER`). */
export function ResponsiveDialogFooter({ className, ...props }: ComponentProps<'div'>) {
  const { phone, frame } = useContext(FrameContext)
  if (phone) return <SheetFooter className={SHEET.footer} {...props} />
  return <DialogFooter className={cn(frame === 'panel' && PANEL.footer, className)} {...props} />
}
