'use client'

/**
 * The bell's «Zu erledigen» (owner rule 24.11.2026): the board's to-dos with their counts.
 *
 * Gathers the Danach plans, the GPS notification rows and the field's open requests, keeps only
 * what is still a question (`lib/todos.ts`), and says how many are open and whether one is
 * overdue (red + pulse after 5'). Viewers get the list but no count: they cannot answer.
 * Re-renders once a minute (`useMinuteTick`) so a row turns red on its own.
 */

import { useMemo } from 'react'
import { useAuth } from '@/lib/contexts/auth-context'
import { useGroups } from '@/lib/contexts/groups-context'
import { useOptionalNotifications } from '@/lib/contexts/notification-context'
import { useOperations } from '@/lib/contexts/operations-context'
import { usePlanned } from '@/lib/contexts/planned-context'
import { useOpenFieldRequests } from '@/lib/hooks/use-field-requests'
import { getIncidentRefLabel } from '@/lib/incident-types'
import { collectTodos, GPS_TODO_TYPES, isOverdue, TODO_OVERDUE_MS, type Todo } from '@/lib/todos'
import { useMinuteTick } from '@/components/ui/incident-time'

export interface TodoState {
  /** Open to-dos, oldest first. */
  open: Todo[]
  /** «Verworfen»: greyed, buttons still work. */
  dismissed: Todo[]
  /** What the amber bell counts: open to-dos plus the field's open requests (editors only). */
  count: number
  /** One of them is open longer than 5'. */
  overdue: boolean
  /** Plain Meldungen still unread (the grey dot; GPS to-dos excluded). */
  unreadMessages: number
  now: number
}

export function useTodos(): TodoState {
  const { isEditor } = useAuth()
  const { planned } = usePlanned()
  const notifications = useOptionalNotifications()
  const { operations, personnel, vehicles, materials } = useOperations()
  const { groups } = useGroups()
  const requests = useOpenFieldRequests()
  useMinuteTick()
  const now = Date.now()

  const list = notifications?.notifications
  const todos = useMemo(
    () =>
      collectTodos(planned, list ?? [], {
        operations,
        groups,
        holderLabel: (holderId) => {
          const op = operations.find((o) => o.id === holderId)
          return op ? getIncidentRefLabel(op) : (groups.find((g) => g.id === holderId)?.name ?? '')
        },
        resourceName: (plan) => {
          const pool: readonly { id: string; name: string }[] =
            plan.resource_type === 'personnel' ? personnel : plan.resource_type === 'vehicle' ? vehicles : materials
          return pool.find((item) => item.id === plan.resource_id)?.name ?? '…'
        },
      }),
    [planned, list, operations, groups, personnel, vehicles, materials],
  )

  const open = todos.filter((todo) => !todo.dismissed)
  const dismissed = todos.filter((todo) => todo.dismissed)
  const requestOverdue = requests.items.some(({ request }) => now - Date.parse(request.created_at) >= TODO_OVERDUE_MS)
  const unreadMessages = (list ?? []).filter(
    (n) => !n.dismissed && !GPS_TODO_TYPES.has(n.type) && !requests.representedIds.has(n.id),
  ).length

  return {
    open,
    dismissed,
    count: isEditor ? open.length + requests.items.length : 0,
    overdue: isEditor && (open.some((todo) => isOverdue(todo, now)) || requestOverdue),
    unreadMessages,
    now,
  }
}
