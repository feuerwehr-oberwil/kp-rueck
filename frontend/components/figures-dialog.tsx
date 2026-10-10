"use client"

/**
 * «Kennzahlen» as a modal — the live Lage numbers and Reaktionszeiten of the
 * selected Ereignis (on a training Ereignis: the Übungsauswertung).
 *
 * Was a footer pill + footer sheet. The owner moved it into the user menu
 * (10.10.2026): it is looked at now and then, not worked in, so it does not earn
 * a place in the toolbar an operator scans all shift. One dialog for every page,
 * mounted by the user menu; `Z` on the board, the palette and the phone's «Mehr»
 * open the same one through `toggleFigures()`.
 */

import { useEffect, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { EventFiguresPanel } from "@/components/event-figures"
import { useEvent } from "@/lib/contexts/event-context"
import { requestIncidentHighlight } from "@/lib/notification-highlight"

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

  useEffect(() => {
    const toggle = () => setOpen((prev) => !prev)
    window.addEventListener(TOGGLE_FIGURES_EVENT, toggle)
    return () => window.removeEventListener(TOGGLE_FIGURES_EVENT, toggle)
  }, [])

  // The oldest waiting «hoch» Meldung opens on the board: in place when the board
  // is the page, through its deep link from anywhere else.
  const openIncident = (incidentId: string) => {
    setOpen(false)
    if (pathname === "/") requestIncidentHighlight(incidentId)
    else router.push(`/?highlight=${encodeURIComponent(incidentId)}&detail=1`)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-2xl max-h-[90dvh] overflow-y-auto" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>
            {t(selectedEvent?.training_flag ? "titleTraining" : "title")}
            {selectedEvent && <span className="font-normal text-muted-foreground"> · {selectedEvent.name}</span>}
          </DialogTitle>
        </DialogHeader>
        <EventFiguresPanel eventId={selectedEvent?.id ?? null} enabled={open} onOpenIncident={openIncident} />
      </DialogContent>
    </Dialog>
  )
}
