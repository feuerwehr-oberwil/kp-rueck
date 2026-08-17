'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast, Toaster } from 'sonner'
import { useNotifications } from '@/lib/contexts/notification-context'
import { useIsMobile } from '@/components/ui/use-mobile'
import { isStringArray, readJson, removeItem, writeJson } from '@/lib/utils/safe-storage'
import { planToastBurst, TOAST_BURST_LIMIT } from '@/lib/notification-policy'
import { detailTabForNotification } from '@/lib/notification-detail-tab'

/**
 * Where the stack sits. Stable identities — see the note on the `offset` prop.
 *
 * Desktop has nothing at the bottom of the board, so the stack sits close to the
 * edge: the «Alle schliessen» pill takes the last 16px and the toasts start just
 * above it. It used to float 80px up with the pill at 48px, leaving a band of
 * empty screen underneath that made the whole group look detached from the
 * corner it is anchored to.
 *
 * Mobile keeps its distance: the bottom navigation is fixed there (min 60px plus
 * the safe-area inset), and a toast printed over the tab bar is a toast that
 * eats a tap.
 */
const TOASTER_OFFSET = { right: '16px', bottom: '56px' }
const TOASTER_OFFSET_MOBILE = { right: '16px', bottom: '116px' }

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
  const {
    notifications,
    dismissNotification,
    isSidebarOpen,
    settings,
    openSidebar,
    navigateToIncident,
    canNavigateToIncident,
  } = useNotifications()
  const isMobile = useIsMobile()
  // `/feld` is the crew's surface, and it is quiet for the same reason the phone
  // is — but on ITS OWN account rather than on the viewport's. An officer who
  // opens `/feld` on a laptop is still logged in to the board, so the board's
  // notifications followed them in: a crew standing in the rain got «Einsatz
  // überfällig» about a Schadenplatz that is none of their business, on a page
  // whose whole design is four buttons and nothing else. The board's traffic is
  // for the KP.
  const pathname = usePathname()
  const isQuietSurface = isMobile || (pathname?.startsWith('/feld') ?? false)
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

  // Mobile is a viewing-first surface (mainly used to spawn training incidents)
  // and `/feld` belongs to a crew, so both stay quiet: suppress non-critical
  // toasts app-wide there. Genuine action failures (`toast.error`) still
  // surface — a Meldung that did not go through has to say so — and the
  // notification→toast mapping below is skipped entirely.
  useEffect(() => {
    if (!isQuietSurface) return
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
  }, [isQuietSurface])

  useEffect(() => {
    // Don't show toasts when sidebar is open - notifications are visible there.
    // On mobile and on /feld, don't surface incident/notification toasts at all.
    if (isSidebarOpen || isQuietSurface) {
      return
    }

    // Show new undismissed notifications as toasts
    const newNotifications = notifications.filter(
      (n) => !n.dismissed && !shownToastIds.current.has(n.id)
    )

    // Guarded rather than early-returned: the dismissal sweep at the bottom has
    // to run on every pass, new notifications or not.
    if (newNotifications.length > 0) {
      // A burst is the normal case, not the exception: one board load with
      // twenty stale incidents produces twenty `time_overdue` warnings at once.
      // Decide the whole batch up front — ordered oldest-first, capped, urgent
      // ones exempt from the cap — instead of firing one toast per array entry
      // in whatever order the API happened to return.
      const { toast: toBeToasted, overflow } = planToastBurst(newNotifications, TOAST_BURST_LIMIT)

      // Everything in the batch counts as seen, including the quiet and the
      // summarised ones: they are in the bell, and re-toasting them on the next
      // poll is how a burst becomes a permanent storm.
      const now = Date.now()
      const storedData = getStoredToastData()
      for (const notification of newNotifications) {
        shownToastIds.current.add(notification.id)
        storedData.push({ id: notification.id, timestamp: now })
      }
      // One write for the whole batch. The old code re-read AND re-wrote the
      // full list once per notification — quadratic synchronous storage work in
      // exactly the moment the UI was already busy.
      writeJson(TOAST_DATA_KEY, storedData)

      toBeToasted.forEach((notification) => {
        // «Meldung vom Feld – Hauptstrasse 1: …» named a Schadenplatz the
        // operator then had to find by hand while the toast was still on
        // screen. The message itself opens it, on the tab the notification is
        // about — the same path the bell takes (§18.27).
        //
        // Only when there is somewhere to go: the notification has to carry an
        // incident, and a page has to be listening (the board registers the
        // handler, the map does not).
        const target = canNavigateToIncident ? notification.incident_id : undefined
        const description = target ? (
          <button
            type="button"
            title={tToasts('openIncident')}
            className="cursor-pointer text-left underline decoration-dotted underline-offset-2 hover:decoration-solid focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-current rounded-xs"
            onClick={() => {
              // Dismissing the toast runs `onDismiss` below, which clears the
              // notification too — reading it and acting on it is the same act.
              toast.dismiss(notification.id)
              navigateToIncident(target, detailTabForNotification(notification.type))
            }}
          >
            {notification.message}
          </button>
        ) : (
          notification.message
        )

        const toastOptions = {
          id: notification.id,
          description,
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

      // The rest is one line, not fifteen toasts. Fixed id so a second burst
      // replaces the summary instead of stacking another one behind it.
      if (overflow.length > 0) {
        toast.info(tToasts('overflowTitle', { count: overflow.length }), {
          id: 'notification-overflow',
          description: tToasts('overflowDescription'),
          duration: toastDurationMs,
          action: {
            label: tToasts('overflowAction'),
            onClick: () => {
              toast.dismiss('notification-overflow')
              openSidebar()
            },
          },
        })
      }
    }

    // Dismiss toasts for notifications that have been dismissed elsewhere (e.g., in sidebar)
    const dismissedNotifications = notifications.filter(
      (n) => n.dismissed && shownToastIds.current.has(n.id)
    )

    dismissedNotifications.forEach((notification) => {
      // Remove the toast from the screen
      toast.dismiss(notification.id)
      // Keep in shownToastIds to prevent re-showing
    })
  }, [
    notifications,
    dismissNotification,
    isSidebarOpen,
    isQuietSurface,
    toastDurationMs,
    openSidebar,
    navigateToIncident,
    canNavigateToIncident,
  ])

  return (
    <Toaster
      position="bottom-right"
      // Hug the bottom-right corner: 16px from the right, and just above the
      // "Alle schliessen" pill that closes the stack (on mobile, above the tab
      // bar instead). Cap the visible stack so tall warning bursts don't climb
      // into content.
      //
      // A module constant, not an inline literal: a fresh object on every render
      // re-runs Sonner's positioning effect, which is what made toasts slide in
      // from somewhere other than where they belong during a burst.
      offset={isMobile ? TOASTER_OFFSET_MOBILE : TOASTER_OFFSET}
      // Matches the burst budget (the "+N weitere" summary is counted inside it),
      // so a planned burst lands at once instead of trickling in as timers expire.
      visibleToasts={TOAST_BURST_LIMIT}
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
          warning: 'bg-warning/10 text-warning-foreground border-warning/30',
          info: 'bg-info/10 text-info border-info/30',
        },
      }}
    />
  )
}
