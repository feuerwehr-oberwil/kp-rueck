'use client'

import { Bell } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useNotifications } from '@/lib/contexts/notification-context'
import { useIsMobile } from '@/components/ui/use-mobile'
import { NotificationSidebar } from './notification-sidebar'
import { cn } from '@/lib/utils'

export function NotificationBellTrigger() {
  const { unreadCount, toggleSidebar, isSidebarOpen } = useNotifications()
  const isMobile = useIsMobile()

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
        'relative rounded-lg h-9 w-9 md:h-10 md:w-10',
        isSidebarOpen && 'bg-accent'
      )}
      aria-label={`Benachrichtigungen ${unreadCount > 0 ? `(${unreadCount} ungelesene)` : ''}`}
      aria-pressed={isSidebarOpen}
      title="Benachrichtigungen (B)"
    >
      <Bell className="h-4 w-4 md:h-5 md:w-5" />
      {unreadCount > 0 && (
        <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground text-xs font-bold shadow-sm animate-in fade-in zoom-in duration-200">
          {unreadCount > 9 ? '9+' : unreadCount}
        </span>
      )}
    </Button>
  )
}
