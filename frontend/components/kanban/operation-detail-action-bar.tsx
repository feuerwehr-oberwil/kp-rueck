"use client"

import { useTranslations } from "next-intl"
import { ArrowRightLeft, MessageCircle, Siren, Trash2, Waypoints, type LucideIcon } from 'lucide-react'
import { Button } from "@/components/ui/button"
import { ShellLoader } from '@/components/ui/shell-loader'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { type Material, type Operation } from "@/lib/contexts/operations-context"
import { useWhatsAppCopy } from "@/lib/hooks/use-whatsapp-copy"
import { type VehicleDrivers } from "@/lib/hooks/use-vehicle-drivers"
import { detailTabLayout, type DetailLayout } from "@/components/kanban/operation-detail-tab-layout"

/**
 * One action on the detail's footer bar.
 *
 * The modal has room for the word and shows it. The panel does not have room
 * for the full names — «WhatsApp kopieren · Ressourcen übertragen · An Auftrag
 * verteilen» need ~580px, and wrapping grows the bar into the content. So there
 * the icon carries a HOVER LABEL with the full name, and `panelLabel` — the
 * short word («WhatsApp», «Übertragen», «Verteilen») — stands beside it, 12/500,
 * once the bar is at least 27rem wide (a container query on the bar: the 480px
 * panel from `2xl`, where even a Divera button in the row still leaves the
 * delete its air). The 420px panel keeps the bare icons. Not the browser's `title`: that
 * waits about a second and cannot be styled, which is no help to somebody who
 * does not already know that ⇄ means «Ressourcen übertragen». The app's own
 * tooltip opens with `delayDuration = 0`, i.e. on contact.
 *
 * `aria-label` is set in BOTH layouts, so the control keeps one name regardless
 * of how wide the window happens to be; a `panelLabel` must be a word OF that
 * name, so the visible text stays part of the accessible one.
 *
 * Module level on purpose: declared inside the component it would be a new type
 * every render, and React would remount the button mid-interaction.
 */
function ActionBarButton({
  icon: Icon,
  label,
  visibleLabel,
  panelLabel,
  dense,
  onClick,
  disabled,
  busy = false,
  variant = 'outline',
  className,
}: {
  icon: LucideIcon
  /** The full sentence — accessible name, and the hover label in `dense`. */
  label: string
  /** What the modal prints on the button; defaults to `label`. */
  visibleLabel?: string
  /** The short word the wide panel prints beside the icon (see above). */
  panelLabel?: string
  dense: boolean
  onClick: () => void
  disabled?: boolean
  /** Running: the shell trail takes the icon's place, beside the busy label. */
  busy?: boolean
  variant?: 'outline' | 'ghost'
  className?: string
}) {
  const button = (
    <Button
      variant={variant}
      size="sm"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={className}
    >
      {busy ? <ShellLoader className="size-3.5" /> : <Icon className="size-3.5" />}
      {!dense && (visibleLabel ?? label)}
      {dense && panelLabel && <span className="hidden text-xs font-medium @min-[27rem]:inline">{panelLabel}</span>}
    </Button>
  )

  if (!dense) return button

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  )
}

/**
 * The incident detail's fixed footer: every action on one row, no ⋯. Rendered
 * by `OperationDetailContent` below its tabs, in both mounts.
 *
 * The overflow menu had been reduced to «Löschen» (plus Divera where it is
 * configured), i.e. a button behind a button — and in the 420px panel its
 * content opened downwards into the board footer, where it was clipped.
 * The panel has no room for the full names, so there the full name arrives ON
 * HOVER and the wide panel prints a short word beside the icon — see
 * `ActionBarButton`; `@container` is what its word asks about. Löschen is
 * pushed to the far end by `ml-auto`, away from the things that are merely
 * useful.
 */
export function OperationDetailActionBar({
  operation,
  layout,
  canEdit,
  acceptsAssignments,
  materials,
  vehicleDrivers,
  onDelete,
  diveraEnabled,
  onSendDivera,
  onDistributeToAuftrag,
  onTransferResources,
}: {
  operation: Operation
  layout: DetailLayout
  canEdit: boolean
  acceptsAssignments: boolean
  materials: Material[]
  vehicleDrivers: VehicleDrivers
  onDelete?: (operationId: string) => void
  diveraEnabled?: boolean
  onSendDivera?: (operation: Operation) => void
  onDistributeToAuftrag?: (operationId: string) => void
  onTransferResources?: (operationId: string) => void
}) {
  const t = useTranslations('kanban')
  const { dense } = detailTabLayout(layout)
  const { isCopying: isCopyingWhatsApp, copy: handleCopyWhatsApp } =
    useWhatsAppCopy({ operation, materials, vehicleDrivers })

  return (
    <div className="@container flex-shrink-0 flex items-center gap-2 pt-3 mt-auto border-t">
      <ActionBarButton
        icon={MessageCircle}
        label={t('detail.copyWhatsapp')}
        panelLabel={t('sidePanel.whatsapp')}
        visibleLabel={isCopyingWhatsApp ? t('common.copying') : undefined}
        dense={dense}
        disabled={isCopyingWhatsApp}
        busy={isCopyingWhatsApp}
        onClick={handleCopyWhatsApp}
      />

      {/* Not on a stop: its resources belong to the Auftrag («Aus Auftrag lösen» stays).
          Not on a closed Einsatz: it is no transfer source. */}
      {canEdit && onTransferResources && !operation.groupId && acceptsAssignments && (
        <ActionBarButton
          icon={ArrowRightLeft}
          label={t('common.transferResources')}
          panelLabel={t('sidePanel.transfer')}
          dense={dense}
          onClick={() => onTransferResources(operation.id)}
        />
      )}

      {/* Not on a closed Einsatz: it goes on no Auftrag (lib/assignable.ts). */}
      {canEdit && onDistributeToAuftrag && acceptsAssignments && (
        <ActionBarButton
          icon={Waypoints}
          label={t('common.distributeToAuftrag')}
          panelLabel={t('sidePanel.distribute')}
          dense={dense}
          onClick={() => onDistributeToAuftrag(operation.id)}
        />
      )}

      {canEdit && diveraEnabled && onSendDivera && operation && (
        <ActionBarButton
          icon={Siren}
          label={t('detail.diveraAlarm')}
          dense={dense}
          onClick={() => onSendDivera(operation)}
        />
      )}

      {canEdit && onDelete && (
        <ActionBarButton
          icon={Trash2}
          label={t('common.delete')}
          // Always icon-only: it is the one control here nobody should reach
          // for by accident, and a red word invites the eye to it.
          dense
          variant="ghost"
          className="ml-auto text-destructive hover:bg-destructive/10 hover:text-destructive"
          // Deletes at once – the undo toast is the way back (no «wirklich?»).
          onClick={() => onDelete(operation.id)}
        />
      )}
    </div>
  )
}
