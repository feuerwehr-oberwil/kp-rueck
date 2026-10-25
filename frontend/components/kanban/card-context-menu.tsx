"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import Link from "next/link"
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu"
import { Users, Package, Truck, Binoculars, PenLine, Map, Building2, Printer, Timer, CheckCircle2, ArrowRightLeft, Waypoints, Route, Trash2 } from 'lucide-react'
import { type Operation } from "@/lib/contexts/operations-context"
import { apiClient } from "@/lib/api-client"
import { toast } from "sonner"
import { usePrintJobToast } from "@/lib/hooks/use-print-job-toast"

interface CardContextMenuProps {
  operation: Operation
  /** The Auftrag (route) this card is a stop of, if any — offers «Routen-Editor». */
  auftragId?: string
  /** «Bearbeiten»: open the detail, untargeted. */
  onEdit: () => void
  onAssignReko?: () => void
  onAssignResource?: (resourceType: 'crew' | 'vehicles' | 'materials', operationId: string) => void
  onTransfer?: () => void
  onDistributeToAuftrag?: () => void
  onToggleNachbarhilfe?: () => void
  onToggleAmWarten?: () => void
  onRequestComplete?: () => void
  onRequestDelete?: () => void
  printerEnabled?: boolean
}

/**
 * The right-click menu of an Einsatz card. Rendered by `DraggableOperation` as
 * the content of its `<ContextMenu>`, next to the trigger that wraps the card.
 * A row shows only when its handler is passed – the board passes the editing
 * ones to editors only. Owns the thermal-print action and its busy state.
 *
 * Re-renders with the card (not memoised), so it never shows a stale label.
 */
export function CardContextMenu({
  operation,
  auftragId,
  onEdit,
  onAssignReko,
  onAssignResource,
  onTransfer,
  onDistributeToAuftrag,
  onToggleNachbarhilfe,
  onToggleAmWarten,
  onRequestComplete,
  onRequestDelete,
  printerEnabled,
}: CardContextMenuProps) {
  const t = useTranslations('kanban')
  const tPrint = useTranslations('print.toasts')
  const trackPrint = usePrintJobToast()
  const [isPrinting, setIsPrinting] = useState(false)

  // Handle thermal print. The "gesendet" toast is now the START of the story —
  // trackPrintJob replaces it with what the printer actually did.
  const handlePrint = async () => {
    if (isPrinting) return
    setIsPrinting(true)
    try {
      const job = await apiClient.queueAssignmentPrint(operation.id)
      trackPrint(job.id, { sentTitle: t('common.printJobSent'), subject: tPrint('subjectSlip') })
    } catch (error) {
      console.error('Print failed:', error)
      toast.error(t('common.printFailed'))
    } finally {
      setIsPrinting(false)
    }
  }

  return (
    <ContextMenuContent
      className="w-max min-w-52 max-w-[min(22rem,var(--radix-context-menu-content-available-width))] [&_[data-slot=context-menu-item]]:whitespace-nowrap [&_[data-slot=context-menu-sub-trigger]]:whitespace-nowrap max-h-[var(--radix-context-menu-content-available-height)] overflow-y-auto"
      collisionPadding={{ top: 8, bottom: 80, left: 8, right: 8 }}
    >
      {/* Bearbeiten */}
      <ContextMenuItem onClick={() => onEdit()}>
        <PenLine className="mr-2 h-4 w-4" />
        {t('common.edit')}
      </ContextMenuItem>

      {/* Zuweisen — reko, crew, vehicle, material, and resource transfer */}
      {(onAssignReko || onAssignResource || onTransfer || onDistributeToAuftrag) && (
        <>
          <ContextMenuSeparator />
          {onAssignReko && (
            <ContextMenuItem onClick={() => onAssignReko()}>
              <Binoculars className="mr-2 h-4 w-4" />
              {operation.assignedReko ? t('card.changeReko') : t('card.assignReko')}
            </ContextMenuItem>
          )}
          {onAssignResource && (
            <>
              <ContextMenuItem onClick={() => onAssignResource('crew', operation.id)}>
                <Users className="mr-2 h-4 w-4" />
                {t('common.assignCrew')}
              </ContextMenuItem>
              <ContextMenuItem onClick={() => onAssignResource('vehicles', operation.id)}>
                <Truck className="mr-2 h-4 w-4" />
                {t('common.assignVehicle')}
              </ContextMenuItem>
              <ContextMenuItem onClick={() => onAssignResource('materials', operation.id)}>
                <Package className="mr-2 h-4 w-4" />
                {t('common.assignMaterial')}
              </ContextMenuItem>
            </>
          )}
          {onTransfer && (
            <ContextMenuItem onClick={() => onTransfer()}>
              <ArrowRightLeft className="mr-2 h-4 w-4" />
              {t('common.transferResources')}
            </ContextMenuItem>
          )}
          {onDistributeToAuftrag && (
            <ContextMenuItem onClick={() => onDistributeToAuftrag()}>
              <Waypoints className="mr-2 h-4 w-4" />
              {t('common.distributeToAuftrag')}
            </ContextMenuItem>
          )}
          {/* Only on cards that stand on a route, editor-gated like distribute.
              Same window-event channel as the Auftrag chip (no prop threading);
              the stop under the cursor arrives focused. */}
          {auftragId && onDistributeToAuftrag && (
            <ContextMenuItem
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent('kp:open-routen-editor', {
                    detail: { groupId: auftragId, focusIncidentId: operation.id },
                  })
                )
              }
            >
              <Route className="mr-2 h-4 w-4" />
              {t('common.openRoutenEditor')}
            </ContextMenuItem>
          )}
        </>
      )}

      {/* Markieren — quick status flags. «Zu Fuss» is deliberately NOT here
          any more: it lives in the vehicle assignment dialog (where the
          not-a-vehicle choice belongs) and on the card's own zu-Fuss chip. */}
      {(onToggleNachbarhilfe || onToggleAmWarten) && (
        <>
          <ContextMenuSeparator />
          {onToggleNachbarhilfe && (
            <ContextMenuItem onClick={() => onToggleNachbarhilfe()}>
              <Building2 className="mr-2 h-4 w-4" />
              {operation.nachbarhilfe ? t('card.removeNachbarhilfe') : t('card.markNachbarhilfe')}
            </ContextMenuItem>
          )}
          {onToggleAmWarten && (
            <ContextMenuItem onClick={() => onToggleAmWarten()}>
              <Timer className="mr-2 h-4 w-4" />
              {operation.amWarten ? t('card.removeAmWarten') : t('card.markAmWarten')}
            </ContextMenuItem>
          )}
        </>
      )}

      {/* Status — lifecycle. Editor-only: archive an incident that turned out
          not to be relevant (same completion path as dragging to ABGESCHLOSSEN),
          or delete one that was never an incident at all. Two intentions, two
          rows: «abgeschlossen» is a statement about work that happened, and a
          typo that gets closed sits in the Einsatzhistorie for ever. */}
      {((onRequestComplete && operation.status !== "complete") || onRequestDelete) && <ContextMenuSeparator />}
      {onRequestComplete && operation.status !== "complete" && (
        <ContextMenuItem onClick={() => onRequestComplete()}>
          <CheckCircle2 className="mr-2 h-4 w-4" />
          {t('card.completeIncident')}
        </ContextMenuItem>
      )}
      {onRequestDelete && (
        <ContextMenuItem variant="destructive" onClick={() => onRequestDelete()}>
          <Trash2 className="mr-2 h-4 w-4" />
          {t('card.deleteIncident')}
        </ContextMenuItem>
      )}

      {/* Ansicht & Druck */}
      <ContextMenuSeparator />
      <ContextMenuItem asChild>
        <Link href={`/map?highlight=${operation.id}`}>
          <Map className="mr-2 h-4 w-4" />
          {t('card.showOnMapMenu')}
        </Link>
      </ContextMenuItem>
      {printerEnabled && (
        <ContextMenuItem onClick={handlePrint} disabled={isPrinting}>
          <Printer className="mr-2 h-4 w-4" />
          {isPrinting ? t('card.printing') : t('common.printSlip')}
        </ContextMenuItem>
      )}
    </ContextMenuContent>
  )
}
