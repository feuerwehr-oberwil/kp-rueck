'use client'

import { usePathname } from 'next/navigation'
import { useAuth } from '@/lib/contexts/auth-context'
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
const DOCUMENT_FLOW_ROUTES = ['/reko', '/alarm', '/check-in', '/feld']

/**
 * AppShell wraps the main content. The notification sidebar renders as a flex
 * sibling of <main>, below the banners, so it makes room for itself (no overlay
 * margin hack) and never slides under the demo/stale banners. On mobile the
 * sidebar renders nothing (a Sheet overlay is used instead). Also includes the
 * global CommandPalette for keyboard shortcuts.
 *
 * The palette is mounted ONLY for a signed-in user. It used to be mounted for
 * everybody, so ⌘K opened a list of the board's actions and Auftrag names on the
 * login screen and on the public phone forms (`/alarm`, `/check-in`) — a keyboard
 * shortcut is not an access control, and the entries it lists are not public.
 * Gating the mount rather than the handler also takes the `keydown` listener and
 * the `kp:open-command-palette` window listener away with it.
 */
export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname()
  const { isAuthenticated } = useAuth()

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
        {isAuthenticated && <CommandPalette />}
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
      {isAuthenticated && <CommandPalette />}
    </div>
  )
}
