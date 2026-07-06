'use client'

import { usePathname } from 'next/navigation'
import { useNotifications } from '@/lib/contexts/notification-context'
import { useIsMobile } from '@/components/ui/use-mobile'
import { CommandPalette } from '@/components/ui/command-palette'
import { DemoBanner } from '@/components/demo-banner'
import { StaleDataBanner } from '@/components/stale-data-banner'
import { cn } from '@/lib/utils'

interface AppShellProps {
  children: React.ReactNode
}

// Public phone-facing form routes rendered in normal document flow (native body
// scroll). Inside the fixed h-dvh/overflow-hidden shell, iOS Safari can freeze
// the layout viewport when the tab is entered from another app (QR scan via
// Camera) or after the keyboard closes: the bottom of the screen stays
// unpainted (black) and taps land offset until the user reloads. Native body
// scroll is the mode Safari handles correctly, so these routes opt out.
const DOCUMENT_FLOW_ROUTES = ['/reko', '/reko-dashboard', '/alarm', '/check-in']

/**
 * AppShell wraps the main content and adjusts layout when the notification sidebar is open.
 * On desktop, it adds right margin to make room for the fixed sidebar.
 * On mobile, no adjustment is needed (Sheet overlay is used instead).
 * Also includes the global CommandPalette for keyboard shortcuts.
 */
export function AppShell({ children }: AppShellProps) {
  const { isSidebarOpen } = useNotifications()
  const isMobile = useIsMobile()
  const pathname = usePathname()

  const isDocumentFlow = DOCUMENT_FLOW_ROUTES.some(
    route => pathname === route || pathname.startsWith(`${route}/`)
  )

  if (isDocumentFlow) {
    return (
      <>
        <DemoBanner />
        <StaleDataBanner />
        {children}
        <CommandPalette />
      </>
    )
  }

  // On mobile, don't adjust layout (Sheet overlay handles it)
  // On desktop, add margin-right when sidebar is open
  return (
    <div className="flex flex-col h-dvh overflow-hidden">
      <DemoBanner />
      <StaleDataBanner />
      <main
        className={cn(
          'flex-1 min-h-0 overflow-auto transition-[margin] duration-300 ease-in-out',
          !isMobile && isSidebarOpen && 'mr-80' // 320px = w-80
        )}
      >
        {children}
      </main>
      <CommandPalette />
    </div>
  )
}
