"use client"

/**
 * «Kennzahlen» footer sheet — the live Lage numbers and Reaktionszeiten of the
 * selected Ereignis, one click (or «Z») from the board. On a training Ereignis the
 * same view is titled «Übungsauswertung».
 */

import { useTranslations } from "next-intl"
import { SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { FooterSheet } from "@/components/ui/footer-sheet"
import { EventFiguresPanel } from "@/components/event-figures"
import { getIncidentLocationLabel } from "@/lib/incident-types"
import type { Operation } from "@/lib/contexts/operations-context"

export interface FiguresSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  eventId: string | null
  training: boolean
  operations: Operation[]
  onOpenIncident: (incidentId: string) => void
}

export function FiguresSheet({ open, onOpenChange, eventId, training, operations, onOpenIncident }: FiguresSheetProps) {
  const t = useTranslations("events.figures")
  const label = (id: string) => {
    const op = operations.find((o) => o.id === id)
    return op ? getIncidentLocationLabel(op) : undefined
  }
  return (
    <FooterSheet
      open={open}
      onOpenChange={onOpenChange}
      className="flex flex-col gap-0 max-w-3xl mx-auto px-6 pt-3 pb-4 modal-h-tall"
    >
      <SheetHeader className="flex-row items-baseline gap-2 p-0 shrink-0">
        <SheetTitle className="text-base">{t(training ? "titleTraining" : "title")}</SheetTitle>
        <SheetDescription className="hidden truncate text-xs sm:block">
          {t(training ? "descriptionTraining" : "description")}
        </SheetDescription>
      </SheetHeader>
      <div className="relative mt-3 flex-1 overflow-y-auto pb-2">
        <EventFiguresPanel
          eventId={eventId}
          enabled={open}
          incidentLabel={label}
          onOpenIncident={(id) => {
            onOpenChange(false)
            onOpenIncident(id)
          }}
        />
      </div>
    </FooterSheet>
  )
}
