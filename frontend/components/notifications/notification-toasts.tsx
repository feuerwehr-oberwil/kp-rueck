'use client'

import { useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { toast, Toaster } from 'sonner'
import { useNotifications } from '@/lib/contexts/notification-context'
import { useIsMobile } from '@/components/ui/use-mobile'
import type { Notification } from '@/lib/types/notification'
import { isStringArray, readJson, removeItem, writeJson } from '@/lib/utils/safe-storage'

const TOAST_DATA_KEY = 'shownToastData'
const LEGACY_TOAST_IDS_KEY = 'shownToastIds'

interface ShownToast {
  id: string
  timestamp: number
}

// Validating the SHAPE, not just that it parsed. A value written by an older
// build (or truncated by a full quota) can be perfectly valid JSON of the
// wrong type — `{}` here would sail through JSON.parse and then throw on the
// first `.filter`. This component renders in the root layout, above every
// error.tsx boundary, so that throw would white-screen the whole app on every
// load until the operator cleared site data.
function isShownToastArray(value: unknown): value is ShownToast[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item): item is ShownToast =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as ShownToast).id === 'string' &&
        typeof (item as ShownToast).timestamp === 'number'
    )
  )
}

// Helper to get stored toast IDs with timestamps
function getStoredToastData(): ShownToast[] {
  const stored = readJson(TOAST_DATA_KEY, isShownToastArray, null)
  if (stored) return stored

  // Migration: check for the old id-only format
  const oldIds = readJson(LEGACY_TOAST_IDS_KEY, isStringArray, null)
  if (oldIds) {
    const migrated = oldIds.map((id) => ({
      id,
      timestamp: Date.now() - 12 * 60 * 60 * 1000, // Set to 12 hours ago
    }))
    writeJson(TOAST_DATA_KEY, migrated)
    removeItem(LEGACY_TOAST_IDS_KEY) // Clean up old format
    return migrated
  }

  return []
}

// Helper to clean up old toast IDs (older than 24 hours)
function cleanupOldToastIds(): Set<string> {
  const now = Date.now()
  const oneDayMs = 24 * 60 * 60 * 1000

  const storedData = getStoredToastData()
  const validData = storedData.filter(item => now - item.timestamp < oneDayMs)

  if (validData.length !== storedData.length) {
    // Some items were cleaned up, update localStorage
    writeJson(TOAST_DATA_KEY, validData)
  }

  return new Set(validData.map(item => item.id))
}

export function NotificationToasts() {
  const { notifications, dismissNotification, isSidebarOpen, settings } = useNotifications()
  const isMobile = useIsMobile()
  // Non-critical toast lifetime (ms), configurable in notification settings.
  const toastDurationMs = Math.max(2, settings.toast_duration_seconds || 8) * 1000
  const tCommon = useTranslations('kanban.common')
  const tToasts = useTranslations('notifications.toasts')

  // Initialize with previously shown notification IDs from localStorage,
  // dropping IDs older than 24 hours. Lazily assigned because a `useRef(expr)`
  // argument is evaluated on EVERY render — passing the call directly re-read,
  // re-parsed and sometimes re-WROTE localStorage synchronously on each render
  // of this root-layout component.
  const shownToastIds = useRef<Set<string>>(null!)
  shownToastIds.current ??= cleanupOldToastIds()

  // Mobile is a viewing-first surface (mainly used to spawn training incidents),
  // so it should stay quiet: suppress non-critical toasts app-wide while small.
  // Genuine action failures (toast.error) still surface; the notification→toast
  // mapping below is skipped entirely on mobile.
  useEffect(() => {
    if (!isMobile) return
    const t = toast as unknown as Record<string, (...args: unknown[]) => unknown>
    const noop = () => ''
    const originals: Record<string, (...args: unknown[]) => unknown> = {}
    for (const key of ['success', 'info', 'warning', 'loading', 'message']) {
      originals[key] = t[key]
      t[key] = noop
    }
    return () => {
      for (const key of Object.keys(originals)) t[key] = originals[key]
    }
  }, [isMobile])

  useEffect(() => {
    // Don't show toasts when sidebar is open - notifications are visible there.
    // On mobile, don't surface incident/notification toasts at all.
    if (isSidebarOpen || isMobile) {
      return
    }

    // Show new undismissed notifications as toasts
    const newNotifications = notifications.filter(
      (n) => !n.dismissed && !shownToastIds.current.has(n.id)
    )

    newNotifications.forEach((notification) => {
      shownToastIds.current.add(notification.id)

      // Persist to localStorage with timestamp to prevent re-showing on page
      // reload. Best-effort: if the write fails (quota), the worst case is
      // this toast showing once more after a reload.
      const storedData = getStoredToastData()
      storedData.push({
        id: notification.id,
        timestamp: Date.now()
      })
      writeJson(TOAST_DATA_KEY, storedData)

      const toastOptions = {
        id: notification.id,
        description: notification.message,
        // Dismiss notification when toast is closed by any means
        onDismiss: () => dismissNotification(notification.id),
        action: notification.severity === 'critical' ? {
          label: tCommon('close'),
          // Close the toast, which will trigger onDismiss callback
          onClick: () => toast.dismiss(notification.id),
        } : undefined,
      }

      if (notification.severity === 'critical') {
        toast.error(tToasts('criticalTitle'), {
          ...toastOptions,
          duration: Infinity, // Manual dismiss only
        })
      } else if (notification.severity === 'warning') {
        toast.warning(tToasts('warningTitle'), {
          ...toastOptions,
          duration: toastDurationMs,
        })
      } else {
        toast.info(tToasts('infoTitle'), {
          ...toastOptions,
          duration: toastDurationMs,
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
  }, [notifications, dismissNotification, isSidebarOpen, toastDurationMs])

  return (
    <Toaster
      position="bottom-right"
      // Hug the right edge (16px) so the stack stays out of the central board, and
      // sit just above the footer/nav (bottom floor is the footer + "Alle schliessen"
      // pill). Cap the visible stack so tall warning bursts don't climb into content.
      offset={{ right: '16px', bottom: '80px' }}
      visibleToasts={2}
      closeButton
      expand={false}
      duration={toastDurationMs}
      toastOptions={{
        classNames: {
          toast: 'group shadow-lg',
          title: 'font-semibold text-sm',
          description: 'text-sm leading-relaxed',
          actionButton: 'bg-black/10 hover:bg-black/20 dark:bg-white/20 dark:hover:bg-white/30 font-medium',
          cancelButton: 'bg-black/5 hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/20',
          closeButton: 'bg-black/5 border-0 hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/20',
          success: 'bg-success/10 text-success border-success/30',
          error: 'bg-destructive/10 text-destructive border-destructive/30',
          warning: 'bg-warning/10 text-warning border-warning/30',
          info: 'bg-info/10 text-info border-info/30',
        },
      }}
    />
  )
}
