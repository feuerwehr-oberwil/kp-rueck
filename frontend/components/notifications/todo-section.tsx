'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { ArrowLeftRight, CircleCheck, MapPin, Truck } from 'lucide-react'
import { apiClient } from '@/lib/api-client'
import { useAuth } from '@/lib/contexts/auth-context'
import { useOptionalNotifications } from '@/lib/contexts/notification-context'
import { usePlanned } from '@/lib/contexts/planned-context'
import { formatDuration } from '@/lib/duration'
import { requestCompletion, retryCompletionBoard, useCompletionReadiness } from '@/lib/hooks/use-completion-request'
import { reportStatusConflict } from '@/lib/status-conflict'
import { isOverdue, type Todo } from '@/lib/todos'
import type { TodoState } from '@/lib/hooks/use-todos'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * «Zu erledigen» – the top of the bell (owner rule 24.11.2026): every question the system or the
 * field started, each with the buttons that answer it, instead of a popup. Open rows first
 * (amber; red after 5'), then «Verworfen» (grey, the buttons still work). The field's own
 * requests keep their section (`FieldRequestInbox`), rendered by the caller right below.
 *
 * Buttons are for editors; a viewer reads the rows. `readOnly` (the phone's Meldungen sheet: the
 * phone is read-only, owner 14.11.2026) shows the rows without buttons – they are answered on the desk.
 */
export function TodoSection({ state, readOnly = false }: { state: Pick<TodoState, 'open' | 'dismissed' | 'now'>; readOnly?: boolean }) {
  const t = useTranslations('notifications.todo')
  if (state.open.length === 0 && state.dismissed.length === 0) return null
  return (
    <section aria-labelledby="todo-heading" className="space-y-2">
      {state.open.length > 0 && (
        <h3 id="todo-heading" className="flex items-center gap-2 text-sm font-semibold text-warning-foreground">
          {t('heading')}
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-warning px-1.5 text-xs font-bold text-foreground">
            {state.open.length}
          </span>
        </h3>
      )}
      {state.open.map((todo) => (
        <TodoRow key={todo.id} todo={todo} now={state.now} readOnly={readOnly} />
      ))}
      {state.dismissed.length > 0 && (
        <>
          <h3 className="pt-2 text-xs font-semibold text-muted-foreground">{t('dismissedHeading')}</h3>
          {state.dismissed.map((todo) => (
            <TodoRow key={todo.id} todo={todo} now={state.now} readOnly={readOnly} />
          ))}
        </>
      )}
    </section>
  )
}

function TodoRow({ todo, now, readOnly }: { todo: Todo; now: number; readOnly: boolean }) {
  const t = useTranslations('notifications.todo')
  const tMessages = useTranslations('notifications.messages')
  const tArrival = useTranslations('incidents.gpsArrival')
  const tRelease = useTranslations('incidents.gpsRelease')
  const { isEditor } = useAuth()
  const notifications = useOptionalNotifications()
  const { promote, setDismissed } = usePlanned()
  const [busy, setBusy] = useState(false)
  const overdue = isOverdue(todo, now)
  // An Einsatz vehicle back home: can the board on screen run its close flow? The bell lists
  // this Ereignis only, so it is never another Ereignis's Einsatz.
  const closes = todo.kind === 'gps_release' && !todo.groupId && todo.incidentId ? todo.incidentId : ''
  const readiness = useCompletionReadiness(closes, undefined)

  /** Run an answer once; a GPS row is closed (dismissed) after it went through. */
  const run = (action: () => Promise<boolean>) => async () => {
    setBusy(true)
    try {
      const done = await action()
      if (done && todo.kind !== 'danach' && !todo.dismissed) await notifications?.dismissNotification(todo.notification.id)
    } finally {
      setBusy(false)
    }
  }

  const dismiss = run(async () => {
    if (todo.kind === 'danach') {
      for (const plan of todo.plans) await setDismissed(plan.id, true)
      return false
    }
    await notifications?.dismissNotification(todo.notification.id)
    return false
  })

  let icon = <ArrowLeftRight className="size-3.5" aria-hidden="true" />
  let title = ''
  let text = ''
  /** `act` resolves true when the question is answered – the row is then closed. */
  let answers: { label: string; act: () => Promise<boolean>; disabled?: boolean }[] = []
  let status: string | null = null

  if (todo.kind === 'danach') {
    title = t('danachTitle')
    text = t('danachText', { names: todo.names.join(', '), holder: todo.holderLabel })
    answers = [
      {
        label: t('assign'),
        act: async () => {
          // One after the other: each promote locks the same Einsatz.
          for (const plan of todo.plans) if (!(await promote(plan.id))) return false
          return true
        },
      },
    ]
  } else {
    const p = (todo.notification.params ?? {}) as Record<string, string>
    const place = p.place ?? ''
    const vehicle = p.vehicle ?? ''
    const incidentId = todo.incidentId
    if (todo.kind === 'gps_arrival') {
      icon = <MapPin className="size-3.5" aria-hidden="true" />
      title = t('gpsArrivalTitle')
      text = `${tMessages('gpsArrivalTodo', { vehicle })} · ${place}`
      answers = [
        {
          label: t('toActive'),
          act: async () => {
            if (!incidentId) return false
            try {
              // GPS asks only while the card is «Disponiert», so that is the from-status.
              await apiClient.updateIncidentStatus(incidentId, 'enroute', 'active')
              toast.success(tArrival('movedToActive', { label: place }))
              return true
            } catch (error) {
              // Moved meanwhile: «Gerade geändert» asks instead, and this question is answered.
              if (reportStatusConflict(error, { operationId: incidentId, seen: 'enroute', wanted: 'active' })) return true
              toast.error(tArrival('statusChangeFailed'))
              return false
            }
          },
        },
      ]
    } else {
      icon = <Truck className="size-3.5" aria-hidden="true" />
      title = t('gpsReleaseTitle')
      text = `${tMessages('gpsReleaseTodo', { vehicle })} · ${place}`
      const { assignmentId, groupId } = todo
      const release = {
        label: tRelease('releaseOnly', { vehicle }),
        act: async () => {
          try {
            if (groupId) await apiClient.unassignGroupResource(groupId, assignmentId)
            else if (incidentId) await apiClient.unassignResource(incidentId, assignmentId)
            toast.success(tRelease('released', { vehicle }))
            return true
          } catch {
            toast.error(tRelease('releaseFailed'))
            return false
          }
        },
      }
      // Owner feedback 23.11.2026 #13: a vehicle back home means the crew and the material are
      // back too – «Einsatz abschliessen» leads, through the board's close flow (it asks which
      // material stays). The row leaves once the card is «Abgeschlossen», so it is not closed
      // here: a close flow the operator cancels keeps the question. A route vehicle is only
      // released – its Auftrag goes on.
      const complete =
        readiness === 'failed'
          ? {
              label: tRelease('retryLoad'),
              act: async () => {
                await retryCompletionBoard()
                return false
              },
            }
          : {
              label: tRelease('completeIncident'),
              disabled: readiness !== 'ready',
              act: async () => {
                if (!incidentId || !requestCompletion(incidentId)) toast.error(tRelease('completeFailed'))
                return false
              },
            }
      if (!groupId && readiness === 'missing') status = tRelease('notOnBoard')
      if (!groupId && readiness === 'failed') status = tRelease('loadFailed')
      answers = groupId ? [release] : [complete, release]
    }
  }

  return (
    <div
      className={cn(
        'grid gap-1.5 rounded-lg border border-l-4 bg-card px-3 py-2 text-sm',
        todo.dismissed
          ? 'border-border border-l-muted-foreground/40 opacity-70'
          : overdue
            ? 'border-destructive/50 border-l-destructive'
            : 'border-warning/60 border-l-warning',
      )}
      data-todo-kind={todo.kind}
    >
      <div
        className={cn(
          'flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide',
          todo.dismissed ? 'text-muted-foreground' : overdue ? 'text-destructive' : 'text-warning-foreground',
        )}
      >
        {icon}
        {title}
        <span className="ml-auto font-normal normal-case tracking-normal text-muted-foreground">
          {overdue ? t('overdue', { duration: formatDuration(now - todo.since) }) : formatDuration(now - todo.since)}
        </span>
      </div>
      <p className="leading-snug">{text}</p>
      {status && <p role="status" className="text-xs text-warning-foreground">{status}</p>}
      {isEditor && !readOnly && (
        <div className="flex flex-wrap gap-1.5">
          {answers.map((answer, index) => (
            <Button
              key={answer.label}
              size="xs"
              variant={index === 0 ? 'default' : 'outline'}
              disabled={busy || answer.disabled}
              onClick={run(answer.act)}
            >
              {index === 0 && <CircleCheck className="size-3.5" aria-hidden="true" />}
              {answer.label}
            </Button>
          ))}
          {!todo.dismissed && (
            <Button size="xs" variant="ghost" disabled={busy} onClick={dismiss}>
              {t('dismiss')}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
