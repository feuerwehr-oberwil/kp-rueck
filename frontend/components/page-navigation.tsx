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
// `Columns3` for the board, not a generic list glyph: the page IS cards in
// status columns, and it stays distinct from the Karte and Events icons beside
// it as well as from the `LayoutGrid` the UserMenu uses for the wall display.
import { Map as MapIcon, Columns3, Calendar } from 'lucide-react';
import Link from 'next/link';

interface PageNavigationProps {
  currentPage: 'kanban' | 'map' | 'events' | 'settings' | 'training' | 'stats' | 'help' | 'divera';
  hasSelectedEvent?: boolean;
  /** The incident the current surface has open. Board and Karte pass it so the
   *  other one opens on the same one — see `withSelection`. */
  selectedIncidentId?: string | null;
  // Quick action callbacks (for Kanban page)
  onNewIncident?: () => void;
  onCheckIn?: () => void;
  onReko?: () => void;
  onVehicleStatus?: () => void;
  onPrint?: () => void;
}

export function PageNavigation({
  currentPage,
  selectedIncidentId,
  hasSelectedEvent = true,
  onNewIncident,
  onCheckIn,
  onReko,
  onVehicleStatus,
  onPrint,
}: PageNavigationProps) {
  const t = useTranslations('nav.pageNav');
  // Board and Karte hand the open incident to each other: both read
  // `?highlight=`, so switching surface keeps you on the same Einsatz instead of
  // making you find it again. Without a selection the links stay plain.
  const withSelection = (href: string) =>
    selectedIncidentId ? `${href}${href.includes('?') ? '&' : '?'}highlight=${selectedIncidentId}` : href;
  return (
    // Desktop only — on mobile navigation lives in the bottom navbar.
    <nav aria-label={t('main')} className="hidden md:flex items-center gap-1 md:gap-2">
        {/* Kanban Icon */}
        <Link href={withSelection('/')} prefetch={true} className={!hasSelectedEvent ? 'pointer-events-none' : ''}>
          <Button
            variant="ghost"
            size="icon"
            className={`rounded-lg h-9 w-9 md:h-10 md:w-10 ${currentPage === 'kanban' ? 'opacity-40 cursor-default' : !hasSelectedEvent ? 'opacity-40' : ''}`}
            disabled={currentPage === 'kanban' || !hasSelectedEvent}
            title={t('kanban')}
            aria-label={t('kanban')}
          >
            <Columns3 className="size-4" />
          </Button>
        </Link>

        {/* Map Icon */}
        <Link href={withSelection('/map')} prefetch={true} className={!hasSelectedEvent ? 'pointer-events-none' : ''}>
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
