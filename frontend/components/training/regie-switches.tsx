'use client'

import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'

import type { ApiRegieTempo } from '@/lib/api/types'
import { automatikStatus } from '@/lib/training-regie'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { FormMessage } from '@/components/ui/form-message'
import { Switch } from '@/components/ui/switch'
import { useRegie } from '@/components/training/regie-provider'

const TEMPI: ApiRegieTempo[] = ['ruhig', 'normal', 'sturm']

/** One switch with its name and line: the whole row is the target (44px on the phone). */
function SwitchRow({
  id,
  label,
  hint,
  checked,
  disabled,
  onChange,
  children,
}: {
  id: string
  label: string
  hint: string
  checked: boolean
  disabled: boolean
  onChange: (on: boolean) => void
  children?: ReactNode
}) {
  return (
    <div>
      <label htmlFor={id} className="flex min-h-11 cursor-pointer items-center gap-3">
        <span className="min-w-0 flex-1">
          <span className="block font-medium">{label}</span>
          <span className="block text-xs leading-snug text-muted-foreground">{hint}</span>
        </span>
        <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
      </label>
      {children}
    </div>
  )
}

/**
 * The top card of the Regie: the Feld-Autopilot (field steps by themselves), the Automatik
 * (new alarms by themselves) and the Übungstempo that scales both – and the GPS drives.
 */
export function RegieSwitches() {
  const t = useTranslations('training')
  const { state, eventId, actions, isBusy, automatikSettings } = useRegie()
  if (!state) return null
  const automatik = automatikStatus(state.automatik, eventId)
  const tempoLabel: Record<ApiRegieTempo, string> = {
    ruhig: t('regie.tempoRuhig'),
    normal: t('regie.tempoNormal'),
    sturm: t('regie.tempoSturm'),
  }

  return (
    <Card>
      <CardContent className="space-y-3">
        <SwitchRow
          id="regie-autopilot"
          label={t('regie.autopilot')}
          hint={t('regie.autopilotHint')}
          checked={state.autopilot}
          disabled={isBusy('regie')}
          onChange={(on) => void actions.setRegie({ autopilot: on })}
        />
        <SwitchRow
          id="regie-automatik"
          label={t('autogen.title')}
          hint={t('autogen.description')}
          checked={automatik === 'on'}
          disabled={isBusy('automatik')}
          onChange={(on) => void actions.setAutomatik(on)}
        >
          {automatik === 'elsewhere' && <FormMessage tone="advice">{t('autogen.elsewhere')}</FormMessage>}
          {automatik === 'stoppedAtMax' && (
            <FormMessage tone="advice">{t('autogen.stoppedAtMaxHint', { max: automatikSettings.settings.max })}</FormMessage>
          )}
        </SwitchRow>
        <div role="group" aria-label={t('regie.tempo')} className="grid grid-cols-3 gap-2">
          {TEMPI.map((tempo) => (
            <Button
              key={tempo}
              variant={state.tempo === tempo ? 'selected' : 'outline'}
              aria-pressed={state.tempo === tempo}
              disabled={isBusy('regie')}
              onClick={() => state.tempo !== tempo && void actions.setRegie({ tempo })}
              className="min-w-0"
            >
              <span className="truncate">{tempoLabel[tempo]}</span>
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
