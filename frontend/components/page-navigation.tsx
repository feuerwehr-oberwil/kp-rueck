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
  currentPage: 'kanban' | 'map' | 'events' | 'settings' | 'combined' | 'training' | 'stats';
  vehicleTypes?: Array<{ key: string; name: string }>;
  hasSelectedEvent?: boolean;
}

export function PageNavigation({ currentPage, vehicleTypes = [], hasSelectedEvent = true }: PageNavigationProps) {
  return (
    <div className="flex items-center gap-2">
        {/* Kanban Icon */}
        <Link href="/" className={!hasSelectedEvent ? 'pointer-events-none' : ''}>
          <Button
            variant="ghost"
            size="icon"
            className={`rounded-lg ${currentPage === 'kanban' ? 'opacity-40 cursor-default' : !hasSelectedEvent ? 'opacity-40' : ''}`}
            disabled={currentPage === 'kanban' || !hasSelectedEvent}
            title="Kanban Board"
          >
            <List className="h-5 w-5" />
          </Button>
        </Link>

        {/* Map Icon */}
        <Link href="/map" className={!hasSelectedEvent ? 'pointer-events-none' : ''}>
          <Button
            variant="ghost"
            size="icon"
            className={`rounded-lg ${currentPage === 'map' ? 'opacity-40 cursor-default' : !hasSelectedEvent ? 'opacity-40' : ''}`}
            disabled={currentPage === 'map' || !hasSelectedEvent}
            title="Lagekarte"
          >
            <MapIcon className="h-5 w-5" />
          </Button>
        </Link>

        {/* Combined View Icon */}
        <Link href="/combined" className={!hasSelectedEvent ? 'pointer-events-none' : ''}>
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
        <Link href="/events">
          <Button
            variant="ghost"
            size="icon"
            className={`rounded-lg ${currentPage === 'events' ? 'opacity-40 cursor-default' : ''}`}
            disabled={currentPage === 'events'}
            title="Ereignisse"
          >
            <Calendar className="h-5 w-5" />
          </Button>
        </Link>

        {/* Help Button */}
        <Link href="/help">
          <Button
            variant="ghost"
            size="icon"
            className="rounded-lg"
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
