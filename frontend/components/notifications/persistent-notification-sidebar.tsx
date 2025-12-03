'use client'

import { Bell, X, AlertTriangle, Info, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useNotifications } from '@/lib/contexts/notification-context'
import { useIsMobile } from '@/components/ui/use-mobile'
import type { Notification, NotificationSeverity } from '@/lib/types/notification'
import { cn } from '@/lib/utils'

interface NotificationCardProps {
  notification: Notification
  onDismiss?: (id: string) => void
}

function NotificationCard({ notification, onDismiss }: NotificationCardProps) {
  const getSeverityStyles = (severity: NotificationSeverity) => {
    switch (severity) {
      case 'critical':
        return {
          border: 'border-l-4 border-l-destructive',
          bg: 'bg-destructive/20 dark:bg-destructive/20',
          icon: <AlertCircle className="h-5 w-5 text-destructive" />,
          badge: 'bg-destructive/30 text-destructive-foreground dark:bg-destructive/40 dark:text-destructive-foreground',
        }
      case 'warning':
        return {
          border: 'border-l-4 border-l-orange-500',
          bg: 'bg-orange-950/30 dark:bg-orange-950/30',
          icon: <AlertTriangle className="h-5 w-5 text-orange-500" />,
          badge: 'bg-orange-900/50 text-orange-200 dark:bg-orange-900/60 dark:text-orange-200',
        }
      case 'info':
        return {
          border: 'border-l-4 border-l-primary',
          bg: 'bg-primary/20 dark:bg-primary/20',
          icon: <Info className="h-5 w-5 text-primary" />,
          badge: 'bg-primary/30 text-primary-foreground dark:bg-primary/40 dark:text-primary-foreground',
        }
    }
  }

  const styles = getSeverityStyles(notification.severity)

  const formatTime = (date: Date) => {
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    const minutes = Math.floor(diff / 60000)
    const hours = Math.floor(minutes / 60)
    const days = Math.floor(hours / 24)

    if (days > 0) return `vor ${days}d`
    if (hours > 0) return `vor ${hours}h`
    if (minutes > 0) return `vor ${minutes}m`
    return 'gerade eben'
  }

  const getSeverityLabel = (severity: NotificationSeverity) => {
    switch (severity) {
      case 'critical':
        return 'Kritisch'
      case 'warning':
        return 'Warnung'
      case 'info':
        return 'Info'
    }
  }

  return (
    <div
      className={cn(
        'p-3 rounded-lg border transition-all duration-200',
        styles.border,
        styles.bg,
        notification.dismissed ? 'opacity-60' : 'shadow-sm hover:shadow-md'
      )}
      role="article"
      aria-label={`${getSeverityLabel(notification.severity)} notification`}
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
            size="icon"
            className="flex-shrink-0 h-7 w-7 hover:bg-background/80"
            onClick={() => onDismiss(notification.id)}
            aria-label="Benachrichtigung schliessen"
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  )
}

export function PersistentNotificationSidebar() {
  const { notifications, isSidebarOpen, closeSidebar, dismissNotification, dismissAllNotifications } = useNotifications()
  const isMobile = useIsMobile()

  // On mobile, don't render (Sheet handles it via NotificationBellTrigger)
  if (isMobile || !isSidebarOpen) return null

  const activeNotifications = notifications.filter((n) => !n.dismissed)
  const historicalNotifications = notifications
    .filter((n) => n.dismissed)
    .slice(0, 20) // Show last 20 dismissed notifications

  return (
    <aside
      className={cn(
        'fixed top-0 right-0 bottom-0 w-80',
        'bg-card border-l border-border',
        'flex flex-col',
        'z-40',
        'animate-in slide-in-from-right duration-300'
      )}
    >
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-border/50 bg-card/95 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <Bell className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-base font-semibold">Benachrichtigungen</h2>
          {activeNotifications.length > 0 && (
            <span className="inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full bg-destructive text-destructive-foreground text-xs font-bold">
              {activeNotifications.length}
            </span>
          )}
        </div>
        <Button variant="ghost" size="icon" onClick={closeSidebar} className="h-8 w-8" title="Panel schliessen (B)">
          <X className="h-4 w-4" />
        </Button>
      </header>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Active notifications section */}
        {activeNotifications.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                Aktiv
                <span className="inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full bg-primary/10 text-primary text-xs font-bold">
                  {activeNotifications.length}
                </span>
              </h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={dismissAllNotifications}
                className="h-7 text-xs text-muted-foreground hover:text-foreground"
                aria-label="Alle schliessen"
              >
                Alle schliessen
              </Button>
            </div>
            <div className="space-y-2">
              {activeNotifications.map((notification) => (
                <NotificationCard
                  key={notification.id}
                  notification={notification}
                  onDismiss={dismissNotification}
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
            <p className="text-sm font-medium">Keine aktiven Benachrichtigungen</p>
            <p className="text-xs mt-1">Alles ist in Ordnung</p>
          </div>
        )}

        {/* Historical notifications */}
        {historicalNotifications.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-muted-foreground mb-2">Verlauf</h3>
            <div className="space-y-2">
              {historicalNotifications.map((notification) => (
                <NotificationCard key={notification.id} notification={notification} />
              ))}
            </div>
          </div>
        )}
      </div>
    </aside>
  )
}
