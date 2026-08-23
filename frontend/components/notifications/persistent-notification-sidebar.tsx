'use client'

import { useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Bell, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useNotifications } from '@/lib/contexts/notification-context'
import { useAuth } from '@/lib/contexts/auth-context'
import { useIsMobile } from '@/components/ui/use-mobile'
import { NotificationCard } from '@/components/notifications/notification-card'
import { requestIncidentHighlight } from '@/lib/notification-highlight'
import type { OperationDetailTab } from '@/lib/hooks/use-operation-detail-shortcuts'
import { cn } from '@/lib/utils'

export function PersistentNotificationSidebar() {
  const t = useTranslations('notifications.sidebar')
  const { notifications, isSidebarOpen, closeSidebar, dismissNotification, dismissAllNotifications, canNavigateToIncident } = useNotifications()
  const { isAuthenticated } = useAuth()
  const isMobile = useIsMobile()

  // On mobile, don't render (Sheet handles it via NotificationBellTrigger).
  // Never render when logged out — isSidebarOpen is persisted in localStorage,
  // so a session that opened it and then logged out would otherwise show an
  // empty sidebar shell over the login screen.
  const visible = !isMobile && isSidebarOpen && isAuthenticated

  // Publish the sidebar's width as a root CSS var while open. Fixed-position
  // layers (the footer sheets) live outside the flex row that makes room for
  // this panel, so they read the var to inset their right edge instead of
  // sliding underneath it. Must match the `w-80` below.
  useEffect(() => {
    if (!visible) return
    document.documentElement.style.setProperty('--notification-sidebar-width', '20rem')
    return () => {
      document.documentElement.style.removeProperty('--notification-sidebar-width')
    }
  }, [visible])

  if (!visible) return null

  const activeNotifications = notifications.filter((n) => !n.dismissed)
  const historicalNotifications = notifications
    .filter((n) => n.dismissed)
    .slice(0, 20) // Show last 20 dismissed notifications

  // Only the board registers a navigate handler. On every other page the rows
  // used to look clickable and do nothing — hand the card `undefined` there so
  // it renders as plain text instead.
  //
  // Clicking a row points at the card — scroll into view plus the brief accent
  // ring — AND opens its detail on the tab the notification is about (§18.27):
  // «Meldung vom Feld» is a sentence somebody wants read, and a ringed card left
  // the operator to open the detail and find the right tab themselves. On the
  // desktop the detail is the side panel, so the card it points at stays
  // visible; the modal-over-the-board problem (§19.1) was the small-screen one.
  // This sidebar stays open either way, and pointing is not resolving: the row
  // is not dismissed by the click, the ✕ still does that.
  const handleClickIncident = canNavigateToIncident
    ? (incidentId: string, tab?: OperationDetailTab) => requestIncidentHighlight(incidentId, { tab, allowModal: true })
    : undefined

  return (
    <aside
      className={cn(
        'w-80 shrink-0 h-full',
        'bg-card border-l border-border',
        'flex flex-col',
        'animate-in slide-in-from-right duration-300'
      )}
    >
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-2 min-h-14 border-b border-border/50 bg-card/95 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <Bell className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-base font-semibold">{t('title')}</h2>
          {activeNotifications.length > 0 && (
            <span className="inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full bg-muted text-muted-foreground text-xs font-medium">
              {activeNotifications.length}
            </span>
          )}
        </div>
        <Button variant="ghost" size="icon" onClick={closeSidebar} className="h-8 w-8" title={t('closePanel')}>
          <X className="size-4" />
        </Button>
      </header>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Active notifications section */}
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
                  variant="compact"
                  dismissOnClick={false}
                />
              ))}
            </div>
          </div>
        )}

        {/* Empty state */}
        {activeNotifications.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <div className="inline-flex items-center justify-center h-16 w-16 rounded-full bg-muted mb-4">
              <Bell className="h-8 w-8 opacity-40" />
            </div>
            <p className="text-sm font-medium">{t('emptyTitle')}</p>
            <p className="text-xs mt-1">{t('emptySubtitle')}</p>
          </div>
        )}

        {/* Historical notifications */}
        {historicalNotifications.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-muted-foreground mb-2">{t('historyHeading')}</h3>
            <div className="space-y-2">
              {historicalNotifications.map((notification) => (
                <NotificationCard
                  key={notification.id}
                  notification={notification}
                  onClickIncident={handleClickIncident}
                  variant="compact"
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </aside>
  )
}
