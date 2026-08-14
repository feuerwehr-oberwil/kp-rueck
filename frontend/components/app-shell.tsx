'use client'

import { usePathname } from 'next/navigation'
import { CommandPalette } from '@/components/ui/command-palette'
import { DemoBanner } from '@/components/demo-banner'
import { DeploymentBanner } from '@/components/deployment-banner'
import { StaleDataBanner } from '@/components/stale-data-banner'
import { IncidentTruncationBanner } from '@/components/incident-truncation-banner'
import { PersistentNotificationSidebar } from '@/components/notifications/persistent-notification-sidebar'

interface AppShellProps {
  children: React.ReactNode
}

// Public phone-facing form routes rendered in normal document flow (native body
// scroll). Inside the fixed h-dvh/overflow-hidden shell, iOS Safari can freeze
// the layout viewport when the tab is entered from another app (QR scan via
// Camera) or after the keyboard closes: the bottom of the screen stays
// unpainted (black) and taps land offset until the user reloads. Native body
// scroll is the mode Safari handles correctly, so these routes opt out.
const DOCUMENT_FLOW_ROUTES = ['/reko', '/reko-dashboard', '/alarm', '/check-in', '/feld']

/**
 * AppShell wraps the main content. The notification sidebar renders as a flex
 * sibling of <main>, below the banners, so it makes room for itself (no overlay
 * margin hack) and never slides under the demo/stale banners. On mobile the
 * sidebar renders nothing (a Sheet overlay is used instead). Also includes the
 * global CommandPalette for keyboard shortcuts.
 */
export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname()

  const isDocumentFlow = DOCUMENT_FLOW_ROUTES.some(
    route => pathname === route || pathname.startsWith(`${route}/`)
  )

  if (isDocumentFlow) {
    return (
      <>
        <DeploymentBanner />
        <DemoBanner />
        <StaleDataBanner />
        <IncidentTruncationBanner />
        {children}
        <CommandPalette />
      </>
    )
  }

  return (
    <div className="flex flex-col h-dvh overflow-hidden">
      <DemoBanner />
      <StaleDataBanner />
      <IncidentTruncationBanner />
      <div className="flex flex-1 min-h-0">
        <main className="flex-1 min-h-0 overflow-auto">
          {children}
        </main>
        <PersistentNotificationSidebar />
      </div>
      <CommandPalette />
    </div>
  )
}
