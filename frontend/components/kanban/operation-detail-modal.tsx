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
        // One inset on all four sides. It used to override the bottom alone
        // (`!pb-2`), which left the action bar 8px from an 8px-radius corner —
        // the bar sat IN the rounding while everything else kept a 24px gutter.
        // `p-5` rather than the base `p-6`: the four sides now agree, and 20px
        // gives the fixed-height 85dvh dialog back the content height that
        // squaring the bottom would otherwise have cost it.
        // `dvh`, not `vh`: on a mobile browser `vh` is measured against the
        // viewport with the URL bar RETRACTED, so a `vh` dialog is taller than
        // what is actually on screen and its bottom edge — the action bar —
        // sits under the chrome. `dvh` follows the bar as it moves.
        className="!w-[90vw] !h-[85dvh] !max-w-6xl !p-5 flex flex-col overflow-hidden"
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
