'use client';

/**
 * Page Navigation Component
 * Consistent navigation across all pages with map/list icons, help button, and UserMenu
 */

import { Button } from '@/components/ui/button';
import { UserMenu } from '@/components/user-menu';
import { NotificationSidebar } from '@/components/notifications/notification-sidebar';
import { Map as MapIcon, List, HelpCircle, Calendar, LayoutGrid } from 'lucide-react';
import Link from 'next/link';

interface PageNavigationProps {
  currentPage: 'kanban' | 'map' | 'events' | 'settings' | 'combined' | 'training' | 'stats' | 'help' | 'resources';
  vehicleTypes?: Array<{ key: string; name: string }>;
  hasSelectedEvent?: boolean;
}

export function PageNavigation({ currentPage, vehicleTypes = [], hasSelectedEvent = true }: PageNavigationProps) {
  return (
    <div className="flex items-center gap-1 md:gap-2">
        {/* Kanban Icon */}
        <Link href="/" prefetch={true} className={!hasSelectedEvent ? 'pointer-events-none' : ''}>
          <Button
            variant="ghost"
            size="icon"
            className={`rounded-lg h-9 w-9 md:h-10 md:w-10 ${currentPage === 'kanban' ? 'opacity-40 cursor-default' : !hasSelectedEvent ? 'opacity-40' : ''}`}
            disabled={currentPage === 'kanban' || !hasSelectedEvent}
            title="Kanban Board"
          >
            <List className="h-4 w-4 md:h-5 md:w-5" />
          </Button>
        </Link>

        {/* Map Icon */}
        <Link href="/map" prefetch={true} className={!hasSelectedEvent ? 'pointer-events-none' : ''}>
          <Button
            variant="ghost"
            size="icon"
            className={`rounded-lg h-9 w-9 md:h-10 md:w-10 ${currentPage === 'map' ? 'opacity-40 cursor-default' : !hasSelectedEvent ? 'opacity-40' : ''}`}
            disabled={currentPage === 'map' || !hasSelectedEvent}
            title="Lagekarte"
          >
            <MapIcon className="h-4 w-4 md:h-5 md:w-5" />
          </Button>
        </Link>

        {/* Combined View Icon - Hidden on mobile to save space */}
        <Link href="/combined" prefetch={true} className={`hidden sm:block ${!hasSelectedEvent ? 'pointer-events-none' : ''}`}>
          <Button
            variant="ghost"
            size="icon"
            className={`rounded-lg ${currentPage === 'combined' ? 'opacity-40 cursor-default' : !hasSelectedEvent ? 'opacity-40' : ''}`}
            disabled={currentPage === 'combined' || !hasSelectedEvent}
            title="Kombinierte Ansicht"
          >
            <LayoutGrid className="h-5 w-5" />
          </Button>
        </Link>

        {/* Events Icon */}
        <Link href="/events" prefetch={true}>
          <Button
            variant="ghost"
            size="icon"
            className={`rounded-lg h-9 w-9 md:h-10 md:w-10 ${currentPage === 'events' ? 'opacity-40 cursor-default' : ''}`}
            disabled={currentPage === 'events'}
            title="Ereignisse"
          >
            <Calendar className="h-4 w-4 md:h-5 md:w-5" />
          </Button>
        </Link>

        {/* Help Button - Hidden on small mobile, visible on sm+ */}
        <Link href="/help" prefetch={true} className="hidden sm:block">
          <Button
            variant="ghost"
            size="icon"
            className={`rounded-lg ${currentPage === 'help' ? 'opacity-40 cursor-default' : ''}`}
            disabled={currentPage === 'help'}
            title="Hilfe & Dokumentation"
          >
            <HelpCircle className="h-5 w-5" />
          </Button>
        </Link>

        {/* Notification Sidebar */}
        <NotificationSidebar />

        {/* User Menu (Cog Dropdown) */}
        <UserMenu />
    </div>
  );
}
