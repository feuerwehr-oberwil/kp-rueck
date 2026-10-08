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

import { apiClient, type ApiFieldRequest, type ApiFieldRequestStatus } from '@/lib/api-client'
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

  const setStatus = useCallback(
    async (request: ApiFieldRequest, status: ApiFieldRequestStatus) => {
      setBusyId(request.id)
      try {
        await apiClient.setFieldRequestStatus(request.incident_id, request.id, status)
        await Promise.all([refreshOperations(), notifications?.refetchNotifications()])
        onChanged?.()
      } catch (error) {
        console.error('Failed to update field request:', error)
        toast.error(t('updateFailed'))
      } finally {
        setBusyId(null)
      }
    },
    [notifications, onChanged, refreshOperations, t],
  )

  return { setStatus, busyId }
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
