"use client"

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { useEvent } from "@/lib/contexts/event-context"
import {
  OperationDetailContent,
  type OperationDetailContentProps,
} from "@/components/kanban/operation-detail-content"
import type { Operation } from "@/lib/contexts/operations-context"
import { formatLocationForDisplay, getGlobalHomeCity } from "@/lib/utils"

interface OperationDetailModalProps extends Omit<OperationDetailContentProps, 'operation' | 'layout' | 'active'> {
  operation: Operation | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function OperationDetailModal({
  operation,
  open,
  onOpenChange,
  ...contentProps
}: OperationDetailModalProps) {
  const { selectedEvent } = useEvent()

  if (!operation) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="!w-[90vw] !h-[85vh] !max-w-6xl !pb-2 flex flex-col overflow-hidden"
        // Radix parks focus on the first tabbable child when a dialog opens —
        // which is the clock chip in the title row, so the first arrow key lit
        // a focus ring around the time and looked like the shortcut had gone
        // there. The shell takes the focus instead: the arrow-key tab walk
        // listens on the content root, and Tab still walks the header in order.
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          const shell = event.currentTarget
          if (shell instanceof HTMLElement) shell.focus({ preventScroll: true })
        }}
      >
        <DialogTitle className="sr-only">{(operation.locationDisplay ?? formatLocationForDisplay(operation.location, getGlobalHomeCity())) || operation.incidentType}</DialogTitle>
        <OperationDetailContent
          key={`${selectedEvent?.id ?? 'no-event'}:${operation.id}`}
          {...contentProps}
          operation={operation}
          layout="modal"
          active={open}
        />
      </DialogContent>
    </Dialog>
  )
}
