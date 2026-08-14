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
import { Map as MapIcon, Columns3, Calendar, type LucideIcon } from 'lucide-react';
import Link from 'next/link';

/**
 * One icon in the top navigation.
 *
 * A link styled as a button, never a button inside a link: nesting the two gave
 * every item two tab stops, left the anchor without an accessible name, and —
 * worst — kept the current page's anchor navigable while its button sat
 * `disabled`. When the target is where you already are (or there is no event to
 * show), it renders as a genuinely inert button carrying `aria-current`.
 */
function NavIcon({
  href,
  label,
  icon: Icon,
  current,
  unavailable = false,
}: {
  href: string;
  label: string;
  icon: LucideIcon;
  current: boolean;
  unavailable?: boolean;
}) {
  const sizing = 'rounded-lg h-9 w-9 md:h-10 md:w-10';
  if (current || unavailable) {
    return (
      <Button
        variant="ghost"
        size="icon"
        className={`${sizing} opacity-40`}
        disabled
        aria-current={current ? 'page' : undefined}
        aria-label={label}
        title={label}
      >
        <Icon className="size-4" />
      </Button>
    );
  }
  return (
    <Button asChild variant="ghost" size="icon" className={sizing}>
      <Link href={href} prefetch={true} aria-label={label} title={label}>
        <Icon className="size-4" />
      </Link>
    </Button>
  );
}

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
        <NavIcon
          href={withSelection('/')}
          label={t('kanban')}
          icon={Columns3}
          current={currentPage === 'kanban'}
          unavailable={!hasSelectedEvent}
        />

        <NavIcon
          href={withSelection('/map')}
          label={t('map')}
          icon={MapIcon}
          current={currentPage === 'map'}
          unavailable={!hasSelectedEvent}
        />

        <NavIcon
          href="/events"
          label={t('events')}
          icon={Calendar}
          current={currentPage === 'events'}
        />

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
