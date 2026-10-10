'use client'

/**
 * «Mögliches Duplikat von Hauptstrasse 6» — on a card an AUTOMATIC door made.
 *
 * The webhook, the poller, the public /alarm form and a bulk attach never merge
 * on their own: nobody has looked at that alarm yet, and an alarm that silently
 * disappears into another card is worse than one card too many. So they create
 * the card and the server flags it (`possible_duplicate_of_id`); this row is the
 * flag, and its two buttons are the whole decision:
 *
 * - «Zusammenführen» — one click, no dialog: the card goes into the other one
 *   as a Nachtrag, and the toast offers «Rückgängig» (the card's Verlauf keeps
 *   «Trennen» after that). Refused by the server while crew is assigned here.
 * - «Kein Duplikat» — the flag goes, the card stays.
 *
 * Amber, like the Abholung chip: something to answer, not a danger. The
 * buttons stop the pointer so a click is not the start of a card drag.
 */

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Combine, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { ShellLoader } from '@/components/ui/shell-loader'
import { apiClient } from '@/lib/api-client'
import { useOperations } from '@/lib/contexts/operations-context'
import { getIncidentLocationLabel } from '@/lib/incident-types'
import { cn } from '@/lib/utils'

const stop = (event: { stopPropagation: () => void }) => event.stopPropagation()

interface DuplicateFlagProps {
  operationId: string
  targetId: string
  /** False for a viewer: the flag stays readable, the buttons go. */
  canEdit?: boolean
  className?: string
}

export function DuplicateFlag({ operationId, targetId, canEdit = true, className }: DuplicateFlagProps) {
  const t = useTranslations('duplicates')
  const { operations, mergeExistingOperation, refreshOperations } = useOperations()
  const [busy, setBusy] = useState<'merge' | 'dismiss' | null>(null)

  const [confirming, setConfirming] = useState(false)

  const target = operations.find((op) => op.id === targetId)
  const self = operations.find((op) => op.id === operationId)
  const label = target ? getIncidentLocationLabel(target) : null
  const text = label ? t('card.flag', { label }) : t('card.flagUnknown')

  // What moves with this card (owner decision 10.10.2026: any OPEN card can be
  // merged and takes its work along). A fresh report merges in one click; a card
  // somebody has worked on asks first and names what will move.
  const work = self
    ? [
        self.crew.length > 0 && t('card.workCrew'),
        (self.vehicles.length > 0 || self.vehicle) && t('card.workVehicles'),
        self.materials.length > 0 && t('card.workMaterial'),
        self.hasCompletedReko && t('card.workReko'),
        (self.hasSchadenplatzRapport || self.hasSchadenplatzRapportDraft) && t('card.workRapport'),
        (self.fieldRequests?.length ?? 0) > 0 && t('card.workRequests'),
      ].filter((item): item is string => Boolean(item))
    : []
  const mergeable = Boolean(target) && target?.status !== 'complete' && self?.status !== 'complete'

  const merge = async () => {
    setBusy('merge')
    try {
      await mergeExistingOperation(operationId, targetId)
    } finally {
      setBusy(null)
    }
  }

  const dismiss = async () => {
    setBusy('dismiss')
    try {
      await apiClient.dismissDuplicate(operationId)
      await refreshOperations()
    } catch (error) {
      console.error('Failed to dismiss duplicate flag:', error)
      toast.error(t('dismissFailed'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div
      data-testid="duplicate-flag"
      className={cn(
        'space-y-1.5 rounded-md border border-warning/60 bg-warning/10 px-2 py-1.5 text-xs',
        className,
      )}
      // Only when it has buttons: a read-only flag is part of the card and a
      // tap on it opens the card like a tap anywhere else.
      onClick={canEdit ? stop : undefined}
      onPointerDown={canEdit ? stop : undefined}
      onMouseDown={canEdit ? stop : undefined}
    >
      <p className="flex items-start gap-1.5 leading-snug" title={t('card.flagTooltip')}>
        <TriangleAlert aria-hidden className="mt-px size-3.5 shrink-0 text-warning-foreground" />
        <span className="min-w-0 break-words text-foreground">{text}</span>
      </p>
      {canEdit && (
        <div className="flex flex-wrap gap-1.5">
          {/* Only between OPEN cards — a closed card is history on either side (the
              server refuses it too); a flag pointing at a card that was closed or
              deleted since is answered with «Kein Duplikat». */}
          {mergeable && (
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={busy !== null}
              onClick={() => (work.length > 0 ? setConfirming(true) : void merge())}
            >
              {busy === 'merge' ? <ShellLoader className="size-3.5" /> : <Combine className="size-3.5" />}
              {t('card.merge')}
            </Button>
          )}
          <Button type="button" size="xs" variant="ghost" disabled={busy !== null} onClick={dismiss}>
            {busy === 'dismiss' && <ShellLoader className="size-3.5" />}
            {t('card.dismiss')}
          </Button>
        </div>
      )}
      {/* Portalled, but a React child: stop its clicks before they reach the card. */}
      <span className="contents" onClick={stop} onPointerDown={stop} onMouseDown={stop}>
        <ConfirmDialog
          open={confirming}
          onOpenChange={setConfirming}
          title={t('card.confirmTitle', { label: label ?? '' })}
          description={t('card.confirmBody', { items: work.join(', ') })}
          confirmText={t('card.merge')}
          onConfirm={merge}
        />
      </span>
    </div>
  )
}
