"use client"

import { useTranslations } from "next-intl"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import type { Operation } from "@/lib/contexts/operations/types"
import { incidentSubject } from "@/lib/incident-types"

/** An Auftrags-Editor add that cannot be taken back: a stop pulled out of another Auftrag, or an
 *  Einsatz that is already disponiert. */
export interface PlanningAddQuestion {
  incidentId: string
  incidentLabel: string
  fromName: string | null
  /** The Auftrag the question names – the one confirm adds to, even if the selection moves meanwhile. */
  groupId: string
  toName: string
}

/** A Reko-Editor tap on an Einsatz that already has a different Reko-Person. */
export interface RekoOverwriteQuestion {
  operationId: string
  currentName: string
  nextId: string
  nextName: string
}

/**
 * Auftrags-Editor: the two adds without an undo ask first — same guard and wording as the
 * board's «An Auftrag verteilen» picker. Open while `question` is set; `auftragName` is the
 * title's Auftrag.
 */
export function PlanningAddConfirm({
  question,
  auftragName,
  onClose,
  onConfirm,
}: {
  question: PlanningAddQuestion | null
  auftragName: string
  onClose: () => void
  onConfirm: (question: PlanningAddQuestion) => void
}) {
  const tKanban = useTranslations('kanban')
  return (
    <ConfirmDialog
      open={question !== null}
      onOpenChange={(open) => { if (!open) onClose() }}
      title={tKanban('dashboard.distributeConfirmTitle', { auftrag: auftragName })}
      description={
        question?.fromName
          ? tKanban('dashboard.distributeConfirmTransfer', {
              incident: question.incidentLabel,
              from: question.fromName,
              to: question.toName,
            })
          : tKanban('dashboard.distributeConfirmDispatched', {
              incident: question?.incidentLabel ?? '',
            })
      }
      confirmText={tKanban('dashboard.distributeConfirmAction')}
      // No undo after it: Enter keeps to Abbrechen.
      initialFocus="cancel"
      onConfirm={() => {
        if (question) onConfirm(question)
        onClose()
      }}
    />
  )
}

/** Reko-Editor: replacing another person's Reko needs a confirm. Open while `question` is set. */
export function RekoOverwriteConfirm({
  question,
  incident,
  onClose,
  onConfirm,
}: {
  question: RekoOverwriteQuestion | null
  /** The Einsatz the question is about – named in the window, which covers its pin. */
  incident: Operation | undefined
  onClose: () => void
  onConfirm: (question: RekoOverwriteQuestion) => void
}) {
  const t = useTranslations('map')
  return (
    <ConfirmDialog
      open={question !== null}
      onOpenChange={(open) => { if (!open) onClose() }}
      title={t('rekoMode.overwriteTitle')}
      // «diesem Einsatz» points at nothing on the map: the window covers the pin (#14).
      subject={incident ? incidentSubject(incident) : undefined}
      description={
        question
          ? t('rekoMode.overwriteDescription', {
              current: question.currentName,
              next: question.nextName,
            })
          : ''
      }
      confirmText={t('rekoMode.overwriteConfirm')}
      onConfirm={() => {
        if (!question) return
        onConfirm(question)
        onClose()
      }}
    />
  )
}
