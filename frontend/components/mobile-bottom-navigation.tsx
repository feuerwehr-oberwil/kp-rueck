'use client'

/**
 * Mobile Bottom Navigation Component
 * Bottom tab bar for mobile devices with iOS/Android safe area support
 * Shows primary navigation tabs + "More" sheet for secondary functions
 * Enhanced with delightful micro-interactions
 */

import { List, Map as MapIcon, Calendar, MoreHorizontal, HelpCircle, Settings, Radio, QrCode, Sparkles, LogOut } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { cn } from '@/lib/utils'
import { Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { useAuth } from '@/lib/contexts/auth-context'
import { useEvent } from '@/lib/contexts/event-context'
import { RoleBadge } from '@/components/auth/role-badge'

interface MobileBottomNavigationProps {
  currentPage: 'kanban' | 'map' | 'combined' | 'events' | 'settings' | 'help' | string
  hasSelectedEvent?: boolean
  onCheckIn?: () => void
}

export function MobileBottomNavigation({
  currentPage,
  hasSelectedEvent = true,
  onCheckIn
}: MobileBottomNavigationProps) {
  const { isEditor, logout } = useAuth()
  const { selectedEvent } = useEvent()
  const [sheetOpen, setSheetOpen] = useState(false)
  const [tapAnimation, setTapAnimation] = useState<string | null>(null)

  const tabs = [
    {
      id: 'kanban',
      label: 'Einsätze',
      icon: List,
      href: '/',
      disabled: !hasSelectedEvent,
    },
    {
      id: 'map',
      label: 'Karte',
      icon: MapIcon,
      href: '/map',
      disabled: !hasSelectedEvent,
    },
  ]

  // Secondary navigation items for "More" sheet
  const secondaryItems = [
    { id: 'events', label: 'Events', icon: Calendar, href: '/events', category: 'Navigation' },
    { id: 'settings', label: 'Einstellungen', icon: Settings, href: '/settings', category: 'Verwaltung' },
    { id: 'divera', label: 'Divera Notfälle', icon: Radio, href: '/divera-pool', category: 'Verwaltung' },
    { id: 'help', label: 'Hilfe & Dokumentation', icon: HelpCircle, href: '/help', category: 'Support' },
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
              aria-label="Mehr Optionen"
            >
              <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
              <span className="text-xs font-medium">Mehr</span>
            </button>
          </SheetTrigger>
          <SheetContent
            side="bottom"
            className="h-[70vh] overflow-y-auto animate-sheet-slide-up px-6"
            style={{
              paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 2rem)'
            }}
          >
            <SheetHeader className="mb-6 -mx-6 px-6 pb-4 border-b">
              <SheetTitle>Weitere Funktionen</SheetTitle>
              <div className="flex items-center gap-2 pt-2">
                <RoleBadge />
              </div>
            </SheetHeader>

            <div className="space-y-6 pb-4">
              {/* Quick Actions Section */}
              <div className="animate-category-fade">
                <h3 className="text-xs font-medium text-muted-foreground uppercase mb-3">
                  Schnellzugriff
                </h3>
                <div className="space-y-2">
                  {/* Check-In Button */}
                  {onCheckIn && (
                    <Button
                      variant="ghost"
                      className="w-full justify-start gap-3 h-12 touch-manipulation hover-delight animate-stagger-fade-in stagger-delay-1"
                      onClick={() => {
                        onCheckIn()
                        setSheetOpen(false)
                      }}
                    >
                      <QrCode className="h-5 w-5" />
                      <span>Check-In QR-Code</span>
                    </Button>
                  )}

                  {/* Training Control - only for training events */}
                  {selectedEvent?.training_flag && (
                    <Link href="/training" onClick={() => setSheetOpen(false)}>
                      <Button
                        variant="ghost"
                        className="w-full justify-start gap-3 h-12 touch-manipulation hover-delight animate-stagger-fade-in stagger-delay-2"
                      >
                        <Sparkles className="h-5 w-5 text-orange-500" />
                        <span>Übungs-Steuerung</span>
                      </Button>
                    </Link>
                  )}
                </div>
              </div>

              <Separator />

              {/* Navigation Section (Events) */}
              <div className="animate-category-fade">
                <h3 className="text-xs font-medium text-muted-foreground uppercase mb-3">
                  Navigation
                </h3>
                <div className="space-y-2">
                  {secondaryItems.filter(item => item.category === 'Navigation').map((item, index) => {
                    const Icon = item.icon
                    const isActive = currentPage === item.id
                    return (
                      <Link key={item.id} href={item.href} onClick={() => setSheetOpen(false)}>
                        <Button
                          variant={isActive ? "secondary" : "ghost"}
                          className={cn(
                            "w-full justify-start gap-3 h-12 touch-manipulation hover-delight",
                            `animate-stagger-fade-in stagger-delay-${Math.min(index + 1, 5)}`
                          )}
                        >
                          <Icon className="h-5 w-5" />
                          <span>{item.label}</span>
                        </Button>
                      </Link>
                    )
                  })}
                </div>
              </div>

              <Separator />

              {/* Verwaltung Section */}
              <div className="animate-category-fade">
                <h3 className="text-xs font-medium text-muted-foreground uppercase mb-3">
                  Verwaltung
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
                            "w-full justify-start gap-3 h-12 touch-manipulation hover-delight",
                            `animate-stagger-fade-in stagger-delay-${Math.min(index + 1, 5)}`
                          )}
                        >
                          <Icon className="h-5 w-5" />
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
                <h3 className="text-xs font-medium text-muted-foreground uppercase mb-3">
                  Support
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
                            "w-full justify-start gap-3 h-12 touch-manipulation hover-delight",
                            `animate-stagger-fade-in stagger-delay-${Math.min(index + 1, 5)}`
                          )}
                        >
                          <Icon className="h-5 w-5" />
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
                <h3 className="text-xs font-medium text-muted-foreground uppercase mb-3">
                  Konto
                </h3>
                <div className="space-y-2">
                  <Button
                    variant="ghost"
                    className="w-full justify-start gap-3 h-12 touch-manipulation hover-delight text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => {
                      logout()
                      setSheetOpen(false)
                    }}
                  >
                    <LogOut className="h-5 w-5" />
                    <span>Abmelden</span>
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
