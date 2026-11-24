'use client'

import { Clock, Lock } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { ApiFeldPlanned } from '@/lib/api-client'
import { cn } from '@/lib/utils'

/**
 * «Danach» on /feld (owner pick 5C, 24.11.2026): where this person goes after the current work,
 * after the live rows and unmistakably not active – dashed, «DANACH · NICHT AKTIV», no button, no
 * report. It becomes a normal row (Jetzt) once the KP assigns it; the list then simply moves up.
 */
export function FeldDanachList({ planned }: { planned: readonly ApiFeldPlanned[] }) {
  const t = useTranslations('feld.assignments.danach')
  if (planned.length === 0) return null
  return (
    <section aria-label={t('heading')} className="space-y-2 pt-2">
      {planned.map((plan) => (
        <div
          key={plan.id}
          className={cn(
            'grid gap-1.5 rounded-xl border-2 border-dashed p-4',
            plan.ready ? 'border-warning' : 'border-muted-foreground/40',
          )}
          data-slot="feld-danach"
        >
          <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            <Clock className="size-3.5" aria-hidden="true" />
            {t('tag')}
            {plan.position > 1 && <span className="font-medium normal-case tracking-normal">· {t('queuePos', { position: plan.position })}</span>}
          </span>
          <h3 className="text-base font-medium leading-tight text-muted-foreground">{plan.place}</h3>
          {plan.description && <p className="text-sm text-muted-foreground line-clamp-2">{plan.description}</p>}
          <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
            <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            {plan.ready ? t('ready') : t('hint')}
          </p>
        </div>
      ))}
    </section>
  )
}
