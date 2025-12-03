'use client'

import { useNotifications } from '@/lib/contexts/notification-context'
import { useIsMobile } from '@/components/ui/use-mobile'
import { cn } from '@/lib/utils'

interface AppShellProps {
  children: React.ReactNode
}

/**
 * AppShell wraps the main content and adjusts layout when the notification sidebar is open.
 * On desktop, it adds right margin to make room for the fixed sidebar.
 * On mobile, no adjustment is needed (Sheet overlay is used instead).
 */
export function AppShell({ children }: AppShellProps) {
  const { isSidebarOpen } = useNotifications()
  const isMobile = useIsMobile()

  // On mobile, don't adjust layout (Sheet overlay handles it)
  // On desktop, add margin-right when sidebar is open
  return (
    <div
      className={cn(
        'min-h-screen transition-[margin] duration-300 ease-in-out',
        !isMobile && isSidebarOpen && 'mr-80' // 320px = w-80
      )}
    >
      {children}
    </div>
  )
}
