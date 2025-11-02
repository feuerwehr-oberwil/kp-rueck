'use client';

/**
 * Mobile Navigation Component
 * Unified hamburger menu for all pages with consistent UI/UX
 * Follows mobile-first design principles with clear hierarchy and touch-friendly targets
 */

import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';
import { Menu, List, Map as MapIcon, Calendar, Settings, Users, HelpCircle, LayoutGrid, Check } from 'lucide-react';
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
  {
    href: '/combined',
    icon: LayoutGrid,
    label: 'Kombiniert',
    description: 'Kanban & Karte',
    requiresEvent: true,
  },
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
      <SheetContent side="right" className="w-80 flex flex-col">
        <SheetHeader className="border-b pb-4">
          <SheetTitle className="flex items-center gap-2 text-lg">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-red-600 to-orange-600 text-xl shadow-lg">
              🚒
            </div>
            <span>KP Rück Navigation</span>
          </SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto py-6">
          {/* Additional content passed as children (e.g., search, time) */}
          {children && (
            <>
              <div className="space-y-4 mb-6">{children}</div>
              <Separator className="my-6" />
            </>
          )}

          {/* Main Navigation */}
          <div className="space-y-6">
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 px-2">
                Ansichten
              </h3>
              <nav className="space-y-1">
                {NAV_ITEMS.map((item) => {
                  const Icon = item.icon;
                  const active = isActive(item.href);
                  const disabled = item.requiresEvent && !hasSelectedEvent;

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`
                        flex items-center gap-3 rounded-lg px-3 py-3 transition-all
                        ${active
                          ? 'bg-primary text-primary-foreground font-medium shadow-sm'
                          : disabled
                          ? 'text-muted-foreground opacity-50 cursor-not-allowed'
                          : 'text-foreground hover:bg-accent hover:text-accent-foreground'
                        }
                      `}
                      onClick={(e) => {
                        if (disabled) {
                          e.preventDefault();
                          return;
                        }
                        // Close menu on navigation
                        onOpenChange?.(false);
                      }}
                    >
                      <Icon className="h-5 w-5 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{item.label}</div>
                        <div className="text-xs opacity-90 truncate">{item.description}</div>
                      </div>
                      {active && <Check className="h-4 w-4 flex-shrink-0" />}
                    </Link>
                  );
                })}
              </nav>
            </div>

            <Separator />

            {/* Settings Navigation */}
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 px-2">
                Verwaltung
              </h3>
              <nav className="space-y-1">
                {SETTINGS_ITEMS.map((item) => {
                  const Icon = item.icon;
                  const active = isActive(item.href);

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`
                        flex items-center gap-3 rounded-lg px-3 py-3 transition-all
                        ${active
                          ? 'bg-primary text-primary-foreground font-medium shadow-sm'
                          : 'text-foreground hover:bg-accent hover:text-accent-foreground'
                        }
                      `}
                      onClick={() => {
                        // Close menu on navigation
                        onOpenChange?.(false);
                      }}
                    >
                      <Icon className="h-5 w-5 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{item.label}</div>
                        <div className="text-xs opacity-90 truncate">{item.description}</div>
                      </div>
                      {active && <Check className="h-4 w-4 flex-shrink-0" />}
                    </Link>
                  );
                })}
              </nav>
            </div>
          </div>
        </div>

        {/* Footer with User Menu and Notifications */}
        <div className="border-t pt-4 mt-auto">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <NotificationSidebar />
              <UserMenu />
            </div>
            <div className="text-xs text-muted-foreground">
              Version 1.0
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
