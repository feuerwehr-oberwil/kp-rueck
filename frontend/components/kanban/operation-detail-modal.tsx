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
      <DialogContent aria-describedby={undefined} className="!w-[90vw] !h-[85vh] !max-w-6xl !pb-2 flex flex-col overflow-hidden">
        <DialogTitle className="sr-only">{formatLocationForDisplay(operation.location, getGlobalHomeCity()) || operation.incidentType}</DialogTitle>
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
