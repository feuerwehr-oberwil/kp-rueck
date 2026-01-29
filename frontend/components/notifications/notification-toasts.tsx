'use client'

import { useEffect, useRef } from 'react'
import { toast, Toaster } from 'sonner'
import { useNotifications } from '@/lib/contexts/notification-context'
import type { Notification } from '@/lib/types/notification'

// Helper to get stored toast IDs with timestamps
function getStoredToastData(): { id: string; timestamp: number }[] {
  if (typeof window === 'undefined') return []
  try {
    const data = localStorage.getItem('shownToastData')
    if (data) {
      return JSON.parse(data)
    }

    // Migration: Check for old format
    const oldData = localStorage.getItem('shownToastIds')
    if (oldData) {
      try {
        const oldIds = JSON.parse(oldData)
        const migratedData = oldIds.map((id: string) => ({
          id,
          timestamp: Date.now() - 12 * 60 * 60 * 1000 // Set to 12 hours ago
        }))
        localStorage.setItem('shownToastData', JSON.stringify(migratedData))
        localStorage.removeItem('shownToastIds') // Clean up old format
        return migratedData
      } catch {
        // If migration fails, just return empty
      }
    }

    return []
  } catch {
    return []
  }
}

// Helper to clean up old toast IDs (older than 24 hours)
function cleanupOldToastIds(): Set<string> {
  const now = Date.now()
  const oneDayMs = 24 * 60 * 60 * 1000

  const storedData = getStoredToastData()
  const validData = storedData.filter(item => now - item.timestamp < oneDayMs)

  if (typeof window !== 'undefined' && validData.length !== storedData.length) {
    // Some items were cleaned up, update localStorage
    localStorage.setItem('shownToastData', JSON.stringify(validData))
  }

  return new Set(validData.map(item => item.id))
}

export function NotificationToasts() {
  const { notifications, dismissNotification, isSidebarOpen } = useNotifications()

  // Initialize with previously shown notification IDs from localStorage
  // Clean up IDs older than 24 hours on component mount
  const shownToastIds = useRef<Set<string>>(cleanupOldToastIds())

  useEffect(() => {
    // Don't show toasts when sidebar is open - notifications are visible there
    if (isSidebarOpen) {
      return
    }

    // Show new undismissed notifications as toasts
    const newNotifications = notifications.filter(
      (n) => !n.dismissed && !shownToastIds.current.has(n.id)
    )

    newNotifications.forEach((notification) => {
      shownToastIds.current.add(notification.id)

      // Persist to localStorage with timestamp to prevent re-showing on page reload
      if (typeof window !== 'undefined') {
        const storedData = getStoredToastData()
        storedData.push({
          id: notification.id,
          timestamp: Date.now()
        })
        localStorage.setItem('shownToastData', JSON.stringify(storedData))
      }

      const toastOptions = {
        id: notification.id,
        description: notification.message,
        // Dismiss notification when toast is closed by any means
        onDismiss: () => dismissNotification(notification.id),
        action: notification.severity === 'critical' ? {
          label: 'Schliessen',
          // Close the toast, which will trigger onDismiss callback
          onClick: () => toast.dismiss(notification.id),
        } : undefined,
      }

      if (notification.severity === 'critical') {
        toast.error('Kritische Warnung', {
          ...toastOptions,
          duration: Infinity, // Manual dismiss only
        })
      } else if (notification.severity === 'warning') {
        toast.warning('Warnung', {
          ...toastOptions,
          duration: 5000,
        })
      } else {
        toast.info('Information', {
          ...toastOptions,
          duration: 3000,
        })
      }
    })

    // Dismiss toasts for notifications that have been dismissed elsewhere (e.g., in sidebar)
    const dismissedNotifications = notifications.filter(
      (n) => n.dismissed && shownToastIds.current.has(n.id)
    )

    dismissedNotifications.forEach((notification) => {
      // Remove the toast from the screen
      toast.dismiss(notification.id)
      // Keep in shownToastIds to prevent re-showing
    })
  }, [notifications, dismissNotification, isSidebarOpen])

  return (
    <Toaster
      position="bottom-right"
      closeButton
      expand={false}
      toastOptions={{
        classNames: {
          toast: 'group shadow-lg',
          title: 'font-semibold text-sm',
          description: 'text-sm leading-relaxed',
          actionButton: 'bg-black/10 hover:bg-black/20 dark:bg-white/20 dark:hover:bg-white/30 font-medium',
          cancelButton: 'bg-black/5 hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/20',
          closeButton: 'bg-black/5 border-0 hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/20',
          success: '!bg-green-50 !text-green-900 !border-green-300 dark:!bg-zinc-900 dark:!text-green-100 dark:!border-green-600/50',
          error: '!bg-red-50 !text-red-900 !border-red-300 dark:!bg-zinc-900 dark:!text-red-100 dark:!border-red-600/50',
          warning: '!bg-orange-50 !text-orange-900 !border-orange-300 dark:!bg-zinc-900 dark:!text-orange-100 dark:!border-orange-600/50',
          info: '!bg-blue-50 !text-blue-900 !border-blue-300 dark:!bg-zinc-900 dark:!text-blue-100 dark:!border-blue-600/50',
        },
      }}
    />
  )
}
