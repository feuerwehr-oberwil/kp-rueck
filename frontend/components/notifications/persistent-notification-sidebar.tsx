'use client'

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Bell, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useNotifications } from '@/lib/contexts/notification-context'
import { useAuth } from '@/lib/contexts/auth-context'
import { useIsMobile } from '@/components/ui/use-mobile'
import { NotificationCard } from '@/components/notifications/notification-card'
import { FieldRequestInbox } from '@/components/notifications/field-request-inbox'
import { useOpenFieldRequests } from '@/lib/hooks/use-field-requests'
import { requestIncidentHighlight } from '@/lib/notification-highlight'
import type { OperationDetailTab } from '@/lib/hooks/use-operation-detail-shortcuts'
import { SlideRail } from '@/components/ui/slide-rail'
import { useResizableWidth } from '@/lib/hooks/use-resizable-width'

const WIDTH_VAR = '--notification-sidebar-width'
const publishWidth = (width: number) => document.documentElement.style.setProperty(WIDTH_VAR, `${width}px`)

/**
 * The Benachrichtigungen rail on the right of every desktop page (app-shell.tsx): a SlideRail
 * that pushes the page, its width the operator's. Phone: nothing (the bell opens a sheet).
 */
export function PersistentNotificationSidebar() {
  const t = useTranslations('notifications.sidebar')
  const tPanels = useTranslations('panels')
  const { notifications, isSidebarOpen, closeSidebar, dismissNotification, dismissAllNotifications, canNavigateToIncident } = useNotifications()
  const { isAuthenticated } = useAuth()
  const isMobile = useIsMobile()
  const pathname = usePathname()
  const router = useRouter()
  const openRequests = useOpenFieldRequests()

  // On mobile, don't render (Sheet handles it via NotificationBellTrigger).
  // Never render when logged out — isSidebarOpen is persisted in localStorage,
  // so a session that opened it and then logged out would otherwise show an
  // empty sidebar shell over the login screen.
  const visible = !isMobile && isSidebarOpen && isAuthenticated
  // 320 = the w-80 it always had. The live width also goes to the root var on every drag step.
  const resize = useResizableWidth({
    storageKey: 'kp-notificationSidebarWidth',
    defaultWidth: 320,
    min: 280,
    max: 520,
    side: 'left',
    onLiveWidth: publishWidth,
  })

  // Publish the sidebar's width as a root CSS var while open – the LIVE width (the drag
  // writes it too, above). Fixed-position layers (the footer sheets, the Alarmeingang) live
  // outside the flex row that makes room for this panel, so they read the var to inset
  // their right edge instead of sliding underneath it.
  useEffect(() => {
    if (!visible) return
    publishWidth(resize.width)
    return () => {
      document.documentElement.style.removeProperty(WIDTH_VAR)
    }
  }, [visible, resize.width])

  // On the phone the rail does not exist at all (not even closed): the bell opens a sheet.
  if (isMobile || !isAuthenticated) return null

  // A bell entry whose field request is still open is shown AS that request
  // (R13), in the section above — one Meldung, one row.
  const activeNotifications = notifications.filter((n) => !n.dismissed && !openRequests.representedIds.has(n.id))
  const owedCount = activeNotifications.length + openRequests.items.length
  const historicalNotifications = notifications
    .filter((n) => n.dismissed)
    .slice(0, 20) // Show last 20 dismissed notifications

  // Only the board registers a navigate handler. On every other page the rows
  // used to look clickable and do nothing — hand the card `undefined` there so
  // it renders as plain text instead.
  //
  // Clicking a row points at the card — scroll into view plus the brief accent
  // ring — AND opens its detail on the tab the notification is about (§18.27):
  // «Meldung vom Feld» is a sentence somebody wants read, and a ringed card left
  // the operator to open the detail and find the right tab themselves. On the
  // desktop the detail is the side panel, so the card it points at stays
  // visible; the modal-over-the-board problem (§19.1) was the small-screen one.
  // This sidebar stays open either way, and pointing is not resolving: the row
  // is not dismissed by the click, the ✕ still does that.
  // Away from the board there is no listener for the highlight event, so the
  // click navigates there instead — the board reads `?highlight` + `detail=1`
  // on arrival and performs the same scroll-ring-open.
  const handleClickIncident = canNavigateToIncident
    ? (incidentId: string, tab?: OperationDetailTab) => {
        if (pathname === '/') {
          requestIncidentHighlight(incidentId, { tab, allowModal: true })
        } else {
          router.push(
            `/?highlight=${encodeURIComponent(incidentId)}&detail=1${tab ? `&tab=${tab}` : ''}`,
          )
        }
      }
    : undefined

  return (
    <SlideRail
      open={visible}
      dock="right"
      resize={resize}
      gripLabel={tPanels('resize.notifications')}
      gripHint={tPanels('resizeHint')}
    >
    <aside className="flex h-full w-full flex-col border-l border-border bg-card">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-2 min-h-14 border-b border-border/50 bg-card/95 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <Bell className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-base font-semibold">{t('title')}</h2>
          {owedCount > 0 && (
            <span className="inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full bg-muted text-muted-foreground text-xs font-medium">
              {owedCount}
            </span>
          )}
        </div>
        <Button variant="ghost" size="icon" onClick={closeSidebar} className="h-8 w-8" title={t('closePanel')}>
          <X className="size-4" />
        </Button>
      </header>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* The field's open requests — they stay until handled (R13). */}
        <FieldRequestInbox
          items={openRequests.items}
          onOpenIncident={handleClickIncident ? (incidentId) => handleClickIncident(incidentId, 'rapport') : undefined}
        />

        {/* Active notifications section */}
        {activeNotifications.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                {t('activeHeading')}
                <span className="inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full bg-foreground/10 text-foreground text-xs font-bold">
                  {activeNotifications.length}
                </span>
              </h3>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => void dismissAllNotifications(openRequests.representedIds)}
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
                  onClickIncident={handleClickIncident}
                  variant="compact"
                  dismissOnClick={false}
                />
              ))}
            </div>
          </div>
        )}

        {/* Empty state */}
        {owedCount === 0 && (
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
                <NotificationCard
                  key={notification.id}
                  notification={notification}
                  onClickIncident={handleClickIncident}
                  variant="compact"
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </aside>
    </SlideRail>
  )
}
