'use client'

/**
 * Mobile Bottom Navigation Component
 * Bottom tab bar for mobile devices with iOS/Android safe area support
 * Shows primary navigation tabs + "More" sheet for secondary functions.
 *
 * The tab pill (owner's pick 4A, 14.11.2026): 8px of air above and below icon + label, and it
 * never grows – no scale on the current tab, no bounce on a tap. The tap answers with the app's
 * press wash (globals.css), like every other control.
 *
 * The phone board is read-only (owner, 14.11.2026): «Mehr» switches the Ereignis (navigation)
 * but offers no «Neues Ereignis» – an Ereignis is opened on the desktop.
 *
 * Every «Mehr» entry is the same ghost row: a page link is the Button itself (`asChild`), not a
 * 21px <a> wrapped around a 44px <button> (phone sweep 14.11.2026).
 *
 * «Mehr» is the same menu on every page (owner, 16.11.2026): the Schnellzugriff sheets are the
 * nav's own (`PhoneQuickSheets`), not handed in by the board – the Lagekarte used to offer only
 * Kennzahlen there.
 */

import { BookOpenText, ChartColumn, Columns3, Map as MapIcon, Calendar, MoreHorizontal, HelpCircle, Settings, Inbox, QrCode, Sparkles, LogOut, Users, Truck, Printer, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { useRef, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import { Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { useAuth } from '@/lib/contexts/auth-context'
import { useEvent } from '@/lib/contexts/event-context'
import { AccountBlock } from '@/components/auth/account-block'
import { VersionLabel } from '@/components/version-label'
import { useLogout } from '@/lib/hooks/use-logout'
import { useNavReserve } from '@/components/viewport-insets'
import { openAlarmInbox } from '@/components/alarm-inbox/alarm-inbox-store'
import { AlarmInboxMenuCount } from '@/components/alarm-inbox/alarm-inbox-button'
import { toggleFigures } from '@/components/figures-dialog'
import { PhoneQuickSheets, type PhoneQuickSheet } from '@/components/mobile/phone-quick-sheets'
import { useIsMobile } from '@/components/ui/use-mobile'

interface MobileBottomNavigationProps {
  currentPage: 'kanban' | 'map' | 'events' | 'settings' | 'help' | string
  hasSelectedEvent?: boolean
}

export function MobileBottomNavigation({
  currentPage,
  hasSelectedEvent = true,
}: MobileBottomNavigationProps) {
  const t = useTranslations('nav.mobileBottomNav')
  const { isEditor } = useAuth()
  const tAccount = useTranslations('nav.account')
  const { requestLogout, logoutDialog } = useLogout()
  const { selectedEvent, events, setSelectedEvent } = useEvent()
  const [sheetOpen, setSheetOpen] = useState(false)
  // The Schnellzugriff sheet open over the page (`PhoneQuickSheets`, phone only).
  const [quickSheet, setQuickSheet] = useState<PhoneQuickSheet | null>(null)
  const isMobile = useIsMobile()
  // Publishes this bar's measured height as `--nav-reserve` — the one number every phone list
  // pads its end by (`pb-nav-reserve`) and the toast lane clears.
  const navRef = useRef<HTMLElement>(null)
  useNavReserve(navRef)

  // Other active events the operator can quick-switch to (mobile has no top bar,
  // so event switching lives here in the bottom nav).
  const otherEvents = events
    .filter((e) => !e.archived_at && e.id !== selectedEvent?.id)
    .sort((a, b) => b.last_activity_at.getTime() - a.last_activity_at.getTime())
    .slice(0, 5)

  const tabs = [
    {
      id: 'kanban',
      label: t('incidents'),
      // Same glyph as the desktop nav's board entry — see page-navigation.tsx.
      icon: Columns3,
      href: '/',
      disabled: !hasSelectedEvent,
    },
    {
      id: 'map',
      label: t('map'),
      icon: MapIcon,
      href: '/map',
      disabled: !hasSelectedEvent,
    },
  ]

  // Secondary navigation items for "More" sheet (event switching is handled in
  // its own section below since it needs the live event list).
  const secondaryItems = [
    { id: 'settings', label: t('settings'), icon: Settings, href: '/settings', category: 'Verwaltung' },
    { id: 'help', label: t('helpDocs'), icon: HelpCircle, href: '/help', category: 'Support' },
  ]

  // «Schnellzugriff» needs an Ereignis: every entry is about the open one. The editing sheets
  // (links, roster, vehicles, print) are an editor's; the Tagebuch and Kennzahlen everyone's.
  const quickActions: { id: string; label: string; icon: LucideIcon; open: () => void }[] = selectedEvent
    ? [
        ...(isEditor ? [{ id: 'links', label: t('linksAndQr'), icon: QrCode, open: () => setQuickSheet('links') }] : []),
        { id: 'journal', label: t('journal'), icon: BookOpenText, open: () => setQuickSheet('journal') },
        { id: 'figures', label: t('figures'), icon: ChartColumn, open: toggleFigures },
        ...(isEditor
          ? [
              { id: 'personnel', label: t('personnel'), icon: Users, open: () => setQuickSheet('personnel') },
              { id: 'vehicles', label: t('vehicles'), icon: Truck, open: () => setQuickSheet('vehicles') },
              { id: 'print', label: t('print'), icon: Printer, open: () => setQuickSheet('print') },
            ]
          : []),
      ]
    : []
  const hasQuickActions = quickActions.length > 0 || !!selectedEvent?.training_flag

  // One tab's frame: a 56px pill (8px + 20px icon + 4px + 16px label + 8px), so the current
  // tab's tint has air around its content; the bar adds 4px above and below it.
  const tabClass = "flex flex-col items-center justify-center gap-1 flex-1 min-h-[44px] py-2 rounded-lg transition-colors touch-manipulation"

  return (
    // The nav shares the overlay rung rather than sitting under it (which is where a plain
    // page element belongs): a sheet or dialog still covers it, because every one of those is
    // portalled to the end of <body> and so comes later in the DOM at the same z-index. See
    // the z-order block in app/globals.css.
    <nav
      ref={navRef}
      className="fixed bottom-0 left-0 right-0 z-overlay border-t border-border bg-card/95 backdrop-blur-sm md:hidden"
      style={{
        paddingBottom: 'env(safe-area-inset-bottom, 0px)'
      }}
    >
      <div className="flex items-center justify-around min-h-[60px] px-2 py-1">
        {tabs.map((tab) => {
          const Icon = tab.icon
          const isActive = currentPage === tab.id

          return (
            <Link
              key={tab.id}
              href={tab.href}
              className={cn(
                tabClass,
                isActive && "bg-foreground/[0.09] text-foreground",
                !isActive && "text-muted-foreground hover:text-foreground",
                tab.disabled && "opacity-40 pointer-events-none",
              )}
              aria-label={tab.label}
              aria-current={isActive ? 'page' : undefined}
            >
              <Icon className="h-5 w-5" aria-hidden="true" />
              <span className={cn("text-xs font-medium", isActive && "font-semibold")}>{tab.label}</span>
            </Link>
          )
        })}

        {/* More menu */}
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetTrigger asChild>
            <button
              className={cn(
                tabClass,
                (currentPage === 'settings' || currentPage === 'help') && "bg-foreground/[0.09] text-foreground",
                (currentPage !== 'settings' && currentPage !== 'help') && "text-muted-foreground hover:text-foreground",
              )}
              aria-label={t('moreOptions')}
            >
              <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
              <span className="text-xs font-medium">{t('more')}</span>
            </button>
          </SheetTrigger>
          <SheetContent
            side="bottom"
            // No `animate-sheet-slide-up`: it duplicated SheetContent's own
            // `slide-in-from-bottom` and, being unscoped by `data-state`, it kept
            // `animation-name` non-`none` on the *closed* sheet — which is exactly
            // what makes Radix's Presence hold the dismissed panel mounted (and
            // hit-testable) for another ~150ms. Measured; the entrance is unchanged.
            // It covers the nav, so its foot only pays the safe area (`pb-sheet-safe`).
            className="modal-h-tall overflow-y-auto px-6 pb-sheet-safe"
          >
            <SheetHeader className="mb-4 -mx-6 px-6 pb-3 border-b">
              <SheetTitle>{t('moreFunctions')}</SheetTitle>
            </SheetHeader>

            <div className="space-y-4 pb-4">
              {/* Ereignis Section — current event + quick switch (replaces the
                  top-bar event switcher, which is hidden on mobile). */}
              <div className="animate-category-fade">
                <h3 className="text-xs font-medium text-muted-foreground mb-2">
                  {t('event')}
                </h3>
                <div className="space-y-2">
                  <div className="px-3 py-2 rounded-lg bg-muted/50">
                    <p className="text-sm font-semibold truncate">
                      {selectedEvent ? selectedEvent.name : t('noEventSelected')}
                    </p>
                    {selectedEvent?.training_flag && (
                      <span className="text-xs text-orange-700 dark:text-orange-400">{t('training')}</span>
                    )}
                  </div>
                  {otherEvents.map((event) => (
                    <Button
                      key={event.id}
                      variant="ghost"
                      className="h-auto w-full justify-start gap-3 whitespace-normal py-2.5 text-left touch-manipulation hover-delight"
                      onClick={() => {
                        setSelectedEvent(event)
                        setSheetOpen(false)
                      }}
                    >
                      <ChevronRight className="size-4 text-muted-foreground" />
                      {/* Wrapped, not cut: two events can share a long prefix */}
                      <span className="min-w-0 break-words">{event.name}</span>
                    </Button>
                  ))}
                  <Button
                    asChild
                    variant={currentPage === 'events' ? 'secondary' : 'ghost'}
                    className="w-full justify-start gap-3 touch-manipulation hover-delight"
                  >
                    <Link href="/events" onClick={() => setSheetOpen(false)}>
                      <Calendar className="size-4" />
                      <span>{t('allEvents')}</span>
                    </Link>
                  </Button>
                </div>
              </div>

              <Separator />

              {/* Quick Actions Section — viewing-first: the QR/print/personnel
                  actions are editor-only, so viewers get a decluttered sheet.
                  The training link shows on any Übung: spawning training incidents
                  is the main mobile task, done with an editor account – the viewer
                  role is strictly read-only (/training refuses it). */}
              {hasQuickActions && (
              <>
              <div className="animate-category-fade">
                <h3 className="text-xs font-medium text-muted-foreground mb-2">
                  {t('quickActions')}
                </h3>
                <div className="space-y-1">
                  {/* Close «Mehr» first, then open the sheet: one layer at a time. */}
                  {quickActions.map((action, index) => {
                    const Icon = action.icon
                    return (
                      <Button
                        key={action.id}
                        variant="ghost"
                        className={cn(
                          "w-full justify-start gap-3 touch-manipulation hover-delight animate-stagger-fade-in",
                          `stagger-delay-${Math.min(index + 1, 5)}`,
                        )}
                        onClick={() => {
                          setSheetOpen(false)
                          setTimeout(action.open, 350)
                        }}
                      >
                        <Icon className="size-4" />
                        <span>{action.label}</span>
                      </Button>
                    )
                  })}

                  {/* Training Control - only for training events */}
                  {selectedEvent?.training_flag && (
                    <Button
                      asChild
                      variant="ghost"
                      className="w-full justify-start gap-3 touch-manipulation hover-delight animate-stagger-fade-in stagger-delay-2"
                    >
                      <Link href="/training" onClick={() => setSheetOpen(false)}>
                        <Sparkles className="size-4 text-orange-500" />
                        <span>{t('trainingControl')}</span>
                      </Link>
                    </Button>
                  )}
                </div>
              </div>

              <Separator />
              </>
              )}

              {/* Verwaltung Section */}
              <div className="animate-category-fade">
                <h3 className="text-xs font-medium text-muted-foreground mb-2">
                  {t('management')}
                </h3>
                <div className="space-y-2">
                  {secondaryItems.filter(item => item.category === 'Verwaltung').map((item, index) => {
                    const Icon = item.icon
                    const isActive = currentPage === item.id
                    return (
                      <Button
                        key={item.id}
                        asChild
                        variant={isActive ? "secondary" : "ghost"}
                        className={cn(
                          "w-full justify-start gap-3 touch-manipulation hover-delight",
                          `animate-stagger-fade-in stagger-delay-${Math.min(index + 1, 5)}`
                        )}
                      >
                        <Link href={item.href} onClick={() => setSheetOpen(false)}>
                          <Icon className="size-4" />
                          <span>{item.label}</span>
                        </Link>
                      </Button>
                    )
                  })}
                  {/* The Alarmeingang is a sheet over this page, not a page of its own: close
                      «Mehr» first, then open it (the same hand-over as «Links & QR»). */}
                  <Button
                    variant="ghost"
                    className="w-full justify-start gap-3 touch-manipulation hover-delight animate-stagger-fade-in stagger-delay-2"
                    onClick={() => {
                      setSheetOpen(false)
                      setTimeout(openAlarmInbox, 350)
                    }}
                  >
                    <Inbox className="size-4" />
                    <span>{t('diveraPool')}</span>
                    <AlarmInboxMenuCount className="ml-auto" />
                  </Button>
                </div>
              </div>

              <Separator />

              {/* Support Section */}
              <div className="animate-category-fade">
                <h3 className="text-xs font-medium text-muted-foreground mb-2">
                  {t('support')}
                </h3>
                <div className="space-y-2">
                  {secondaryItems.filter(item => item.category === 'Support').map((item, index) => {
                    const Icon = item.icon
                    const isActive = currentPage === item.id
                    return (
                      <Button
                        key={item.id}
                        asChild
                        variant={isActive ? "secondary" : "ghost"}
                        className={cn(
                          "w-full justify-start gap-3 touch-manipulation hover-delight",
                          `animate-stagger-fade-in stagger-delay-${Math.min(index + 1, 5)}`
                        )}
                      >
                        <Link href={item.href} onClick={() => setSheetOpen(false)}>
                          <Icon className="size-4" />
                          <span>{item.label}</span>
                        </Link>
                      </Button>
                    )
                  })}
                </div>
              </div>

              {/* Account Section */}
              <Separator />
              <div className="animate-category-fade">
                <h3 className="text-xs font-medium text-muted-foreground mb-2">
                  {t('account')}
                </h3>
                <div className="space-y-2">
                  {/* Who is logged in — the same block as the desktop user menu. */}
                  <AccountBlock className="px-3 py-1" />
                  <Button
                    variant="ghost"
                    className="w-full justify-start gap-3 touch-manipulation hover-delight text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => {
                      setSheetOpen(false)
                      requestLogout()
                    }}
                  >
                    <LogOut className="size-4" />
                    <span>{tAccount('logout')}</span>
                  </Button>
                  <VersionLabel className="px-3" />
                </div>
              </div>
            </div>
          </SheetContent>
        </Sheet>
        {logoutDialog}
        {isMobile && <PhoneQuickSheets open={quickSheet} onOpenChange={setQuickSheet} />}
      </div>
    </nav>
  )
}
