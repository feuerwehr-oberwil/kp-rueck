"use client"

/**
 * «Kennzahlen» as a modal — the live Lage numbers and Reaktionszeiten of the
 * selected Ereignis (on a training Ereignis: the Übungsauswertung).
 *
 * Was a footer pill + footer sheet. The owner moved it into the user menu
 * (10.10.2026): it is looked at now and then, not worked in, so it does not earn
 * a place in the toolbar an operator scans all shift. One dialog for every page,
 * mounted once by the root layout (it used to sit in the desk's user menu, so the
 * phone's «Mehr» → «Kennzahlen» opened nothing); the user menu, `Z` on the board,
 * the palette and «Mehr» open it through `toggleFigures()`.
 */

import { useEffect, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { ResponsiveDialog, ResponsiveDialogBody } from "@/components/ui/responsive-dialog"
import { useIsMobile } from "@/components/ui/use-mobile"
import { EventFiguresPanel } from "@/components/event-figures"
import { useEvent } from "@/lib/contexts/event-context"
import { requestIncidentHighlight } from "@/lib/notification-highlight"
import { boardDetailHref } from "@/lib/incident-detail"
import { OVERVIEW_TARGET } from "@/lib/detail-target"
import { emitAppEvent, onAppEvent } from "@/lib/app-events"

/** Open the Kennzahlen dialog, or close it when it is open. */
export function toggleFigures() {
  emitAppEvent("kp:toggle-figures")
}

export function FiguresDialog() {
  const t = useTranslations("events.figures")
  const { selectedEvent } = useEvent()
  const [open, setOpen] = useState(false)
  const pathname = usePathname()
  const router = useRouter()
  const isPhone = useIsMobile()

  useEffect(() => onAppEvent("kp:toggle-figures", () => setOpen((prev) => !prev)), [])

  // The oldest waiting «hoch» Meldung opens on the board, on Übersicht (it is a
  // dispatch question): in place when the board is the page, through its deep link
  // from anywhere else. In place it may take the modal (`allowModal`,
  // lib/notification-highlight.ts) – the dialog has just closed, so it covers no
  // list: the phone gets its Einsatz sheet, a desk under 1536px the modal, a wider
  // desk the side panel. Without it a 1280px desk only ringed the card.
  const openIncident = (incidentId: string) => {
    setOpen(false)
    if (pathname === "/") requestIncidentHighlight(incidentId, { ...OVERVIEW_TARGET, allowModal: true })
    else router.push(boardDetailHref(incidentId, OVERVIEW_TARGET))
  }

  const title = t(selectedEvent?.training_flag ? "titleTraining" : "title")
  const panel = <EventFiguresPanel eventId={selectedEvent?.id ?? null} enabled={open} onOpenIncident={openIncident} />

  // The phone: the one bottom sheet (FRONTEND.md, phone geometry) – it opens without focusing
  // anything, and the Ereignis is its own line under the title. A desk names it in the title.
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={setOpen}
      title={
        isPhone ? title : (
          <>
            {title}
            {selectedEvent && <span className="font-normal text-muted-foreground"> · {selectedEvent.name}</span>}
          </>
        )
      }
      description={isPhone ? selectedEvent?.name : undefined}
      size="md"
      className="modal-h-tall overflow-y-auto"
    >
      {/* Desk: `contents` – the panel's parts stay cells of the window's grid, 16px apart. */}
      <ResponsiveDialogBody className="contents" sheetClassName="pt-1 pb-sheet-safe">{panel}</ResponsiveDialogBody>
    </ResponsiveDialog>
  )
}
