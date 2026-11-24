'use client'

import { Bell } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { ShortcutTooltip } from '@/components/ui/shortcut-tooltip'
import { useNotifications } from '@/lib/contexts/notification-context'
import { useBellCount, useOpenFieldRequests } from '@/lib/hooks/use-field-requests'
import { useAuth } from '@/lib/contexts/auth-context'
import { cn } from '@/lib/utils'

export function NotificationBellTrigger() {
  const t = useTranslations('notifications.sidebar')
  const { notifications, toggleSidebar, isSidebarOpen } = useNotifications()
  // Open field requests count until handled, not until their bell is closed (R13).
  const { count: unreadCount } = useBellCount(notifications, useOpenFieldRequests())
  const { isAuthenticated } = useAuth()

  // Notifications are an authenticated-only feature — no bell when logged out
  if (!isAuthenticated) return null

  // The desk's toggle for the persistent sidebar. A phone has no header bell: its bottom nav's
  // «Meldungen» tile opens the list as a sheet (PhoneNotificationSheet).
  return (
    <ShortcutTooltip label={t('bellTitle')} keys={['B']} side="bottom">
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleSidebar}
      className={cn(
        'relative h-9 w-9 md:h-10 md:w-10',
        isSidebarOpen && 'bg-muted'
      )}
      aria-label={t('bellAria', { unread: unreadCount > 0 ? t('bellUnread', { count: unreadCount }) : '' })}
      aria-pressed={isSidebarOpen}
    >
      <Bell className="size-4 md:size-5" />
      {unreadCount > 0 && (
        <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-muted-foreground/80 text-background text-xs font-medium">
          {unreadCount > 9 ? '9+' : unreadCount}
        </span>
      )}
    </Button>
    </ShortcutTooltip>
  )
}
