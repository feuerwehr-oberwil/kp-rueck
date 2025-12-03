'use client';

/**
 * Mobile Navigation Component
 * Unified hamburger menu for all pages with consistent UI/UX
 * Follows mobile-first design principles with clear hierarchy and touch-friendly targets
 */

import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';
import { Menu, List, Map as MapIcon, Calendar, Settings, Users, HelpCircle, LayoutGrid } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { UserMenu } from '@/components/user-menu';
import { NotificationSidebar } from '@/components/notifications/notification-sidebar';
import { ReactNode } from 'react';

interface MobileNavigationProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: ReactNode;
  hasSelectedEvent?: boolean;
}

interface NavItem {
  href: string;
  icon: typeof List;
  label: string;
  description: string;
  requiresEvent?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  {
    href: '/',
    icon: List,
    label: 'Kanban',
    description: 'Übersichtsboard',
    requiresEvent: true,
  },
  {
    href: '/map',
    icon: MapIcon,
    label: 'Karte',
    description: 'Lagekarte',
    requiresEvent: true,
  },
  // Hidden on mobile - Combined view not optimized for small screens
  // {
  //   href: '/combined',
  //   icon: LayoutGrid,
  //   label: 'Kombiniert',
  //   description: 'Kanban & Karte',
  //   requiresEvent: true,
  // },
  {
    href: '/events',
    icon: Calendar,
    label: 'Ereignisse',
    description: 'Ereignisverwaltung',
  },
];

const SETTINGS_ITEMS: NavItem[] = [
  {
    href: '/resources',
    icon: Users,
    label: 'Ressourcen',
    description: 'Personal & Material',
  },
  {
    href: '/settings',
    icon: Settings,
    label: 'Einstellungen',
    description: 'Systemkonfiguration',
  },
  {
    href: '/help',
    icon: HelpCircle,
    label: 'Hilfe',
    description: 'Dokumentation',
  },
];

export function MobileNavigation({ open, onOpenChange, children, hasSelectedEvent = true }: MobileNavigationProps) {
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === '/') {
      return pathname === '/';
    }
    return pathname.startsWith(href);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="md:hidden">
          <Menu className="h-6 w-6" />
          <span className="sr-only">Menu öffnen</span>
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-80 flex flex-col p-0">
        {/* Header */}
        <SheetHeader className="border-b px-6 py-5">
          <SheetTitle className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-red-600 to-orange-600 text-xl shadow-md">
              🚒
            </div>
            <span className="text-base font-semibold">KP Rück</span>
          </SheetTitle>
        </SheetHeader>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto px-4 py-6">
          {/* Additional content passed as children (e.g., search, time) */}
          {children && (
            <>
              <div className="space-y-3 mb-6 px-2">{children}</div>
              <Separator className="my-6" />
            </>
          )}

          {/* Main Navigation */}
          <div className="space-y-8">
            {/* Views Section */}
            <div>
              <h3 className="text-[11px] font-semibold text-muted-foreground/80 uppercase tracking-wider mb-4 px-3">
                Ansichten
              </h3>
              <nav className="space-y-1.5">
                {NAV_ITEMS.map((item) => {
                  const Icon = item.icon;
                  const active = isActive(item.href);
                  const disabled = item.requiresEvent && !hasSelectedEvent;

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`
                        group relative flex items-center gap-4 rounded-xl px-4 py-3.5 transition-all duration-200
                        ${active
                          ? 'bg-muted'
                          : disabled
                          ? 'opacity-40 cursor-not-allowed'
                          : 'hover:bg-muted/70 active:scale-[0.98]'
                        }
                      `}
                      onClick={(e) => {
                        if (disabled) {
                          e.preventDefault();
                          return;
                        }
                        onOpenChange?.(false);
                      }}
                    >
                      {/* Active indicator - left border accent */}
                      {active && (
                        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-primary rounded-r-full" />
                      )}

                      <Icon className={`h-5 w-5 flex-shrink-0 transition-colors ${active ? 'text-primary' : ''}`} />
                      <div className="flex-1 min-w-0">
                        <div className={`text-sm font-medium truncate ${active ? 'text-primary' : ''}`}>
                          {item.label}
                        </div>
                        <div className="text-xs text-muted-foreground/70 truncate mt-0.5">
                          {item.description}
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </nav>
            </div>

            <Separator />

            {/* Management Section */}
            <div>
              <h3 className="text-[11px] font-semibold text-muted-foreground/80 uppercase tracking-wider mb-4 px-3">
                Verwaltung
              </h3>
              <nav className="space-y-1.5">
                {SETTINGS_ITEMS.map((item) => {
                  const Icon = item.icon;
                  const active = isActive(item.href);

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`
                        group relative flex items-center gap-4 rounded-xl px-4 py-3.5 transition-all duration-200
                        ${active
                          ? 'bg-muted'
                          : 'hover:bg-muted/70 active:scale-[0.98]'
                        }
                      `}
                      onClick={() => onOpenChange?.(false)}
                    >
                      {/* Active indicator - left border accent */}
                      {active && (
                        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-primary rounded-r-full" />
                      )}

                      <Icon className={`h-5 w-5 flex-shrink-0 transition-colors ${active ? 'text-primary' : ''}`} />
                      <div className="flex-1 min-w-0">
                        <div className={`text-sm font-medium truncate ${active ? 'text-primary' : ''}`}>
                          {item.label}
                        </div>
                        <div className="text-xs text-muted-foreground/70 truncate mt-0.5">
                          {item.description}
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </nav>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t px-4 py-4 mt-auto bg-muted/20">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <NotificationSidebar />
              <UserMenu />
            </div>
            <div className="text-[10px] text-muted-foreground/60 font-medium">
              v1.0
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
