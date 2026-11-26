"use client"

import { useTranslations } from "next-intl"
import { ArrowRightLeft, Binoculars, Check, LayoutDashboard, Link2, UserMinus } from 'lucide-react'
import { ShellLoader } from '@/components/ui/shell-loader'
import RekoReportSection from "@/components/reko/reko-report-section"
import { DetailField, DetailGroupHeading } from "@/components/kanban/detail-field"
import { FieldReportsRow } from "@/components/kanban/field-reports-row"
import { PersonName } from "@/components/person-name"
import { type Operation, useOperations } from "@/lib/contexts/operations-context"
import { type RekoLinkActions } from "@/lib/hooks/use-reko-link-actions"
import { cn } from "@/lib/utils"
import { detailTabLayout, type DetailLayout } from "@/components/kanban/operation-detail-tab-layout"

/**
 * An action that belongs to a `DetailField` row rather than to a toolbar.
 *
 * Grey and underlined, never blue: on this board colour carries status and
 * priority, and a row of four blue words would read as four warnings. Used by
 * the Reko rows, where four `xs` buttons used to wrap over three lines
 * in the 420px panel.
 */
const ROW_ACTION =
  "inline-flex cursor-pointer items-center gap-1 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:cursor-not-allowed disabled:no-underline disabled:opacity-50"

/**
 * The Reko tab: the report as it came in on the left, the Reko-Auftrag — who
 * looks at it, the links that point them here, the event-wide transfer — on
 * the right. Rendered by `OperationDetailContent` inside its Reko tab panel,
 * which also owns the two dialogs `openRekoDialog` / `openRekoTransferDialog`
 * open and `rekoLinks` (so a «copied» tick survives a tab switch).
 */
export function RekoTab({
  operation,
  layout,
  canEdit,
  canAssignReko,
  assignedRekoPersonnel,
  rekoLinks,
  openRekoDialog,
  openRekoTransferDialog,
  onRequestComplete,
}: {
  operation: Operation
  layout: DetailLayout
  canEdit: boolean
  canAssignReko: boolean
  assignedRekoPersonnel: Operation['assignedReko']
  rekoLinks: RekoLinkActions
  openRekoDialog: () => void
  openRekoTransferDialog: () => void
  onRequestComplete?: (operationId: string) => void
}) {
  const t = useTranslations('kanban')
  const { removeReko } = useOperations()
  const { sectionStep, tabGridClass, tabColumnBreakClass } = detailTabLayout(layout)
  const {
    copied: rekoCopied,
    isCopying: isCopyingRekoLink,
    copyDirectLink: handleCopyDirectRekoLink,
    copyDashboardLink: handleCopyDashboardLink,
  } = rekoLinks

  return (
    <div className={tabGridClass}>
      <div className={sectionStep.stack}>
      <RekoReportSection
        incidentId={operation.id}
        canEdit={canEdit}
        // The board mount: the report reads as `DetailField` rows, the
        // same ones the Auftrag column beside it and Übersicht next door
        // use. Modal and 420px panel alike — a row list is the one
        // layout that does not need a second design at that width.
        dense

        // «Reko vor Ort» is a Funkmeldung ABOUT the reconnaissance, so
        // it heads the reading column — the same place and the same
        // component the Feld tab puts «Abholung nötig» in. The two are
        // built as twins and now sit as twins.
        dataSlot={<FieldReportsRow operation={operation} canEdit={canEdit} only={['rekoArrived']} />}
        // «Reko-Details öffnen» in the completion gate lands on this tab,
        // and the form is always open at its top.
        onRequestComplete={canEdit && onRequestComplete ? () => onRequestComplete(operation.id) : undefined}
      />
      </div>

      {/* Die Reko: wer schaut es an, und alles, was daran
          geändert wird. Moved here off Übersicht — Reko was split
          across two tabs, with the tab NAMED Reko holding only the
          report while every dispatch control sat in a column that also
          carried the status control and three resource lists.
          It also answers what this tab used to be before a report
          exists: an empty box. Now the first thing an incident without
          a Reko offers here is the way to assign one. */}
      <div className={cn(tabColumnBreakClass, "space-y-2")}>
        {/* One heading style across all four tabs — this was the last
            `text-sm font-medium` + full-size icon pair left over. */}
        <DetailGroupHeading icon={<Binoculars className="h-3.5 w-3.5 shrink-0" />}>
          {t('detail.rekoAuftrag')}
        </DetailGroupHeading>
        {/* The Auftrag as `DetailField` rows — the same 104px gutter as
            Übersicht and as the reports in the next column. It used to
            be a badge plus four `xs` buttons in a wrapping row, which
            at 420px broke over three lines and put every control at a
            different x. The actions are row links now: grey and
            underlined, because colour on this board means status. */}
        <div>
          <DetailField
            label={t('common.reko')}
            action={canEdit && (canAssignReko || operation.assignedReko) ? (
              <span className="flex items-center gap-3">
                {canAssignReko && (
                  <button
                    type="button"
                    className={ROW_ACTION}
                    onClick={openRekoDialog}
                  >
                    <ArrowRightLeft className="size-3" />
                    {assignedRekoPersonnel ? t('common.switch') : t('common.assign')}
                  </button>
                )}
                {/* The card chip's ✕ (`removeReko`), so the detail need not be
                    closed to find the card. Releasing stays possible on a closed
                    Einsatz; assigning does not (`canAssignReko`). Greyed out until
                    the row's id is known (its assign POST still in flight). */}
                {operation.assignedReko && (
                  <button
                    type="button"
                    className={ROW_ACTION}
                    disabled={!operation.assignedReko.assignmentId}
                    onClick={() => removeReko(operation.id)}
                    title={t(operation.assignedReko.assignmentId ? 'common.removeNamed' : 'common.rekoStillSaving', { name: operation.assignedReko.name })}
                  >
                    <UserMinus className="size-3" />
                    {t('chipMenu.remove')}
                  </button>
                )}
              </span>
            ) : undefined}
          >
            {assignedRekoPersonnel ? (
              <span className="text-sm"><PersonName name={assignedRekoPersonnel.name} personnelId={assignedRekoPersonnel.id} /></span>
            ) : (
              <span className="text-sm text-muted-foreground/60 italic">{t('common.noRekoAssigned')}</span>
            )}
          </DetailField>

          {/* The two links only exist once somebody is assigned — they
              point the Reko person at this incident. */}
          {canEdit && assignedRekoPersonnel && (
            <DetailField label={t('detail.rekoLinksLabel')}>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <button
                  type="button"
                  className={ROW_ACTION}
                  onClick={handleCopyDirectRekoLink}
                  disabled={isCopyingRekoLink}
                >
                  {isCopyingRekoLink ? (
                    <ShellLoader className="size-3" />
                  ) : rekoCopied === 'direct' ? (
                    <Check className="size-3 text-success" />
                  ) : (
                    <Link2 className="size-3" />
                  )}
                  {t('common.directLink')}
                </button>
                <button
                  type="button"
                  className={ROW_ACTION}
                  onClick={handleCopyDashboardLink}
                  disabled={isCopyingRekoLink}
                >
                  {rekoCopied === 'dashboard' ? (
                    <Check className="size-3 text-success" />
                  ) : (
                    <LayoutDashboard className="size-3" />
                  )}
                  {t('common.dashboard')}
                </button>
              </div>
            </DetailField>
          )}

          {/* Its own row: this one reaches beyond the incident on
              screen (every open Reko of that person, event-wide), so it
              must not read as a third link of the row above. */}
          {canEdit && assignedRekoPersonnel && (
            <DetailField
              label={t('detail.rekoEventWideLabel')}
              description={t('detail.eventWideRekoTransferTooltip')}
            >
              <button
                type="button"
                className={ROW_ACTION}
                onClick={openRekoTransferDialog}
                title={t('detail.eventWideRekoTransferTooltip')}
              >
                <ArrowRightLeft className="size-3" />
                {t('detail.eventWideRekoTransfer')}
              </button>
            </DetailField>
          )}
        </div>
      </div>
    </div>
  )
}
