'use client'

import { usePathname } from 'next/navigation'
import { useAuth } from '@/lib/contexts/auth-context'
import { CommandPalette } from '@/components/ui/command-palette'
import { GlobalShortcuts } from '@/lib/hooks/use-global-navigation'
import { UpdateNotice } from '@/lib/hooks/use-update-notice'
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
 * global CommandPalette for keyboard shortcuts, and — once, for every signed-in
 * page — the global G-chords (`GlobalShortcuts`, which knows the pages that
 * handle them themselves or should not have them).
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
      {isAuthenticated && <GlobalShortcuts />}
      <UpdateNotice />
      </>
    )
  }

  // `fixed inset-0` + an opaque background, not `h-dvh` in flow: the box looks the same, but it
  // is what keeps iOS 26's scroll-edge blur off the top of the home-screen app. WebKit only
  // skips that progressive blur (~40pt under the status bar) when the element at the top edge
  // sits in a position:fixed/sticky container spanning the viewport, and takes that
  // container's (or the first opaque box's on the way) colour instead. A page in flow had none,
  // so «Einstellungen» and every header under the status bar came out soft in the installed
  // app (a Safari tab draws no such effect). KP Front is immune for the same reason: its body
  // and `.app` are `position: fixed; inset: 0` with the app background. See
  // _fix3/feld/edge-effect.md in the fix-round notes and app-shell.test.tsx.
  return (
    <div data-slot="app-shell" className="fixed inset-0 flex flex-col overflow-hidden bg-background">
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
      {isAuthenticated && <GlobalShortcuts />}
      <UpdateNotice />
    </div>
  )
}
