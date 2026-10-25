'use client'

import { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo, ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import type { Notification, NotificationSettings } from '@/lib/types/notification'
import { DEFAULT_NOTIFICATION_SETTINGS } from '@/lib/types/notification'
import type { OperationDetailTab } from '@/lib/hooks/use-operation-detail-shortcuts'
import type { FieldNudgeKind } from '@/components/kanban/field-status-nudge'
import { useEvent } from '@/lib/contexts/event-context'
import { useAuth } from '@/lib/contexts/auth-context'
import { getApiUrl } from '@/lib/env'
import { isValidUUID } from '@/lib/utils/validation'
import { isStringArray, readItem, readJson, writeItem, writeJson } from '@/lib/utils/safe-storage'
import { wsClient } from '@/lib/websocket-client'
import { usePolling } from '@/lib/hooks/use-polling'
import { toast } from 'sonner'
import { translateOutsideReact } from '@/lib/i18n-messages'
import { dismissOutageToast, showOutageToast } from '@/lib/api/http'

interface NotificationContextValue {
  notifications: Notification[]
  unreadCount: number
  settings: NotificationSettings
  /**
   * The bell could not reach the backend and is showing the last thing it knew
   * (or nothing at all, if it never got a first answer). The panel's empty
   * state says «Alles ist in Ordnung» — an operator must never read that when
   * the truth is «ich kann es nicht sagen», so a consumer showing that state
   * has to check this first.
   */
  notificationsUnavailable: boolean
  /** When the notification list last came back from the backend. `null` = never
   *  in this session. Same idea as `lastSyncAt` behind the StaleDataBanner. */
  lastNotificationSyncAt: Date | null
  dismissNotification: (id: string) => Promise<void>
  /** `except`: bell entries that are not this list's to close — the sidebar
   *  shows an open field request in their place (R13), and «Alle schliessen»
   *  must not silently stamp those «gesehen». */
  dismissAllNotifications: (except?: ReadonlySet<string>) => Promise<void>
  updateSettings: (settings: Partial<NotificationSettings>) => Promise<void>
  refetchNotifications: () => Promise<void>
  // Sidebar state
  isSidebarOpen: boolean
  toggleSidebar: () => void
  openSidebar: () => void
  closeSidebar: () => void
  // Navigate to incident from notification. `tab` is which panel of the detail
  // the notification is ABOUT — the bell points at one specific thing, so it
  // opens on it rather than on Übersicht (§18.27).
  navigateToIncident: (incidentId: string, tab?: OperationDetailTab) => void
  /**
   * Whether anybody is currently listening for `navigateToIncident` — only the
   * board registers a handler, so on `/map` or in Einstellungen the call is a
   * no-op. Consumers must render the affordance (a clickable row, a clickable
   * toast body) only when this is true: a click target that does nothing is
   * worse than none, especially for an operator chasing a Meldung vom Feld.
   */
  canNavigateToIncident: boolean
  registerNavigateHandler: (
    handler: ((incidentId: string, tab?: OperationDetailTab) => void) | null,
  ) => void
  /**
   * Answer a field report — «angekommen», «Einsatz beendet» — straight from the
   * bell, without hunting for the card.
   *
   * Registered by whichever page owns the status workflow (board, map), because
   * the move has to run through the same gates a drag does — a completion that
   * skipped the Material-Entscheid would be a completion nobody can explain.
   * Null while no such page is mounted, and the notification then offers no
   * button rather than a broken one.
   */
  fieldAction: ((incidentId: string, kind: FieldNudgeKind) => void) | null
  registerFieldActionHandler: (
    handler: ((incidentId: string, kind: FieldNudgeKind) => void) | null,
  ) => void
  /**
   * Fulfil a field request (R13) straight from the sidebar: open the board's
   * own assignment dialog on that incident — material list searched for the
   * requested item, or the crew list for «Verstärkung». Registered by the board
   * (which owns the dialog); null elsewhere, and the sidebar then offers no
   * button rather than a broken one.
   */
  assignAction: FieldRequestAssignHandler | null
  registerAssignHandler: (handler: FieldRequestAssignHandler | null) => void
}

export type FieldRequestAssignHandler = (
  incidentId: string,
  resourceType: 'crew' | 'materials',
  search?: string,
) => void

const NotificationContext = createContext<NotificationContextValue | undefined>(undefined)

const SEEN_NOTIFICATION_IDS_KEY = 'seenNotificationIds'
const SIDEBAR_OPEN_KEY = 'notification-sidebar-open'

/**
 * One sticky toast id for "the bell is blind", never a burst.
 *
 * This runs on a poll, so a toast per failed attempt would be a dozen toasts a
 * minute for as long as the backend is down — noise on top of an outage. A
 * fixed id makes sonner reuse the same toast, `duration: Infinity` keeps it up
 * for exactly as long as the condition holds, and the recovery path dismisses
 * it. Same pattern the notification overflow summary uses.
 */
const UNAVAILABLE_TOAST_ID = 'notifications-unavailable'

/** The empty bell, one array: setting it again bails out of the render. */
const EMPTY_LIST: Notification[] = []

/**
 * What one poll learned. A failed fetch is NOT an empty notification list —
 * collapsing the two is what let the panel claim all is well while the backend
 * was unreachable.
 */
type NotificationFetchResult =
  | { status: 'ok'; notifications: Notification[] }
  /** No event picked / not signed in yet — there is nothing to ask about. */
  | { status: 'skipped' }
  | { status: 'failed' }

/**
 * Fetch notification settings. `null` means "could not tell" — NOT "defaults".
 * Handing back DEFAULT_NOTIFICATION_SETTINGS on a failed request silently
 * overwrote the station's configuration (sound, thresholds) with ours, which
 * is a wrong answer dressed up as a right one.
 */
async function fetchSettings(): Promise<NotificationSettings | null> {
  try {
    const apiUrl = getApiUrl()
    const response = await fetch(`${apiUrl}/api/notifications/settings/`, {
      credentials: 'include',
    })

    if (!response.ok) {
      console.error('Failed to fetch notification settings:', response.statusText)
      return null
    }

    return await response.json()
  } catch (error) {
    console.error('Error fetching notification settings:', error)
    return null
  }
}

/** Two rows say the same thing – every field the bell, the sidebar or a toast reads. */
function sameNotification(a: Notification, b: Notification): boolean {
  return (
    a.id === b.id &&
    a.type === b.type &&
    a.severity === b.severity &&
    a.message === b.message &&
    a.incident_id === b.incident_id &&
    a.dismissed === b.dismissed &&
    a.created_at.getTime() === b.created_at.getTime() &&
    JSON.stringify(a.params ?? null) === JSON.stringify(b.params ?? null)
  )
}

/**
 * The next notification list, reusing `prev`'s row objects where a row did not
 * change – and `prev` itself when none did. The poll and every
 * `notification_update` hand over a freshly parsed array; without this, each one
 * re-rendered all eleven consumers (bell, toasts, sidebar, board rows) even
 * when it learned nothing. Same idea as `areOperationListsEqual` for the board.
 */
export function reconcileNotifications(prev: Notification[], next: Notification[]): Notification[] {
  const byId = new Map(prev.map((n) => [n.id, n]))
  let changed = prev.length !== next.length
  const merged = next.map((n, i) => {
    const old = byId.get(n.id)
    if (old && sameNotification(old, n)) {
      if (prev[i] !== old) changed = true
      return old
    }
    changed = true
    return n
  })
  return changed ? merged : prev
}

/** The context, or undefined outside a provider — for leaf components that a
 *  test (or a login-less page) renders without the whole provider tree. */
export function useOptionalNotifications(): NotificationContextValue | undefined {
  return useContext(NotificationContext)
}

export function useNotifications() {
  const context = useContext(NotificationContext)
  if (!context) {
    throw new Error('useNotifications must be used within a NotificationProvider')
  }
  return context
}

interface NotificationProviderProps {
  children: ReactNode
  pollInterval?: number // milliseconds
}

export function NotificationProvider({
  children,
  pollInterval = 10000
}: NotificationProviderProps) {
  const { selectedEvent } = useEvent()
  const { isAuthenticated, isEditor, loading: authLoading } = useAuth()
  const [notifications, setNotifications] = useState<Notification[]>(EMPTY_LIST)
  const [settings, setSettings] = useState<NotificationSettings>(DEFAULT_NOTIFICATION_SETTINGS)
  const [notificationsUnavailable, setNotificationsUnavailable] = useState(false)
  const [lastNotificationSyncAt, setLastNotificationSyncAt] = useState<Date | null>(null)
  // The transition detector for the sticky toast. A ref, not the state above:
  // it has to be readable and writable inside an async poll callback that
  // closes over a stale render, and it must not depend on a re-render landing
  // first — otherwise a fast poll would toast twice.
  const unavailableRef = useRef(false)
  // The settings fetch runs once on mount. If that one attempt fails we would
  // spend the whole shift on DEFAULTS rather than on the station's config, so
  // remember whether it ever landed and keep asking until it does.
  const settingsLoadedRef = useRef(false)
  // Sidebar state with localStorage persistence
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(
    () => readItem(SIDEBAR_OPEN_KEY) === 'true'
  )

  // Persisted from an effect rather than from each setter: state updaters must
  // stay pure (StrictMode double-invokes them), and this way there is exactly
  // one write path to keep crash-safe.
  useEffect(() => {
    writeItem(SIDEBAR_OPEN_KEY, String(isSidebarOpen))
  }, [isSidebarOpen])

  const toggleSidebar = useCallback(() => setIsSidebarOpen(prev => !prev), [])
  const openSidebar = useCallback(() => setIsSidebarOpen(true), [])
  const closeSidebar = useCallback(() => setIsSidebarOpen(false), [])

  // Navigate to incident from notification click
  const navigateHandlerRef = useRef<((incidentId: string, tab?: OperationDetailTab) => void) | null>(null)

  // A ref for calling, a state for rendering. The ref keeps the call path free
  // of re-renders; the boolean has to be state because the consumers need to
  // re-render when a handler appears or goes away. Re-registering the same
  // handler is cheap — setting a boolean to the value it already has bails out
  // of the render.
  // Always true since the router fallback below: a notification is clickable
  // from EVERY page, not only where the board registered its handler.
  const canNavigateToIncident = true

  const registerNavigateHandler = useCallback(
    (handler: ((incidentId: string, tab?: OperationDetailTab) => void) | null) => {
      navigateHandlerRef.current = handler
    },
    [],
  )

  const router = useRouter()
  const navigateToIncident = useCallback((incidentId: string, tab?: OperationDetailTab) => {
    if (navigateHandlerRef.current) {
      navigateHandlerRef.current(incidentId, tab)
      return
    }
    // Not on the board (map, settings, …): the incident lives there, so go
    // there — the board already understands highlight + detail + tab from the URL.
    router.push(`/?highlight=${encodeURIComponent(incidentId)}&detail=1${tab ? `&tab=${tab}` : ''}`)
  }, [router])

  // State, not a ref like the navigate handler above: the notification card has
  // to RENDER differently depending on whether anybody can perform the move, so
  // registering one has to re-render the consumers.
  const [fieldAction, setFieldAction] = useState<
    ((incidentId: string, kind: FieldNudgeKind) => void) | null
  >(null)
  const registerFieldActionHandler = useCallback(
    (handler: ((incidentId: string, kind: FieldNudgeKind) => void) | null) => {
      // The setter form would CALL a function argument; wrap it.
      setFieldAction(() => handler)
    },
    [],
  )

  // Same reason as `fieldAction`: the sidebar renders the button only while
  // somebody can act on it.
  const [assignAction, setAssignAction] = useState<FieldRequestAssignHandler | null>(null)
  const registerAssignHandler = useCallback((handler: FieldRequestAssignHandler | null) => {
    setAssignAction(() => handler)
  }, [])

  // Load previously seen notification IDs from localStorage on mount.
  // Lazily initialised: a `useRef(expr)` argument is evaluated on EVERY render,
  // so reading + parsing storage inline would repeat the work on every pass.
  // Reads go through safe-storage — this provider sits in the root layout,
  // above every error.tsx boundary, so a corrupt value thrown here would take
  // down the whole app on every load with no in-app way to recover.
  const previousNotificationIds = useRef<Set<string>>(null!)
  previousNotificationIds.current ??= new Set(
    readJson(SEEN_NOTIFICATION_IDS_KEY, isStringArray, [])
  )

  const eventId = selectedEvent?.id ?? null

  // Fetch notifications from backend
  const fetchNotifications = useCallback(async (): Promise<NotificationFetchResult> => {
    // Don't fetch if auth is loading, no event is selected, event ID is invalid, or user is not authenticated
    if (authLoading || !eventId || !isValidUUID(eventId) || !isAuthenticated) {
      return { status: 'skipped' }
    }

    try {
      const apiUrl = getApiUrl()
      // Runs on a ~5s poll — stay quiet on the happy path, surface only real failures.
      const response = await fetch(`${apiUrl}/api/notifications/?event_id=${eventId}`, {
        credentials: 'include',
      })

      if (!response.ok) {
        console.error('[Notifications] Failed to fetch:', response.status, response.statusText)
        return { status: 'failed' }
      }

      const data = await response.json()

      // Convert created_at strings to Date objects. `message` and `params` pass
      // through as sent: the bell, the sidebar and the toasts say them in the
      // operator's language at render time (lib/notification-format.ts).
      return {
        status: 'ok',
        notifications: (data as (Omit<Notification, 'created_at'> & { created_at: string })[]).map((n) => ({
          ...n,
          created_at: new Date(n.created_at),
        })),
      }
    } catch (error) {
      console.error('[Notifications] Error fetching notifications:', error)
      if (error instanceof TypeError && error.message.includes('fetch')) {
        console.error('[Notifications] This is likely a CORS or network error. Check:')
        console.error('  1. Backend is running on', getApiUrl())
        console.error('  2. CORS allows credentials')
        console.error('  3. Network connection is stable')
      }
      return { status: 'failed' }
    }
  }, [authLoading, eventId, isAuthenticated])

  // Dismiss a notification. Editors only – the backend refuses a viewer, so for one
  // this (and dismissAll below) is a no-op rather than a 403 and an error toast.
  const dismissNotification = useCallback(async (id: string) => {
    if (!isEditor) return
    try {
      const apiUrl = getApiUrl()
      const response = await fetch(`${apiUrl}/api/notifications/${id}/dismiss`, {
        method: 'POST',
        credentials: 'include',
      })

      if (!response.ok) {
        console.error('Failed to dismiss notification:', response.statusText)
        toast.error(translateOutsideReact('notifications.center.dismissFailedTitle'), {
          description: translateOutsideReact('notifications.center.retryDescription'),
        })
        return
      }

      // Update local state
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, dismissed: true } : n))
      )
    } catch (error) {
      console.error('Error dismissing notification:', error)
      toast.error(translateOutsideReact('notifications.center.dismissFailedTitle'), {
        description: translateOutsideReact('notifications.center.retryDescription'),
      })
    }
  }, [isEditor])

  // Dismiss all active notifications
  const dismissAllNotifications = useCallback(async (except?: ReadonlySet<string>) => {
    if (!isEditor) return
    const activeNotifications = notifications.filter((n) => !n.dismissed && !except?.has(n.id))

    if (activeNotifications.length === 0) {
      return
    }

    try {
      const apiUrl = getApiUrl()

      // Dismiss all notifications in parallel
      const dismissPromises = activeNotifications.map((notification) =>
        fetch(`${apiUrl}/api/notifications/${notification.id}/dismiss`, {
          method: 'POST',
          credentials: 'include',
        })
      )

      const results = await Promise.allSettled(dismissPromises)

      // A rejected promise or a non-2xx response both mean the dismiss failed —
      // only mark the confirmed ones as dismissed locally, otherwise they would
      // resurrect on the next poll.
      const dismissedIds = new Set<string>()
      let failedCount = 0
      results.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value.ok) {
          dismissedIds.add(activeNotifications[index].id)
        } else {
          failedCount++
        }
      })

      if (failedCount > 0) {
        console.error(`Failed to dismiss ${failedCount} notifications`)
        toast.error(
          translateOutsideReact('notifications.center.dismissFailedCount', { count: failedCount }),
          { description: translateOutsideReact('notifications.center.retryDescription') }
        )
      }

      if (dismissedIds.size > 0) {
        setNotifications((prev) =>
          prev.map((n) => (dismissedIds.has(n.id) ? { ...n, dismissed: true } : n))
        )
      }
    } catch (error) {
      console.error('Error dismissing all notifications:', error)
      toast.error(translateOutsideReact('notifications.center.dismissAllFailedTitle'), {
        description: translateOutsideReact('notifications.center.retryDescription'),
      })
    }
  }, [isEditor, notifications])

  // Update notification settings
  const updateSettings = useCallback(async (newSettings: Partial<NotificationSettings>) => {
    try {
      const apiUrl = getApiUrl()
      const response = await fetch(`${apiUrl}/api/notifications/settings/`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify(newSettings),
      })

      if (!response.ok) {
        console.error('Failed to update notification settings:', response.statusText)
        toast.error(translateOutsideReact('notifications.center.settingsSaveFailedTitle'), {
          description: translateOutsideReact('notifications.center.retryDescription'),
        })
        return
      }

      const updated = await response.json()
      setSettings(updated)
    } catch (error) {
      console.error('Error updating notification settings:', error)
      toast.error(translateOutsideReact('notifications.center.settingsSaveFailedTitle'), {
        description: translateOutsideReact('notifications.center.retryDescription'),
      })
    }
  }, [])

  /** Raise the "I cannot tell" state — once per outage, not once per poll. */
  const markUnavailable = useCallback(() => {
    if (unavailableRef.current) return
    unavailableRef.current = true
    setNotificationsUnavailable(true)
    // Quiet while the stale banner shows the outage (lib/api/http.ts).
    showOutageToast(UNAVAILABLE_TOAST_ID)
  }, [])

  /** Clear it again the moment a request comes back. */
  const markAvailable = useCallback(() => {
    if (!unavailableRef.current) return
    unavailableRef.current = false
    setNotificationsUnavailable(false)
    dismissOutageToast(UNAVAILABLE_TOAST_ID)
  }, [])

  // Manual refetch function
  const refetchNotifications = useCallback(async () => {
    const result = await fetchNotifications()

    if (result.status === 'skipped') {
      // No event, no session — an empty bell is the correct answer here, and
      // it is not an outage.
      markAvailable()
      setNotifications(EMPTY_LIST)
      return
    }

    if (result.status === 'failed') {
      // Keep the last known list on screen and say so. Replacing it with `[]`
      // was the actual defect: the panel's empty state reads «Alles ist in
      // Ordnung», which is a claim this poll is in no position to make. Also
      // leave `previousNotificationIds` and its stored copy alone — clearing
      // them would make every notification look new again on recovery and
      // re-toast the lot.
      markUnavailable()
      return
    }

    const newNotifications = result.notifications
    markAvailable()
    setLastNotificationSyncAt(new Date())

    // Update previous notification IDs
    previousNotificationIds.current = new Set(newNotifications.map((n) => n.id))

    // Persist to localStorage to prevent retriggering on page reload.
    // Best-effort: a failed write (quota) only means a toast may re-show once.
    writeJson(SEEN_NOTIFICATION_IDS_KEY, Array.from(previousNotificationIds.current))

    // Preserve locally-dismissed state: a poll response that was in flight when
    // the user dismissed a notification would otherwise resurrect it until the
    // next poll reflects the dismissal.
    setNotifications((prev) => {
      const locallyDismissed = new Set(
        prev.filter((n) => n.dismissed).map((n) => n.id)
      )
      return reconcileNotifications(
        prev,
        newNotifications.map((n) =>
          !n.dismissed && locallyDismissed.has(n.id) ? { ...n, dismissed: true } : n
        ),
      )
    })
  }, [fetchNotifications, markAvailable, markUnavailable])

  const canFetch = !authLoading && isAuthenticated && !!eventId && isValidUUID(eventId)

  // Nothing to ask about — an empty bell here is an answer, not a gap, so any
  // outstanding "I cannot tell" state goes with it.
  useEffect(() => {
    if (canFetch) return
    markAvailable()
    setNotifications(EMPTY_LIST)
  }, [canFetch, markAvailable])

  /** One sync: the list, plus the settings if they have never arrived. */
  const sync = useCallback(async () => {
    await refetchNotifications()
    if (settingsLoadedRef.current) return
    const loaded = await fetchSettings()
    if (loaded) {
      settingsLoadedRef.current = true
      setSettings(loaded)
    }
  }, [refetchNotifications])

  // The socket pushes `notification_update`; the poll covers the gaps while it
  // is down (and runs once when it comes back).
  usePolling(sync, { intervalMs: pollInterval, enabled: canFetch, skipWhileWsConnected: true })
  useEffect(() => {
    if (!canFetch) return
    return wsClient.on('notification_update', () => {
      void sync()
    })
  }, [canFetch, sync])

  // Calculate unread count (active notifications)
  const unreadCount = notifications.filter((n) => !n.dismissed).length

  const value = useMemo<NotificationContextValue>(() => ({
    notifications,
    unreadCount,
    settings,
    notificationsUnavailable,
    lastNotificationSyncAt,
    dismissNotification,
    dismissAllNotifications,
    updateSettings,
    refetchNotifications,
    isSidebarOpen,
    toggleSidebar,
    openSidebar,
    closeSidebar,
    navigateToIncident,
    canNavigateToIncident,
    registerNavigateHandler,
    fieldAction,
    registerFieldActionHandler,
    assignAction,
    registerAssignHandler,
  }), [
    notifications,
    unreadCount,
    settings,
    notificationsUnavailable,
    lastNotificationSyncAt,
    dismissNotification,
    dismissAllNotifications,
    updateSettings,
    refetchNotifications,
    isSidebarOpen,
    toggleSidebar,
    openSidebar,
    closeSidebar,
    navigateToIncident,
    canNavigateToIncident,
    registerNavigateHandler,
    fieldAction,
    registerFieldActionHandler,
    assignAction,
    registerAssignHandler,
  ])

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  )
}
