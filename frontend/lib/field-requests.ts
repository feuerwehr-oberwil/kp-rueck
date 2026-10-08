/**
 * Workable requests from the field (R13) — the pure half.
 *
 * One request is ONE line wherever it shows: «Material: Tauchpumpe Gr. ×2 –
 * in den Keller». The card, the detail, the notification sidebar and `/feld`
 * all word it through `fieldRequestLabel`, so a request cannot read one way on
 * the board and another on the phone. The server sends its own German `label`
 * too (bell, audit, PDF); it is the fallback for a kind this client does not
 * know.
 */

import type { ApiFieldRequest, ApiFieldRequestStatus } from '@/lib/api/types'

/** The translator shape both `useTranslations('feld.requests')` and tests satisfy. */
export type RequestTranslator = (key: string, values?: Record<string, string | number>) => string

/** Open and «in Arbeit» — still owed, so still on the card and in the sidebar. */
export function isOpenRequest(request: Pick<ApiFieldRequest, 'status'>): boolean {
  return request.status === 'open' || request.status === 'in_progress'
}

/** «Material: Tauchpumpe Gr. ×2 – Notiz» in the reader's language. */
export function fieldRequestLabel(request: ApiFieldRequest, t: RequestTranslator): string {
  const note = (request.text ?? '').trim()
  const item = (request.item ?? '').trim()
  const quantity = request.quantity ?? null
  let head: string
  switch (request.kind) {
    case 'message':
      return note || request.label
    case 'material': {
      const what = [item, quantity ? (item ? t('times', { count: quantity }) : String(quantity)) : '']
        .filter(Boolean)
        .join(' ')
      head = what ? t('material', { what }) : t('materialEmpty')
      break
    }
    case 'personnel': {
      const what = [quantity ? t('people', { count: quantity }) : '', item].filter(Boolean).join(' ')
      head = what ? t('personnel', { what }) : t('personnelEmpty')
      break
    }
    case 'pickup':
      head = t('pickup')
      break
    default:
      return request.label
  }
  return note ? `${head} – ${note}` : head
}

/** The status word: offen / in Arbeit / erledigt. */
export function fieldRequestStatusLabel(status: ApiFieldRequestStatus, t: RequestTranslator): string {
  if (status === 'in_progress') return t('statusInProgress')
  if (status === 'done') return t('statusDone')
  return t('statusOpen')
}

/**
 * Where a request maps cleanly onto the board's own assignment flow: material
 * → the material list, searched for the item; Verstärkung → the crew list.
 * A sentence or an Abholung has no such mapping — null.
 */
export function assignTargetFor(
  request: Pick<ApiFieldRequest, 'kind' | 'item'>,
): { resourceType: 'materials' | 'crew'; search?: string } | null {
  if (request.kind === 'material') return { resourceType: 'materials', search: request.item?.trim() || undefined }
  if (request.kind === 'personnel') return { resourceType: 'crew' }
  return null
}

/** Oldest first — the one waiting longest is the one to work next. */
export function byOldest(a: Pick<ApiFieldRequest, 'created_at'>, b: Pick<ApiFieldRequest, 'created_at'>): number {
  return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
}

/**
 * What the crew reads about its own request on `/feld` — the KP's side of the
 * loop, derived from what the KP actually did, never from a separate «ack».
 */
export type FieldSideState = 'sent' | 'seen' | 'in_progress' | 'done'

export function fieldSideState(request: Pick<ApiFieldRequest, 'status' | 'seen_at'>): FieldSideState {
  if (request.status === 'done') return 'done'
  if (request.status === 'in_progress') return 'in_progress'
  return request.seen_at ? 'seen' : 'sent'
}

/** The notification ids an open request stands for — the sidebar shows the
 *  request instead, so the same Meldung is not listed twice. */
export function representedNotificationIds(requests: Pick<ApiFieldRequest, 'notification_id' | 'status'>[]): Set<string> {
  const ids = new Set<string>()
  for (const request of requests) {
    if (request.notification_id && isOpenRequest(request)) ids.add(request.notification_id)
  }
  return ids
}
