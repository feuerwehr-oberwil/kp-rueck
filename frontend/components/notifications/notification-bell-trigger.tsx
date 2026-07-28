'use client'

import { Bell } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useNotifications } from '@/lib/contexts/notification-context'
import { useAuth } from '@/lib/contexts/auth-context'
import { useIsMobile } from '@/components/ui/use-mobile'
import { NotificationSidebar } from './notification-sidebar'
import { cn } from '@/lib/utils'

export function NotificationBellTrigger() {
  const { unreadCount, toggleSidebar, isSidebarOpen } = useNotifications()
  const { isAuthenticated } = useAuth()
  const isMobile = useIsMobile()

  // Notifications are an authenticated-only feature — no bell when logged out
  if (!isAuthenticated) return null

  // On mobile, use the existing Sheet-based NotificationSidebar
  if (isMobile) {
    return <NotificationSidebar />
  }

  // On desktop, render a toggle button for the persistent sidebar
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleSidebar}
      className={cn(
        'relative h-9 w-9 md:h-10 md:w-10',
        isSidebarOpen && 'bg-muted'
      )}
      aria-label={`Benachrichtigungen ${unreadCount > 0 ? `(${unreadCount} ungelesene)` : ''}`}
      aria-pressed={isSidebarOpen}
      title="Benachrichtigungen (B)"
    >
      <Bell className="size-4 md:size-5" />
      {unreadCount > 0 && (
        <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-muted-foreground/80 text-background text-xs font-medium">
          {unreadCount > 9 ? '9+' : unreadCount}
        </span>
      )}
    </Button>
  )
}
