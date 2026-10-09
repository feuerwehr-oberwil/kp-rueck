'use client'

/**
 * The board's side of the field requests (R13): what is still owed across the
 * Ereignis, and the one writer that works a request.
 *
 * Both read the operations context, which already carries every incident's
 * open requests (`IncidentResponse.field_requests`) and refetches on the
 * incident broadcast every write here sends — so handling a request on the
 * card, in the detail or in the sidebar updates the other two without any
 * state of its own.
 */

import { useCallback, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { ApiError, apiClient, type ApiFieldRequest, type ApiFieldRequestStatus } from '@/lib/api-client'
import { useOperations, type Operation } from '@/lib/contexts/operations-context'
import { useOptionalNotifications } from '@/lib/contexts/notification-context'
import { byOldest, representedNotificationIds } from '@/lib/field-requests'

export interface OpenFieldRequest {
  request: ApiFieldRequest
  operation: Operation
}

/** Every open + «in Arbeit» request of the board, oldest first. */
export function useOpenFieldRequests(): {
  items: OpenFieldRequest[]
  /** Bell entries the sidebar replaces with their request (no double listing). */
  representedIds: Set<string>
} {
  const { operations } = useOperations()
  return useMemo(() => {
    const items: OpenFieldRequest[] = []
    for (const operation of operations) {
      for (const request of operation.fieldRequests ?? []) items.push({ request, operation })
    }
    items.sort((a, b) => byOldest(a.request, b.request))
    return { items, representedIds: representedNotificationIds(items.map(item => item.request)) }
  }, [operations])
}

/** offen → in Arbeit → erledigt (and back), with the board and the bell refreshed. */
export function useFieldRequestActions(onChanged?: () => void) {
  const t = useTranslations('feld.requests')
  const { refreshOperations } = useOperations()
  const notifications = useOptionalNotifications()
  const [busyId, setBusyId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    await Promise.all([refreshOperations(), notifications?.refetchNotifications()])
    onChanged?.()
  }, [notifications, onChanged, refreshOperations])

  const setStatus = useCallback(
    async (request: ApiFieldRequest, status: ApiFieldRequestStatus) => {
      setBusyId(request.id)
      try {
        // The state this screen showed: another board that was faster wins,
        // and this one is told so instead of overwriting it.
        await apiClient.setFieldRequestStatus(request.incident_id, request.id, status, request.status)
        await refresh()
      } catch (error) {
        console.error('Failed to update field request:', error)
        if (error instanceof ApiError && error.status === 409) {
          toast.error(t('movedOn'))
          await refresh()
        } else {
          toast.error(t('updateFailed'))
        }
      } finally {
        setBusyId(null)
      }
    },
    [refresh, t],
  )

  /** «Gesehen»: close the request's bell entry — the crew reads «Vom KP gesehen»,
   *  the request stays open. Offered only where a bell entry exists. */
  const canMarkSeen = Boolean(notifications)
  const markSeen = useCallback(
    async (request: ApiFieldRequest) => {
      if (!notifications || !request.notification_id) return
      setBusyId(request.id)
      try {
        await notifications.dismissNotification(request.notification_id)
        await refresh()
      } finally {
        setBusyId(null)
      }
    },
    [notifications, refresh],
  )

  return { setStatus, markSeen, canMarkSeen, busyId }
}

/**
 * The bell's number with the field requests folded in: every open request
 * counts once, and its own bell entry is not counted a second time. A
 * dismissed bell entry of a still-open request keeps the request counted —
 * that is the whole difference between «gesehen» and «erledigt».
 */
export function useBellCount(
  notifications: { id: string; dismissed: boolean }[],
  open: ReturnType<typeof useOpenFieldRequests>,
): { count: number; activeNotifications: number } {
  return useMemo(() => {
    const active = notifications.filter(n => !n.dismissed && !open.representedIds.has(n.id)).length
    return { count: active + open.items.length, activeNotifications: active }
  }, [notifications, open])
}
