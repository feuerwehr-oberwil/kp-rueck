'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Bell } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { useNotifications } from '@/lib/contexts/notification-context'
import { useAuth } from '@/lib/contexts/auth-context'
import { NotificationCard } from '@/components/notifications/notification-card'
import type { OperationDetailTab } from '@/lib/hooks/use-operation-detail-shortcuts'

interface NotificationSidebarProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function NotificationSidebar({ open: controlledOpen, onOpenChange }: NotificationSidebarProps = {}) {
  const t = useTranslations('notifications.sidebar')
  const [internalOpen, setInternalOpen] = useState(false)
  const isOpen = controlledOpen ?? internalOpen
  const setIsOpen = onOpenChange ?? setInternalOpen
  const {
    notifications,
    unreadCount,
    dismissNotification,
    dismissAllNotifications,
    navigateToIncident,
    canNavigateToIncident,
  } = useNotifications()
  const { isAuthenticated } = useAuth()

  // Notifications are an authenticated-only feature — nothing when logged out
  if (!isAuthenticated) return null

  // The sheet took an `onClickIncident` prop that its only caller never passed,
  // so every row looked clickable and merely closed the sheet. It routes
  // through the same registered handler the persistent sidebar uses — and
  // hands the card nothing at all when no page is listening, so the row stops
  // pretending.
  const handleClickIncident = canNavigateToIncident
    ? (incidentId: string, tab?: OperationDetailTab) => {
        setIsOpen(false)
        navigateToIncident(incidentId, tab)
      }
    : undefined

  const activeNotifications = notifications.filter((n) => !n.dismissed)
  const historicalNotifications = notifications
    .filter((n) => n.dismissed)
    .slice(0, 20) // Show last 20 dismissed notifications

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={t('bellAria', { unread: unreadCount > 0 ? t('bellUnread', { count: unreadCount }) : '' })}
        >
          <Bell className="size-4" />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-muted-foreground/80 text-background text-xs font-medium">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </Button>
      </SheetTrigger>

      <SheetContent side="right" className="w-full sm:w-96 overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{t('title')}</SheetTitle>
        </SheetHeader>

        <div className="mt-4 px-2 space-y-4">
          {activeNotifications.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  {t('activeHeading')}
                  <span className="inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full bg-primary/10 text-primary text-xs font-bold">
                    {activeNotifications.length}
                  </span>
                </h3>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={dismissAllNotifications}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label={t('dismissAll')}
                >
                  {t('dismissAll')}
                </Button>
              </div>
              <div className="space-y-2">
                {activeNotifications.map((notification) => (
                  <NotificationCard
                    key={notification.id}
                    notification={notification}
                    onDismiss={dismissNotification}
                    onClickIncident={handleClickIncident}
                  />
                ))}
              </div>
            </div>
          )}

          {activeNotifications.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <div className="inline-flex items-center justify-center h-16 w-16 rounded-full bg-muted mb-4">
                <Bell className="h-8 w-8 opacity-40" />
              </div>
              <p className="text-sm font-medium">{t('emptyTitle')}</p>
              <p className="text-xs mt-1">{t('emptySubtitle')}</p>
            </div>
          )}

          {historicalNotifications.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground mb-2">{t('historyHeading')}</h3>
              <div className="space-y-2">
                {historicalNotifications.map((notification) => (
                  <NotificationCard
                    key={notification.id}
                    notification={notification}
                    onClickIncident={handleClickIncident}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
