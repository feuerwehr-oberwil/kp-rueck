'use client'

import { useTranslations } from 'next-intl'
import { Bell, X, AlertTriangle, Info, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useNotifications } from '@/lib/contexts/notification-context'
import { useAuth } from '@/lib/contexts/auth-context'
import { useIsMobile } from '@/components/ui/use-mobile'
import type { Notification, NotificationSeverity } from '@/lib/types/notification'
import { formatNotificationTime } from '@/lib/notification-time'
import { cn } from '@/lib/utils'

interface NotificationCardProps {
  notification: Notification
  onDismiss?: (id: string) => void
  onClickIncident?: (incidentId: string) => void
}

function NotificationCard({ notification, onDismiss, onClickIncident }: NotificationCardProps) {
  const t = useTranslations('notifications.card')
  const tSidebar = useTranslations('notifications.sidebar')
  const getSeverityStyles = (severity: NotificationSeverity) => {
    switch (severity) {
      case 'critical':
        return {
          border: 'border-l-2 border-l-destructive/40',
          bg: 'bg-destructive/5',
          icon: <AlertCircle className="h-4 w-4 text-destructive/50" />,
          badge: 'bg-destructive/10 text-destructive/80',
        }
      case 'warning':
        return {
          border: 'border-l-2 border-l-warning/50',
          bg: 'bg-warning/10',
          icon: <AlertTriangle className="h-4 w-4 text-warning-foreground" />,
          badge: 'bg-warning/10 text-warning-foreground',
        }
      case 'info':
        return {
          border: 'border-l-2 border-l-muted-foreground/40',
          bg: 'bg-muted/30',
          icon: <Info className="h-4 w-4 text-muted-foreground/70" />,
          badge: 'bg-muted text-muted-foreground',
        }
    }
  }

  const styles = getSeverityStyles(notification.severity)

  const formatTime = (date: Date) => formatNotificationTime(date, t)

  const getSeverityLabel = (severity: NotificationSeverity) => {
    switch (severity) {
      case 'critical':
        return t('severityCritical')
      case 'warning':
        return t('severityWarning')
      case 'info':
        return t('severityInfo')
    }
  }

  const isClickable = !!notification.incident_id && !!onClickIncident

  return (
    <div
      className={cn(
        'p-3 rounded-lg border transition-all duration-200',
        styles.border,
        styles.bg,
        notification.dismissed && 'opacity-50',
        isClickable && 'cursor-pointer hover:ring-1 hover:ring-ring/30'
      )}
      role="article"
      aria-label={`${getSeverityLabel(notification.severity)} notification`}
      onClick={() => {
        if (isClickable) {
          if (!notification.dismissed && onDismiss) {
            onDismiss(notification.id)
          }
          onClickIncident(notification.incident_id!)
        }
      }}
    >
      <div className="flex items-start gap-2.5">
        <div className="flex-shrink-0 mt-0.5">{styles.icon}</div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={cn('text-xs font-semibold px-2 py-0.5 rounded-md', styles.badge)}>
              {getSeverityLabel(notification.severity)}
            </span>
            <span className="text-xs text-muted-foreground font-medium">
              {formatTime(notification.created_at)}
            </span>
          </div>

          <p className="text-sm leading-snug text-foreground break-words">{notification.message}</p>
        </div>

        {!notification.dismissed && onDismiss && (
          <Button
            variant="ghost"
            size="icon-xs"
            className="flex-shrink-0 hover:bg-background/80"
            onClick={() => onDismiss(notification.id)}
            aria-label={tSidebar('dismissAria')}
          >
            <X className="size-3.5" />
          </Button>
        )}
      </div>
    </div>
  )
}

export function PersistentNotificationSidebar() {
  const t = useTranslations('notifications.sidebar')
  const { notifications, isSidebarOpen, closeSidebar, dismissNotification, dismissAllNotifications, navigateToIncident } = useNotifications()
  const { isAuthenticated } = useAuth()
  const isMobile = useIsMobile()

  // On mobile, don't render (Sheet handles it via NotificationBellTrigger).
  // Never render when logged out — isSidebarOpen is persisted in localStorage,
  // so a session that opened it and then logged out would otherwise show an
  // empty sidebar shell over the login screen.
  if (isMobile || !isSidebarOpen || !isAuthenticated) return null

  const activeNotifications = notifications.filter((n) => !n.dismissed)
  const historicalNotifications = notifications
    .filter((n) => n.dismissed)
    .slice(0, 20) // Show last 20 dismissed notifications

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
                  onClickIncident={navigateToIncident}
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
                <NotificationCard key={notification.id} notification={notification} onClickIncident={navigateToIncident} />
              ))}
            </div>
          </div>
        )}
      </div>
    </aside>
  )
}
