'use client'

/**
 * Mobile Bottom Navigation Component
 * Bottom tab bar for mobile devices with iOS/Android safe area support
 * Shows primary navigation tabs + "More" sheet for secondary functions
 * Enhanced with delightful micro-interactions
 */

import { List, Map as MapIcon, Calendar, MoreHorizontal, HelpCircle, Settings, BarChart3, Users, Radio, FileSpreadsheet, FileText } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { cn } from '@/lib/utils'
import { Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { useAuth } from '@/lib/contexts/auth-context'
import { RoleBadge } from '@/components/auth/role-badge'

interface MobileBottomNavigationProps {
  currentPage: 'kanban' | 'map' | 'combined' | 'events' | 'settings' | 'help' | string
  hasSelectedEvent?: boolean
}

export function MobileBottomNavigation({
  currentPage,
  hasSelectedEvent = true
}: MobileBottomNavigationProps) {
  const { isEditor } = useAuth()
  const [sheetOpen, setSheetOpen] = useState(false)
  const [tapAnimation, setTapAnimation] = useState<string | null>(null)

  const tabs = [
    {
      id: 'kanban',
      label: 'Kanban',
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
    {
      id: 'events',
      label: 'Events',
      icon: Calendar,
      href: '/events',
      disabled: false,
    },
  ]

  // Secondary navigation items for "More" sheet
  const secondaryItems = [
    { id: 'settings', label: 'Einstellungen', icon: Settings, href: '/settings', category: 'Verwaltung' },
    { id: 'stats', label: 'Statistiken', icon: BarChart3, href: '/stats', category: 'Verwaltung' },
    { id: 'divera', label: 'Divera Notfälle', icon: Radio, href: '/divera-pool', category: 'Verwaltung' },
    { id: 'help', label: 'Hilfe & Dokumentation', icon: HelpCircle, href: '/help', category: 'Support' },
  ]

  // Admin items (editors only)
  const adminItems = [
    { id: 'resources', label: 'Ressourcen', icon: Users, href: '/resources' },
    { id: 'import', label: 'Import/Export', icon: FileSpreadsheet, href: '/admin/import' },
    { id: 'audit', label: 'Audit-Protokoll', icon: FileText, href: '/admin/audit' },
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

            <div className="space-y-8 pb-4">
              {/* Verwaltung Section */}
              <div className="animate-category-fade">
                <h3 className="text-xs font-medium text-muted-foreground uppercase mb-3">
                  Verwaltung
                </h3>
                <div className="space-y-2">
                  {secondaryItems.map((item, index) => {
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

              {/* Administration Section (Editors only) */}
              {isEditor && (
                <>
                  <Separator />
                  <div className="animate-category-fade" style={{ animationDelay: '0.2s' }}>
                    <h3 className="text-xs font-medium text-muted-foreground uppercase mb-3">
                      Administration
                    </h3>
                    <div className="space-y-2">
                      {adminItems.map((item, index) => {
                        const Icon = item.icon
                        return (
                          <Link key={item.id} href={item.href} onClick={() => setSheetOpen(false)}>
                            <Button
                              variant="ghost"
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
                </>
              )}
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </nav>
  )
}
