'use client'

import { useTranslations } from 'next-intl'
import { ChevronRight } from 'lucide-react'

import type { ApiRegieIncident } from '@/lib/api/types'
import type { Operation } from '@/lib/contexts/operations-context'
import { getOperationStatusLabel } from '@/lib/status-labels'
import { countdownText } from '@/lib/training-regie'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DriveProgress, useStepLabel } from '@/components/training/regie-labels'
import { useRegie } from '@/components/training/regie-provider'

/** A small neutral tag on a row: «gehalten», «Mitspieler». */
export function RegieTag({ children }: { children: string }) {
  return <span className="rounded-full border border-border px-2 py-0.5 text-xs whitespace-nowrap text-muted-foreground">{children}</span>
}

/** Line 2 of a row: status, then what the field does next (or why it waits). */
function IncidentLine({ op, regie }: { op: Operation; regie: ApiRegieIncident }) {
  const t = useTranslations('training.regie')
  const stepLabel = useStepLabel()
  const { clock } = useRegie()
  const step = regie.steps[0]
  return (
    <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
      <span>{getOperationStatusLabel(op.status)}</span>
      {step && (
        <span>
          {'· '}
          {stepLabel(step.key)}
          {step.rolling ? (
            <>
              {' '}
              <DriveProgress step={step} />
            </>
          ) : (
            step.due_at &&
            ` ${countdownText(Date.parse(step.due_at), clock, (key, values) => (key === 'in' ? t('in', values) : t('due')))}`
          )}
        </span>
      )}
      {regie.held && <RegieTag>{t('held')}</RegieTag>}
      {regie.mitspieler && <RegieTag>{t('mitspieler')}</RegieTag>}
    </span>
  )
}

/**
 * «Alle Einsätze»: one compact row per incident the Regie knows (every open one, and the
 * closed ones that still owe a Rapport) – place, status, next field step, «gehalten» /
 * «Mitspieler». A tap opens the incident's ⋯ sheet with every action for it.
 */
export function RegieIncidents() {
  const t = useTranslations('training.regie')
  const { state, operationById, placeOf, openIncident } = useRegie()
  if (!state) return null
  const rows = state.incidents.flatMap((regie) => {
    const op = operationById.get(regie.incident_id)
    return op ? [{ op, regie }] : []
  })

  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4 sm:px-6">
        <CardTitle>{t('incidents', { count: rows.length })}</CardTitle>
      </CardHeader>
      <CardContent className="px-2 sm:px-4">
        {rows.length === 0 ? (
          <div className="px-2">
            <p className="font-medium">{t('incidentsEmpty')}</p>
            <p className="text-xs text-muted-foreground">{t('incidentsEmptyHint')}</p>
          </div>
        ) : (
          <ul>
            {rows.map(({ op, regie }) => {
              const place = placeOf(op)
              return (
                <li key={op.id} className="border-b border-border/60 last:border-b-0">
                  <button
                    type="button"
                    onClick={() => openIncident(op.id)}
                    className="flex min-h-11 w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-muted"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium" title={place}>
                        {place}
                      </span>
                      <IncidentLine op={op} regie={regie} />
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
