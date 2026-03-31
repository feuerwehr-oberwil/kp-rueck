'use client'

import { createContext, useContext, useState, useEffect, useRef, useCallback, ReactNode } from 'react'
import type { Notification, NotificationSettings } from '@/lib/types/notification'
import { DEFAULT_NOTIFICATION_SETTINGS } from '@/lib/types/notification'
import { useEvent } from '@/lib/contexts/event-context'
import { useAuth } from '@/lib/contexts/auth-context'
import { getApiUrl } from '@/lib/env'
import { wsClient, type WebSocketStatus } from '@/lib/websocket-client'

interface NotificationContextValue {
  notifications: Notification[]
  unreadCount: number
  settings: NotificationSettings
  dismissNotification: (id: string) => Promise<void>
  dismissAllNotifications: () => Promise<void>
  updateSettings: (settings: Partial<NotificationSettings>) => Promise<void>
  refetchNotifications: () => Promise<void>
  // Sidebar state
  isSidebarOpen: boolean
  toggleSidebar: () => void
  openSidebar: () => void
  closeSidebar: () => void
  // Navigate to incident from notification
  navigateToIncident: (incidentId: string) => void
  registerNavigateHandler: (handler: ((incidentId: string) => void) | null) => void
}

const NotificationContext = createContext<NotificationContextValue | undefined>(undefined)

// Simple UUID validation to prevent invalid IDs from being used in API calls
const isValidUUID = (id: string | undefined | null): id is string => {
  if (!id) return false
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  return uuidRegex.test(id)
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
  const { isAuthenticated, loading: authLoading } = useAuth()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [settings, setSettings] = useState<NotificationSettings>(DEFAULT_NOTIFICATION_SETTINGS)
  // Sidebar state with localStorage persistence
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return localStorage.getItem('notification-sidebar-open') === 'true'
  })

  const toggleSidebar = useCallback(() => {
    setIsSidebarOpen(prev => {
      const newValue = !prev
      localStorage.setItem('notification-sidebar-open', String(newValue))
      return newValue
    })
  }, [])

  const openSidebar = useCallback(() => {
    setIsSidebarOpen(true)
    localStorage.setItem('notification-sidebar-open', 'true')
  }, [])

  const closeSidebar = useCallback(() => {
    setIsSidebarOpen(false)
    localStorage.setItem('notification-sidebar-open', 'false')
  }, [])

  // Navigate to incident from notification click
  const navigateHandlerRef = useRef<((incidentId: string) => void) | null>(null)

  const registerNavigateHandler = useCallback((handler: ((incidentId: string) => void) | null) => {
    navigateHandlerRef.current = handler
  }, [])

  const navigateToIncident = useCallback((incidentId: string) => {
    navigateHandlerRef.current?.(incidentId)
  }, [])

  // Load previously seen notification IDs from localStorage on mount
  const previousNotificationIds = useRef<Set<string>>(
    typeof window !== 'undefined'
      ? new Set(JSON.parse(localStorage.getItem('seenNotificationIds') || '[]'))
      : new Set()
  )

  // Fetch notifications from backend
  const fetchNotifications = async (): Promise<Notification[]> => {
    // Don't fetch if auth is loading, no event is selected, event ID is invalid, or user is not authenticated
    if (authLoading || !selectedEvent || !isValidUUID(selectedEvent.id) || !isAuthenticated) {
      return []
    }

    try {
      const apiUrl = getApiUrl()
      console.log('[Notifications] Fetching from:', `${apiUrl}/api/notifications/?event_id=${selectedEvent.id}`)

      const response = await fetch(`${apiUrl}/api/notifications/?event_id=${selectedEvent.id}`, {
        credentials: 'include',
      })

      console.log('[Notifications] Response status:', response.status, response.statusText)

      if (!response.ok) {
        console.error('[Notifications] Failed to fetch:', response.status, response.statusText)
        return []
      }

      const data = await response.json()
      console.log('[Notifications] Received', data.length, 'notifications')

      // Convert created_at strings to Date objects
      return data.map((n: any) => ({
        ...n,
        created_at: new Date(n.created_at),
      }))
    } catch (error) {
      console.error('[Notifications] Error fetching notifications:', error)
      if (error instanceof TypeError && error.message.includes('fetch')) {
        console.error('[Notifications] This is likely a CORS or network error. Check:')
        console.error('  1. Backend is running on', getApiUrl())
        console.error('  2. CORS allows credentials')
        console.error('  3. Network connection is stable')
      }
      return []
    }
  }

  // Fetch notification settings from backend
  const fetchSettings = async (): Promise<NotificationSettings> => {
    try {
      const apiUrl = getApiUrl()
      const response = await fetch(`${apiUrl}/api/notifications/settings/`, {
        credentials: 'include',
      })

      if (!response.ok) {
        console.error('Failed to fetch notification settings:', response.statusText)
        return DEFAULT_NOTIFICATION_SETTINGS
      }

      return await response.json()
    } catch (error) {
      console.error('Error fetching notification settings:', error)
      return DEFAULT_NOTIFICATION_SETTINGS
    }
  }

  // Dismiss a notification
  const dismissNotification = async (id: string) => {
    try {
      const apiUrl = getApiUrl()
      const response = await fetch(`${apiUrl}/api/notifications/${id}/dismiss`, {
        method: 'POST',
        credentials: 'include',
      })

      if (!response.ok) {
        console.error('Failed to dismiss notification:', response.statusText)
        return
      }

      // Update local state
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, dismissed: true } : n))
      )
    } catch (error) {
      console.error('Error dismissing notification:', error)
    }
  }

  // Dismiss all active notifications
  const dismissAllNotifications = async () => {
    const activeNotifications = notifications.filter((n) => !n.dismissed)

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

      // Check for failures
      const failures = results.filter((r) => r.status === 'rejected')
      if (failures.length > 0) {
        console.error('Failed to dismiss some notifications:', failures)
      }

      // Update local state for all notifications
      setNotifications((prev) =>
        prev.map((n) => ({ ...n, dismissed: true }))
      )
    } catch (error) {
      console.error('Error dismissing all notifications:', error)
    }
  }

  // Update notification settings
  const updateSettings = async (newSettings: Partial<NotificationSettings>) => {
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
        return
      }

      const updated = await response.json()
      setSettings(updated)
    } catch (error) {
      console.error('Error updating notification settings:', error)
    }
  }

  // Manual refetch function
  const refetchNotifications = async () => {
    const newNotifications = await fetchNotifications()

    // Update previous notification IDs
    previousNotificationIds.current = new Set(newNotifications.map((n) => n.id))

    // Persist to localStorage to prevent retriggering on page reload
    if (typeof window !== 'undefined') {
      localStorage.setItem(
        'seenNotificationIds',
        JSON.stringify(Array.from(previousNotificationIds.current))
      )
    }

    setNotifications(newNotifications)
  }

  // WebSocket + polling fallback for notifications
  useEffect(() => {
    // Only fetch if auth is loaded, we have a selected event with valid ID, and user is authenticated
    if (authLoading || !selectedEvent || !isValidUUID(selectedEvent.id) || !isAuthenticated) {
      setNotifications([])
      return
    }

    // Initial fetch
    refetchNotifications()

    // Fetch settings
    fetchSettings().then(setSettings)

    // Listen for WebSocket notification events
    const unsubscribeNotification = wsClient.on('notification_update', () => {
      refetchNotifications()
    })

    // Fallback polling when WebSocket is disconnected
    let pollIntervalId: NodeJS.Timeout | undefined

    const startPolling = () => {
      if (!pollIntervalId) {
        pollIntervalId = setInterval(refetchNotifications, pollInterval)
      }
    }

    const stopPolling = () => {
      if (pollIntervalId) {
        clearInterval(pollIntervalId)
        pollIntervalId = undefined
      }
    }

    const unsubscribeStatus = wsClient.onStatusChange((status: WebSocketStatus) => {
      if (status === 'disconnected' || status === 'error') {
        startPolling()
      } else if (status === 'connected') {
        stopPolling()
      }
    })

    return () => {
      unsubscribeNotification()
      unsubscribeStatus()
      stopPolling()
    }
  }, [pollInterval, selectedEvent, isAuthenticated, authLoading])

  // Calculate unread count (active notifications)
  const unreadCount = notifications.filter((n) => !n.dismissed).length

  const value: NotificationContextValue = {
    notifications,
    unreadCount,
    settings,
    dismissNotification,
    dismissAllNotifications,
    updateSettings,
    refetchNotifications,
    isSidebarOpen,
    toggleSidebar,
    openSidebar,
    closeSidebar,
    navigateToIncident,
    registerNavigateHandler,
  }

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  )
}
