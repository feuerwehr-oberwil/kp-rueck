'use client';

/**
 * Page Navigation Component
 * Consistent navigation across all pages with map/list icons, help button, and UserMenu
 * Desktop-focused - core views only, secondary items moved to UserMenu
 */

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { UserMenu } from '@/components/user-menu';
import { NotificationBellTrigger } from '@/components/notifications/notification-bell-trigger';
import { Map as MapIcon, List, Calendar } from 'lucide-react';
import Link from 'next/link';

interface PageNavigationProps {
  currentPage: 'kanban' | 'map' | 'events' | 'settings' | 'training' | 'stats' | 'help' | 'divera';
  vehicleTypes?: Array<{ key: string; name: string }>;
  hasSelectedEvent?: boolean;
  // Quick action callbacks (for Kanban page)
  onNewIncident?: () => void;
  onCheckIn?: () => void;
  onReko?: () => void;
  onVehicleStatus?: () => void;
  onPrint?: () => void;
}

export function PageNavigation({
  currentPage,
  vehicleTypes = [],
  hasSelectedEvent = true,
  onNewIncident,
  onCheckIn,
  onReko,
  onVehicleStatus,
  onPrint,
}: PageNavigationProps) {
  const t = useTranslations('nav.pageNav');
  return (
    // Desktop only — on mobile navigation lives in the bottom navbar.
    <nav aria-label={t('main')} className="hidden md:flex items-center gap-1 md:gap-2">
        {/* Kanban Icon */}
        <Link href="/" prefetch={true} className={!hasSelectedEvent ? 'pointer-events-none' : ''}>
          <Button
            variant="ghost"
            size="icon"
            className={`rounded-lg h-9 w-9 md:h-10 md:w-10 ${currentPage === 'kanban' ? 'opacity-40 cursor-default' : !hasSelectedEvent ? 'opacity-40' : ''}`}
            disabled={currentPage === 'kanban' || !hasSelectedEvent}
            title={t('kanban')}
            aria-label={t('kanban')}
          >
            <List className="size-4" />
          </Button>
        </Link>

        {/* Map Icon */}
        <Link href="/map" prefetch={true} className={!hasSelectedEvent ? 'pointer-events-none' : ''}>
          <Button
            variant="ghost"
            size="icon"
            className={`rounded-lg h-9 w-9 md:h-10 md:w-10 ${currentPage === 'map' ? 'opacity-40 cursor-default' : !hasSelectedEvent ? 'opacity-40' : ''}`}
            disabled={currentPage === 'map' || !hasSelectedEvent}
            title={t('map')}
          >
            <MapIcon className="size-4" />
          </Button>
        </Link>

        {/* Events Icon */}
        <Link href="/events" prefetch={true}>
          <Button
            variant="ghost"
            size="icon"
            className={`rounded-lg h-9 w-9 md:h-10 md:w-10 ${currentPage === 'events' ? 'opacity-40 cursor-default' : ''}`}
            disabled={currentPage === 'events'}
            title={t('events')}
          >
            <Calendar className="size-4" />
          </Button>
        </Link>

        {/* User Menu (Cog Dropdown) - now contains all secondary navigation */}
        <UserMenu
          onNewIncident={onNewIncident}
          onCheckIn={onCheckIn}
          onReko={onReko}
          onVehicleStatus={onVehicleStatus}
          onPrint={onPrint}
        />

        {/* Notification Bell Trigger - rightmost to align with fixed sidebar */}
        <NotificationBellTrigger />
    </nav>
  );
}
