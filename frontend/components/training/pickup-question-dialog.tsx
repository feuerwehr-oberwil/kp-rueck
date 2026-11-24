'use client'

import { useTranslations } from 'next-intl'
import { AlertTriangle } from 'lucide-react'

import type { Operation } from '@/lib/contexts/operations-context'
import { Button } from '@/components/ui/button'
import { AlternativeAnswer } from '@/components/ui/confirm-dialog'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

/**
 * «Kommt der Trupp selbst zurück?» – the one follow-up «Einsatz beendet» asks in the field
 * (decision 24), when the trainer presses «Jetzt» on it. Open while `op` is set; `onAnswer`
 * gets the pickup answer: true = Abholung nötig, false = fährt selbst, null = Lage
 * entscheidet (the backend follows the «bleibt vor Ort» pill: a vehicle on site → «fährt
 * selbst», none → Abholung – the way the Autopilot always answers).
 *
 * «Lage entscheidet» is the aside, not the primary: as the loud default every exercise would
 * follow the pill, while the KP forgetting it is part of what an exercise trains. «Fährt
 * selbst» is the primary – true in most cases, and the only answer that costs the operator
 * nothing.
 */
export function PickupQuestionDialog({
  op,
  place,
  onClose,
  onAnswer,
}: {
  op: Operation | null
  place: string
  onClose: () => void
  onAnswer: (op: Operation, pickupNeeded: boolean | null) => void
}) {
  const t = useTranslations('training.simulation')
  return (
    <Dialog open={op !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('pickupQuestion')}</DialogTitle>
          <DialogDescription>{t('pickupQuestionDescription', { location: place })}</DialogDescription>
        </DialogHeader>
        <AlternativeAnswer onClick={() => op && onAnswer(op, null)}>{t('pickupAuto')}</AlternativeAnswer>
        <DialogFooter>
          <Button variant="outline" onClick={() => op && onAnswer(op, true)}>
            <AlertTriangle className="size-3.5 text-warning-foreground" />
            {t('pickupRequired')}
          </Button>
          <Button onClick={() => op && onAnswer(op, false)}>{t('pickupSelfReturn')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
