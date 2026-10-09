'use client'

/**
 * Requests from the field as WORKABLE items (R13) — the card rows, the
 * detail's list and the one row both the detail and the notification sidebar
 * render.
 *
 * A Meldung used to be a bell entry and a line in the thread; «erledigt» did
 * not exist, and dismissing the bell was the only handling it could get. Each
 * request now has a state (offen → in Arbeit → erledigt) that every surface
 * reads off the same row, so working it in one place is working it everywhere.
 * The crew reads it back on `/feld` («Vom KP gesehen», «erledigt · 14:32»).
 *
 * Dismissing a notification is NOT handling a request: the card and the
 * sidebar keep it until somebody presses «Erledigt».
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Check, CarTaxiFront, ClipboardList, Eye, MessageSquare, Package, RotateCcw, Users, Wrench } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { DetailGroupHeading } from '@/components/kanban/detail-field'
import { LoadingStatus, ShellLoader } from '@/components/ui/shell-loader'
import { apiClient, type ApiFieldRequest, type ApiFieldRequestKind } from '@/lib/api-client'
import type { Operation } from '@/lib/contexts/operations-context'
import { assignTargetFor, fieldRequestLabel, fieldRequestStatusLabel, isOpenRequest } from '@/lib/field-requests'
import { useFieldRequestActions } from '@/lib/hooks/use-field-requests'
import { getActiveLocale } from '@/lib/i18n-messages'
import { cn } from '@/lib/utils'

/** How the assignment flow is opened — the board's own dialog, searched. */
export type FieldRequestAssign = (incidentId: string, resourceType: 'crew' | 'materials', search?: string) => void

const KIND_ICON: Record<ApiFieldRequestKind, typeof Package> = {
  material: Package,
  personnel: Users,
  pickup: CarTaxiFront,
  message: MessageSquare,
}

function formatTime(value: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleTimeString(getActiveLocale(), { hour: '2-digit', minute: '2-digit' })
}

/** offen = amber (it wants somebody), in Arbeit = slate, erledigt = quiet + ✓. */
export function FieldRequestStatusChip({ request, className }: { request: ApiFieldRequest; className?: string }) {
  const t = useTranslations('feld.requests')
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-sm border px-1.5 py-px text-[11px] font-medium leading-4',
        request.status === 'open' && 'border-warning/60 bg-warning/15 text-warning-foreground',
        request.status === 'in_progress' && 'border-sel-edge bg-sel-wash text-sel-foreground',
        request.status === 'done' && 'border-border bg-muted/60 text-muted-foreground',
        className,
      )}
    >
      {request.status === 'done' && <Check className="h-3 w-3" aria-hidden />}
      {fieldRequestStatusLabel(request.status, t)}
    </span>
  )
}

/**
 * One request with its actions. `variant="sidebar"` adds the place (the sidebar
 * lists the whole board); the detail already is the place.
 */
export function FieldRequestItem({
  request,
  canEdit,
  onAssign,
  place,
  busy,
  onSetStatus,
  onMarkSeen,
  onOpen,
}: {
  request: ApiFieldRequest
  canEdit: boolean
  onAssign?: FieldRequestAssign
  /** The incident's short address — the sidebar's second line. */
  place?: string
  busy: boolean
  onSetStatus: (request: ApiFieldRequest, status: ApiFieldRequest['status']) => void
  /** «Gesehen» — closes the bell entry the sidebar shows this request in place
   *  of; the request stays open. Any logged-in user may, like ✕ on the bell. */
  onMarkSeen?: (request: ApiFieldRequest) => void
  /** Clicking the text opens the incident (sidebar only). */
  onOpen?: () => void
}) {
  const t = useTranslations('feld.requests')
  const Icon = KIND_ICON[request.kind] ?? ClipboardList
  const label = fieldRequestLabel(request, t)
  const target = assignTargetFor(request)
  const open = isOpenRequest(request)
  // Only while there is a bell entry to close and nobody has acknowledged it.
  const canMarkSeen = Boolean(onMarkSeen) && open && !request.seen_at && Boolean(request.notification_id)
  const provenance = request.from_field
    ? t('fromField', { name: request.created_by_name ?? '–', time: formatTime(request.created_at) })
    : t('fromKp', { time: formatTime(request.created_at) })
  const worked =
    request.status === 'done'
      ? request.done_by_name
        ? t('doneBy', { time: formatTime(request.done_at), name: request.done_by_name })
        : t('doneAt', { time: formatTime(request.done_at) })
      : request.status === 'in_progress' && request.in_progress_by_name
        ? t('inProgressBy', { name: request.in_progress_by_name })
        : request.seen_at
          ? t('seen')
          : null

  const text = (
    <>
      <p className="flex items-start gap-1.5 text-sm font-medium leading-snug text-foreground">
        <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 break-words">{label}</span>
      </p>
      <p className="mt-0.5 pl-5 text-xs leading-snug text-muted-foreground break-words">
        {[place, provenance, worked].filter(Boolean).join(' · ')}
      </p>
    </>
  )

  return (
    <li
      className={cn('rounded-lg border border-border/70 bg-card p-2.5', request.status === 'done' && 'opacity-70')}
      data-request-status={request.status}
    >
      <div className="flex items-start justify-between gap-2">
        {onOpen ? (
          <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left hover:underline-offset-2">
            {text}
          </button>
        ) : (
          <div className="min-w-0 flex-1">{text}</div>
        )}
        <FieldRequestStatusChip request={request} />
      </div>

      {(canEdit || canMarkSeen) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-5">
          {canMarkSeen && (
            <Button
              type="button"
              size="xs"
              variant="ghost"
              disabled={busy}
              title={t('markSeenTitle')}
              onClick={() => onMarkSeen?.(request)}
            >
              <Eye className="size-3.5" aria-hidden />
              {t('markSeen')}
            </Button>
          )}
          {canEdit && open && target && onAssign && (
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={busy}
              onClick={() => {
                // Opening the dialog IS starting the work — the crew reads
                // «KP: in Arbeit» without a second click.
                if (request.status === 'open') onSetStatus(request, 'in_progress')
                onAssign(request.incident_id, target.resourceType, target.search)
              }}
            >
              {target.resourceType === 'materials' ? (
                <Package className="size-3.5" aria-hidden />
              ) : (
                <Users className="size-3.5" aria-hidden />
              )}
              {target.resourceType === 'materials' ? t('assignMaterial') : t('assignCrew')}
            </Button>
          )}
          {canEdit && request.status === 'open' && request.kind !== 'pickup' && (
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={busy}
              title={t('startTitle')}
              onClick={() => onSetStatus(request, 'in_progress')}
            >
              <Wrench className="size-3.5" aria-hidden />
              {t('start')}
            </Button>
          )}
          {canEdit && open && (
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={busy}
              title={t('doneTitle')}
              onClick={() => onSetStatus(request, 'done')}
            >
              {busy ? <ShellLoader className="size-3.5" /> : <Check className="size-3.5" aria-hidden />}
              {request.kind === 'pickup' ? t('pickupDone') : t('done')}
            </Button>
          )}
          {canEdit && request.status === 'done' && request.kind !== 'pickup' && (
            <Button
              type="button"
              size="xs"
              variant="ghost"
              disabled={busy}
              onClick={() => onSetStatus(request, 'open')}
            >
              <RotateCcw className="size-3.5" aria-hidden />
              {t('reopen')}
            </Button>
          )}
        </div>
      )}
    </li>
  )
}

/**
 * The card's compact rows: «Material: Tauchpumpe Gr. ×2 — offen». At most two,
 * then «+N weitere» — the card is a summary, the detail is the list.
 */
export function FieldRequestCardRows({
  requests,
  onOpen,
}: {
  requests: ApiFieldRequest[]
  onOpen: (event: React.MouseEvent) => void
}) {
  const t = useTranslations('feld.requests')
  // The Abholung already has its amber chip in the card head (with the
  // waiting time and its own «disponiert» action) — not a second line here.
  const open = requests.filter(request => isOpenRequest(request) && request.kind !== 'pickup')
  if (open.length === 0) return null
  const shown = open.slice(0, 2)
  return (
    <button
      type="button"
      onClick={onOpen}
      onPointerDown={event => event.stopPropagation()}
      className="block w-full space-y-0.5 rounded-md border border-warning/40 bg-warning/5 px-2 py-1 text-left text-xs transition-colors hover:bg-warning/10"
      aria-label={t('cardTitle', { count: open.length })}
      title={open.map(request => fieldRequestLabel(request, t)).join('\n')}
    >
      {shown.map(request => {
        const Icon = KIND_ICON[request.kind] ?? ClipboardList
        return (
          <span key={request.id} className="flex min-w-0 items-center gap-1.5">
            <Icon className="h-3 w-3 shrink-0 text-warning-foreground" aria-hidden />
            <span className="min-w-0 truncate text-foreground">{fieldRequestLabel(request, t)}</span>
            <span className="shrink-0 text-muted-foreground">— {fieldRequestStatusLabel(request.status, t)}</span>
          </span>
        )
      })}
      {open.length > shown.length && (
        <span className="block pl-[18px] text-muted-foreground">{t('more', { count: open.length - shown.length })}</span>
      )}
    </button>
  )
}

/**
 * The detail's list: every request of this Schadenplatz in any state, oldest
 * first, with who handled what and when. Loads the full list (the card carries
 * only the open ones) and reloads whenever the open set on the board changes.
 */
export function FieldRequestList({
  operation,
  canEdit,
  onAssign,
}: {
  operation: Operation
  canEdit: boolean
  onAssign?: FieldRequestAssign
}) {
  const t = useTranslations('feld.requests')
  const tCommon = useTranslations('common')
  const [rows, setRows] = useState<ApiFieldRequest[] | null>(null)
  const [failed, setFailed] = useState(false)

  // A signature of the open set: a new request, a state change from another
  // board or the sidebar all change it, and the list follows.
  const openKey = useMemo(
    () => (operation.fieldRequests ?? []).map(request => `${request.id}:${request.status}:${request.seen_at ?? ''}`).join('|'),
    [operation.fieldRequests],
  )

  const load = useCallback(async () => {
    try {
      const next = await apiClient.getFieldRequests(operation.id)
      setRows(next)
      setFailed(false)
    } catch (error) {
      console.error('Failed to load field requests:', error)
      setFailed(true)
    }
  }, [operation.id])

  useEffect(() => {
    void load()
  }, [load, openKey])

  const { setStatus, markSeen, canMarkSeen, busyId } = useFieldRequestActions(load)
  const list = rows ?? operation.fieldRequests ?? []

  return (
    <div className="space-y-2">
      <DetailGroupHeading
        icon={<ClipboardList className="h-3.5 w-3.5 shrink-0" />}
        action={
          list.some(isOpenRequest) ? (
            <span className="text-xs tabular-nums text-muted-foreground">{list.filter(isOpenRequest).length}</span>
          ) : null
        }
      >
        {t('detailTitle')}
      </DetailGroupHeading>

      {rows === null && !failed && list.length === 0 && (
        <LoadingStatus className="text-xs">{tCommon('loading')}</LoadingStatus>
      )}
      {failed && (
        <p className="text-xs text-destructive">
          {t('loadFailed')}{' '}
          <button type="button" onClick={() => void load()} className="underline">
            {t('retry')}
          </button>
        </p>
      )}
      {rows !== null && list.length === 0 && (
        <p className="text-xs italic text-muted-foreground/60">{t('detailEmpty')}</p>
      )}

      {list.length > 0 && (
        <ul className="space-y-1.5">
          {list.map(request => (
            <FieldRequestItem
              key={request.id}
              request={request}
              canEdit={canEdit}
              onAssign={onAssign}
              busy={busyId === request.id}
              onSetStatus={(r, status) => void setStatus(r, status)}
              onMarkSeen={canMarkSeen ? r => void markSeen(r) : undefined}
            />
          ))}
        </ul>
      )}
    </div>
  )
}
