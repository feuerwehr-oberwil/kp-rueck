'use client'

/**
 * Mobile Bottom Navigation Component
 * Bottom tab bar for mobile devices with iOS/Android safe area support
 * Shows primary navigation tabs + "More" sheet for secondary functions
 * Enhanced with delightful micro-interactions
 */

import { List, Map as MapIcon, Calendar, MoreHorizontal, HelpCircle, Settings, Radio, QrCode, Sparkles, LogOut, Users, Truck, Printer, Search, MonitorDown, Plus, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import { Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { useAuth } from '@/lib/contexts/auth-context'
import { useEvent } from '@/lib/contexts/event-context'
import { RoleBadge } from '@/components/auth/role-badge'

interface MobileBottomNavigationProps {
  currentPage: 'kanban' | 'map' | 'events' | 'settings' | 'help' | string
  hasSelectedEvent?: boolean
  onCheckIn?: () => void
  onReko?: () => void
  onDisplay?: () => void
  onPersonnel?: () => void
  onVehicleStatus?: () => void
  onPrint?: () => void
  onThermo?: () => void
  printerEnabled?: boolean
}

export function MobileBottomNavigation({
  currentPage,
  hasSelectedEvent = true,
  onCheckIn,
  onReko,
  onDisplay,
  onPersonnel,
  onVehicleStatus,
  onPrint,
  onThermo,
  printerEnabled = false,
}: MobileBottomNavigationProps) {
  const t = useTranslations('nav.mobileBottomNav')
  const { isEditor, logout } = useAuth()
  const { selectedEvent, events, setSelectedEvent } = useEvent()
  const router = useRouter()
  const [sheetOpen, setSheetOpen] = useState(false)
  const [tapAnimation, setTapAnimation] = useState<string | null>(null)

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
      icon: List,
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
    { id: 'divera', label: t('diveraPool'), icon: Radio, href: '/divera-pool', category: 'Verwaltung' },
    { id: 'help', label: t('helpDocs'), icon: HelpCircle, href: '/help', category: 'Support' },
  ]

  // Handle tap animation
  const handleTap = (tabId: string) => {
    setTapAnimation(tabId)
    setTimeout(() => setTapAnimation(null), 200)
  }

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-card/95 backdrop-blur-sm md:hidden"
      style={{
        paddingBottom: 'env(safe-area-inset-bottom, 0px)'
      }}
    >
      <div className="flex items-center justify-around min-h-[60px] px-2">
        {tabs.map((tab) => {
          const Icon = tab.icon
          const isActive = currentPage === tab.id

          return (
            <Link
              key={tab.id}
              href={tab.href}
              onClick={() => !tab.disabled && handleTap(tab.id)}
              className={cn(
                "flex flex-col items-center justify-center gap-1 flex-1 min-h-[44px] rounded-lg transition-all touch-manipulation",
                isActive && "text-primary scale-105",
                !isActive && "text-muted-foreground hover:text-foreground",
                tab.disabled && "opacity-40 pointer-events-none",
                tapAnimation === tab.id && "animate-bounce-tap",
                isActive && "animate-tab-switch"
              )}
              aria-label={tab.label}
              aria-current={isActive ? 'page' : undefined}
            >
              <Icon className={cn(
                "h-5 w-5 transition-transform",
                isActive && "scale-110"
              )} aria-hidden="true" />
              <span className={cn(
                "text-xs font-medium transition-all",
                isActive && "font-semibold"
              )}>{tab.label}</span>
            </Link>
          )
        })}

        {/* More menu */}
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetTrigger asChild>
            <button
              onClick={() => handleTap('more')}
              className={cn(
                "flex flex-col items-center justify-center gap-1 flex-1 min-h-[44px] rounded-lg transition-all touch-manipulation",
                (currentPage === 'settings' || currentPage === 'help') && "text-primary scale-105",
                (currentPage !== 'settings' && currentPage !== 'help') && "text-muted-foreground hover:text-foreground",
                tapAnimation === 'more' && "animate-bounce-tap"
              )}
              aria-label={t('moreOptions')}
            >
              <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
              <span className="text-xs font-medium">{t('more')}</span>
            </button>
          </SheetTrigger>
          <SheetContent
            side="bottom"
            className="modal-h-tall overflow-y-auto animate-sheet-slide-up px-6"
            style={{
              paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 2rem)'
            }}
          >
            <SheetHeader className="mb-4 -mx-6 px-6 pb-3 border-b">
              <SheetTitle>{t('moreFunctions')}</SheetTitle>
              <div className="flex items-center gap-2 pt-2">
                <RoleBadge />
              </div>
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
                      <span className="text-xs text-orange-600 dark:text-orange-400">{t('training')}</span>
                    )}
                  </div>
                  {otherEvents.map((event) => (
                    <Button
                      key={event.id}
                      variant="ghost"
                      className="w-full justify-start gap-3 touch-manipulation hover-delight"
                      onClick={() => {
                        setSelectedEvent(event)
                        setSheetOpen(false)
                      }}
                    >
                      <ChevronRight className="size-4 text-muted-foreground" />
                      <span className="truncate">{event.name}</span>
                    </Button>
                  ))}
                  <Button
                    variant="ghost"
                    className="w-full justify-start gap-3 touch-manipulation hover-delight"
                    onClick={() => {
                      router.push('/events?action=create')
                      setSheetOpen(false)
                    }}
                  >
                    <Plus className="size-4" />
                    <span>{t('newEvent')}</span>
                  </Button>
                  <Link href="/events" onClick={() => setSheetOpen(false)}>
                    <Button
                      variant={currentPage === 'events' ? 'secondary' : 'ghost'}
                      className="w-full justify-start gap-3 touch-manipulation hover-delight"
                    >
                      <Calendar className="size-4" />
                      <span>{t('allEvents')}</span>
                    </Button>
                  </Link>
                </div>
              </div>

              <Separator />

              {/* Quick Actions Section — viewing-first: the QR/print/personnel
                  actions are editor-only, so viewers get a decluttered sheet.
                  The training link stays visible (spawning is the main mobile task). */}
              {(isEditor || selectedEvent?.training_flag) && (
              <>
              <div className="animate-category-fade">
                <h3 className="text-xs font-medium text-muted-foreground mb-2">
                  {t('quickActions')}
                </h3>
                <div className="space-y-1">
                  {/* Check-In Button */}
                  {isEditor && onCheckIn && (
                    <Button
                      variant="ghost"
                      className="w-full justify-start gap-3 touch-manipulation hover-delight animate-stagger-fade-in stagger-delay-1"
                      onClick={() => {
                        setSheetOpen(false)
                        setTimeout(() => onCheckIn(), 350)
                      }}
                    >
                      <QrCode className="size-4" />
                      <span>{t('checkInQr')}</span>
                    </Button>
                  )}

                  {/* Reko Dashboard QR/Link */}
                  {isEditor && onReko && (
                    <Button
                      variant="ghost"
                      className="w-full justify-start gap-3 touch-manipulation hover-delight animate-stagger-fade-in stagger-delay-2"
                      onClick={() => {
                        setSheetOpen(false)
                        setTimeout(() => onReko(), 350)
                      }}
                    >
                      <Search className="size-4" />
                      <span>{t('reko')}</span>
                    </Button>
                  )}

                  {/* Display share QR/Link */}
                  {isEditor && onDisplay && (
                    <Button
                      variant="ghost"
                      className="w-full justify-start gap-3 touch-manipulation hover-delight animate-stagger-fade-in stagger-delay-3"
                      onClick={() => {
                        setSheetOpen(false)
                        setTimeout(() => onDisplay(), 350)
                      }}
                    >
                      <MonitorDown className="size-4" />
                      <span>{t('display')}</span>
                    </Button>
                  )}

                  {/* Personnel */}
                  {isEditor && onPersonnel && (
                    <Button
                      variant="ghost"
                      className="w-full justify-start gap-3 touch-manipulation hover-delight animate-stagger-fade-in stagger-delay-2"
                      onClick={() => {
                        setSheetOpen(false)
                        setTimeout(() => onPersonnel(), 350)
                      }}
                    >
                      <Users className="size-4" />
                      <span>{t('personnel')}</span>
                    </Button>
                  )}

                  {/* Vehicle Status */}
                  {isEditor && onVehicleStatus && (
                    <Button
                      variant="ghost"
                      className="w-full justify-start gap-3 touch-manipulation hover-delight animate-stagger-fade-in stagger-delay-3"
                      onClick={() => {
                        setSheetOpen(false)
                        setTimeout(() => onVehicleStatus(), 350)
                      }}
                    >
                      <Truck className="size-4" />
                      <span>{t('vehicles')}</span>
                    </Button>
                  )}

                  {/* Print */}
                  {isEditor && onPrint && (
                    <Button
                      variant="ghost"
                      className="w-full justify-start gap-3 touch-manipulation hover-delight animate-stagger-fade-in stagger-delay-4"
                      onClick={() => {
                        setSheetOpen(false)
                        setTimeout(() => onPrint(), 350)
                      }}
                    >
                      <Printer className="size-4" />
                      <span>{t('print')}</span>
                    </Button>
                  )}

                  {/* Thermo Print */}
                  {isEditor && onThermo && printerEnabled && (
                    <Button
                      variant="ghost"
                      className="w-full justify-start gap-3 touch-manipulation hover-delight animate-stagger-fade-in stagger-delay-5"
                      onClick={() => {
                        setSheetOpen(false)
                        setTimeout(() => onThermo(), 350)
                      }}
                    >
                      <Printer className="size-4" />
                      <span>{t('thermoPrint')}</span>
                    </Button>
                  )}

                  {/* Training Control - only for training events */}
                  {selectedEvent?.training_flag && (
                    <Link href="/training" onClick={() => setSheetOpen(false)}>
                      <Button
                        variant="ghost"
                        className="w-full justify-start gap-3 touch-manipulation hover-delight animate-stagger-fade-in stagger-delay-2"
                      >
                        <Sparkles className="size-4 text-orange-500" />
                        <span>{t('trainingControl')}</span>
                      </Button>
                    </Link>
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
                      <Link key={item.id} href={item.href} onClick={() => setSheetOpen(false)}>
                        <Button
                          variant={isActive ? "secondary" : "ghost"}
                          className={cn(
                            "w-full justify-start gap-3 touch-manipulation hover-delight",
                            `animate-stagger-fade-in stagger-delay-${Math.min(index + 1, 5)}`
                          )}
                        >
                          <Icon className="size-4" />
                          <span>{item.label}</span>
                        </Button>
                      </Link>
                    )
                  })}
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
                      <Link key={item.id} href={item.href} onClick={() => setSheetOpen(false)}>
                        <Button
                          variant={isActive ? "secondary" : "ghost"}
                          className={cn(
                            "w-full justify-start gap-3 touch-manipulation hover-delight",
                            `animate-stagger-fade-in stagger-delay-${Math.min(index + 1, 5)}`
                          )}
                        >
                          <Icon className="size-4" />
                          <span>{item.label}</span>
                        </Button>
                      </Link>
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
                  <Button
                    variant="ghost"
                    className="w-full justify-start gap-3 touch-manipulation hover-delight text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => {
                      logout()
                      setSheetOpen(false)
                    }}
                  >
                    <LogOut className="size-4" />
                    <span>{t('logout')}</span>
                  </Button>
                </div>
              </div>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </nav>
  )
}
