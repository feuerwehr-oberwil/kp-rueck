'use client'

/**
 * The phone board's ONE action, in its footer (docs/FRONTEND.md «Phone layout»): «Neuer Einsatz».
 *
 * In an Übung, an editor gets a split button (owner pick 5B, phone sweep 24.11.2026):
 * «Neuer Einsatz | ▴». The ▴ opens a small menu that triggers Normal, Kritisch or Telefon at once –
 * the same request and toast as the Übungs-Steuerung (`lib/training-alarm.ts`) – and links to the
 * Übungs-Steuerung. «Neuer Einsatz» stays one tap; the head keeps the list.
 */

import { useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { ChevronRight, ChevronUp, Droplet, Flame, Phone, Plus, Sparkles, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { topLoading } from '@/components/ui/top-loading-bar'
import { useEvent } from '@/lib/contexts/event-context'
import { useOperations } from '@/lib/contexts/operations-context'
import { generateTrainingAlarm, trainingAlarmLine, TRAINING_ALARM_TOAST, type TrainingAlarm } from '@/lib/training-alarm'

const ALARMS = [
  { kind: 'normal', icon: Droplet, label: 'normal' },
  { kind: 'critical', icon: Flame, label: 'critical' },
  { kind: 'phone', icon: Phone, label: 'phoneAlarm' },
] as const satisfies readonly { kind: TrainingAlarm; icon: LucideIcon; label: string }[]

interface PhoneIntakeFooterProps {
  onNewIncident: () => void
  /** The ▴ with the Übung menu: an editor on a training Ereignis. */
  training: boolean
}

export function PhoneIntakeFooter({ onNewIncident, training }: PhoneIntakeFooterProps) {
  const t = useTranslations('incidents.mobileList')
  const tTraining = useTranslations('training')
  const { selectedEvent } = useEvent()
  const { refreshOperations } = useOperations()
  const [firing, setFiring] = useState(false)

  const fire = async (kind: TrainingAlarm) => {
    if (!selectedEvent) return
    setFiring(true)
    try {
      const incident = await generateTrainingAlarm(selectedEvent.id, kind)
      toast.success(tTraining(`controls.${TRAINING_ALARM_TOAST[kind]}`), { description: trainingAlarmLine(incident) })
      void refreshOperations()
    } catch (error: unknown) {
      toast.error(tTraining('common.error'), { description: error instanceof Error ? error.message : undefined })
    } finally {
      setFiring(false)
    }
  }

  const newIncident = (
    <Button onClick={onNewIncident} className={training ? 'min-h-[48px] flex-1 gap-2 rounded-r-none' : 'min-h-[48px] w-full gap-2'}>
      <Plus className="h-4 w-4" />
      {t('newIncident')}
    </Button>
  )

  if (!training) return newIncident

  return (
    <div className="flex gap-0.5">
      {newIncident}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button className="min-h-[48px] w-14 shrink-0 rounded-l-none" aria-label={t('trainingMenu')} disabled={firing}>
            <ChevronUp className="h-5 w-5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="end" sideOffset={8} className="w-[calc(100vw-2rem)] max-w-sm p-2">
          <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">{t('trainingMenu')}</DropdownMenuLabel>
          <div className="grid grid-cols-3 gap-2 px-1 pb-1">
            {ALARMS.map(({ kind, icon: Icon, label }) => (
              <DropdownMenuItem
                key={kind}
                onSelect={() => void fire(kind)}
                className="min-h-12 justify-center gap-2 rounded-lg border text-sm font-semibold"
              >
                <Icon aria-hidden />
                {tTraining(`controls.${label}`)}
              </DropdownMenuItem>
            ))}
          </div>
          <DropdownMenuSeparator className="my-1" />
          <DropdownMenuItem asChild className="min-h-11 gap-3 px-2 text-sm">
            <Link href="/training" onNavigate={() => topLoading.startRoute()}>
              <Sparkles aria-hidden />
              <span className="flex-1">{t('trainingControl')}</span>
              <ChevronRight aria-hidden />
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
