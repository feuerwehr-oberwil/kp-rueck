'use client'

import type { ReactNode } from 'react'
import { DialogFooter } from '@/components/ui/dialog'
import { ResponsiveDialog, ResponsiveDialogBody, ResponsiveDialogFooter, ResponsiveDialogToolbar } from '@/components/ui/responsive-dialog'
import { useIsMobile } from '@/components/ui/use-mobile'
import { SurfaceStep, SurfaceStepEscHint, useOpenSurface } from '@/components/ui/surface-step'
import { onPickerKeyDown, PICKER_FOOTER } from '@/components/ui/picker-keys'
import type { Subject } from '@/components/ui/subject-line'

/**
 * The «pick one person» window (Fahrer, Reko zuweisen, Rekos übertragen): a `ResponsiveDialog`
 * – a centred dialog on a desk in its `panel` frame, the one bottom sheet on a phone. Header
 * (title, and one line under it – required: it is the dialog's description, on a desk
 * truncated with the full text in `title`), an optional `toolbar` that stays put (search,
 * «Person hinzufügen»), the list as the ONE scroller, and the `footer` answers – on the phone
 * equal halves standing on the keys, with grip and swipe-to-close through `onOpenChange`.
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
 *
 * Keys (`picker-keys.ts`): Space ticks the focused tile, Enter is the footer's LAST button – so
 * the main answer goes last in `footer` (it does on every caller: Abbrechen, then the answer) –
 * and ↓ / ↑ walk from the search into the tiles and back.
 */
export function PickerDialog({
  open,
  onOpenChange,
  title,
  subject,
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
  /** The Einsatz the pick is for, on its own line under the title (`incidentSubject(op)`). */
  subject?: Subject
  description: ReactNode
  toolbar?: ReactNode
  children: ReactNode
  footer: ReactNode
  listTestId?: string
  radioGroupLabel?: string
}) {
  const isMobile = useIsMobile()
  const surface = useOpenSurface()
  const listRole = radioGroupLabel ? { role: 'radiogroup', 'aria-label': radioGroupLabel } : {}

  if (surface && !isMobile) {
    if (!open) return null
    return (
      <SurfaceStep host={surface} title={title} description={description} onBack={() => onOpenChange(false)}>
        {/* `contents`: the keys' container without a box of its own – the step lays out its rows. */}
        <div className="contents" onKeyDown={onPickerKeyDown}>
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
        <DialogFooter {...PICKER_FOOTER} className="shrink-0 border-t px-5 py-3">
          <SurfaceStepEscHint host={surface} />
          {footer}
        </DialogFooter>
        </div>
      </SurfaceStep>
    )
  }

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      subject={subject}
      description={description}
      truncateDescription
      frame="panel"
      fill
      onKeyDown={onPickerKeyDown}
    >
      {toolbar && <ResponsiveDialogToolbar>{toolbar}</ResponsiveDialogToolbar>}
      <ResponsiveDialogBody data-testid={listTestId} {...listRole} className="space-y-2" sheetClassName="space-y-2">
        {children}
      </ResponsiveDialogBody>
      <ResponsiveDialogFooter {...PICKER_FOOTER}>{footer}</ResponsiveDialogFooter>
    </ResponsiveDialog>
  )
}
