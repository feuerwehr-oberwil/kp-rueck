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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { useIsMobile } from "@/components/ui/use-mobile"
import { EventFiguresPanel } from "@/components/event-figures"
import { useEvent } from "@/lib/contexts/event-context"
import { requestIncidentHighlight } from "@/lib/notification-highlight"
import { isPhoneViewport } from "@/lib/incident-detail"

const TOGGLE_FIGURES_EVENT = "kp:toggle-figures"

/** Open the Kennzahlen dialog, or close it when it is open. */
export function toggleFigures() {
  window.dispatchEvent(new CustomEvent(TOGGLE_FIGURES_EVENT))
}

export function FiguresDialog() {
  const t = useTranslations("events.figures")
  const { selectedEvent } = useEvent()
  const [open, setOpen] = useState(false)
  const pathname = usePathname()
  const router = useRouter()
  const isPhone = useIsMobile()

  useEffect(() => {
    const toggle = () => setOpen((prev) => !prev)
    window.addEventListener(TOGGLE_FIGURES_EVENT, toggle)
    return () => window.removeEventListener(TOGGLE_FIGURES_EVENT, toggle)
  }, [])

  // The oldest waiting «hoch» Meldung opens on the board: in place when the board
  // is the page, through its deep link from anywhere else. On the phone in place
  // means its Einsatz sheet – a highlight alone opens nothing on a narrow screen
  // (`allowModal`, lib/notification-highlight.ts); the desk keeps its side panel.
  const openIncident = (incidentId: string) => {
    setOpen(false)
    if (pathname === "/") requestIncidentHighlight(incidentId, { allowModal: isPhoneViewport() })
    else router.push(`/?highlight=${encodeURIComponent(incidentId)}&detail=1`)
  }

  const title = t(selectedEvent?.training_flag ? "titleTraining" : "title")
  const panel = <EventFiguresPanel eventId={selectedEvent?.id ?? null} enabled={open} onOpenIncident={openIncident} />

  // The phone: a bottom sheet like every phone surface (FRONTEND.md, phone geometry) – it opens
  // without focusing anything (the Sheet primitive focuses the sheet itself), and the Ereignis
  // is its own line under the title. As a centred dialog the title wrapped beside the ✕ and
  // the ✕ wore a focus ring from the first frame (after-shots 14.11.2026).
  if (isPhone) {
    return (
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="modal-h-tall gap-0 p-0">
          {/* The one phone sheet head (SheetHeader's frame, phone sweep 24.11.2026 #30). */}
          <SheetHeader>
            <SheetTitle>{title}</SheetTitle>
            {selectedEvent && <SheetDescription>{selectedEvent.name}</SheetDescription>}
          </SheetHeader>
          <SheetBody className="px-6 pt-1 pb-sheet-safe">{panel}</SheetBody>
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent size="md" className="modal-h-tall overflow-y-auto" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>
            {title}
            {selectedEvent && <span className="font-normal text-muted-foreground"> · {selectedEvent.name}</span>}
          </DialogTitle>
        </DialogHeader>
        {panel}
      </DialogContent>
    </Dialog>
  )
}
