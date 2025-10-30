'use client'

import { useEffect, useRef } from 'react'
import { toast, Toaster } from 'sonner'
import { useNotifications } from '@/lib/contexts/notification-context'
import type { Notification } from '@/lib/types/notification'

export function NotificationToasts() {
  const { notifications, dismissNotification } = useNotifications()
  const shownToastIds = useRef<Set<string>>(new Set())

  useEffect(() => {
    // Show new undismissed notifications as toasts
    const newNotifications = notifications.filter(
      (n) => !n.dismissed && !shownToastIds.current.has(n.id)
    )

    newNotifications.forEach((notification) => {
      shownToastIds.current.add(notification.id)

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
  }, [notifications, dismissNotification])

  return (
    <Toaster
      position="bottom-right"
      richColors
      closeButton
      expand={false}
      toastOptions={{
        classNames: {
          toast: 'group border shadow-lg',
          title: 'font-semibold text-sm',
          description: 'text-sm leading-relaxed',
          actionButton: 'bg-primary text-primary-foreground hover:bg-primary/90 font-medium',
          cancelButton: 'bg-muted text-muted-foreground hover:bg-muted/80',
          closeButton: 'bg-background border border-border hover:bg-muted',
          error: 'border-destructive/50 bg-destructive/10',
          warning: 'border-orange-500/50 bg-orange-50 dark:bg-orange-950/10',
          info: 'border-primary/50 bg-primary/10',
        },
      }}
    />
  )
}
