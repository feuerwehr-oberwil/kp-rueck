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

/** Shared geometry for the three items inside the segmented track. */
/**
 * Geometry for the three items inside the track.
 *
 * The row has to stay exactly as tall as it was, or the header grows and every
 * page behind it shifts down — 6px, measured, when this first went in. The old
 * bare buttons took the `icon` size, whose `min-h-[44px]` is a MINIMUM: an
 * `h-9` written beside it does nothing, so they were 44px however they were
 * spelled. The track's items therefore drop to `icon-sm` (36px) and the
 * track's own `p-1` makes up the difference: 36 + 4 + 4 = the same 44px.
 *
 * That takes the click target 44 → 36px, which is right here and nowhere else:
 * this nav is `hidden md:flex`, i.e. desktop only, and KP Rück is deliberately
 * not sized around touch targets (CLAUDE.md, «Users»).
 */
const NAV_ITEM = 'rounded-lg';

/**
 * One icon in the top navigation, in one of three states.
 *
 * A link styled as a button, never a button inside a link: nesting the two gave
 * every item two tab stops, left the anchor without an accessible name, and —
 * worst — kept the current page's anchor navigable while its button sat
 * `disabled`. Both inert states below are therefore a real `<button disabled>`,
 * never an anchor.
 *
 * - `current` — the raised tile of the segmented track: `bg-background` plus
 *   `shadow-sm`, the same «you are here» treatment as the display tabs
 *   (`app/display/layout.tsx`) and the settings sidebar. Inert, carries
 *   `aria-current="page"`, and keeps its glyph at FULL opacity (hence
 *   `disabled:opacity-100`) — you are on this page, nothing is withheld.
 * - `unavailable` — no Ereignis picked, so Board and Karte have nothing to
 *   show: inert and dimmed to `opacity-40`, with no tile and no `aria-current`.
 *   These two states used to render identically, which left «you are here» and
 *   «pick an event first» indistinguishable to anyone not using a screen reader.
 * - otherwise — a plain ghost link, no tile. Its hover cannot be the ghost
 *   variant's `bg-muted`: that is exactly the track's own colour, so the hover
 *   would be invisible inside it.
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
  if (current || unavailable) {
    return (
      <Button
        variant="ghost"
        size="icon-sm"
        className={`${NAV_ITEM} ${
          current
            ? 'bg-background text-foreground shadow-sm disabled:opacity-100'
            : 'opacity-40'
        }`}
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
    <Button
      asChild
      variant="ghost"
      size="icon-sm"
      className={`${NAV_ITEM} text-muted-foreground hover:bg-background/50 hover:text-foreground`}
    >
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
  //
  // Encoded because the id makes a round trip through the URL — the other
  // surface reads it back out of `?highlight=` — and an id carrying `&` or `#`
  // would otherwise end the parameter and silently drop the rest of the link.
  const withSelection = (href: string) =>
    selectedIncidentId
      ? `${href}${href.includes('?') ? '&' : '?'}highlight=${encodeURIComponent(selectedIncidentId)}`
      : href;
  return (
    // Desktop only — on mobile navigation lives in the bottom navbar.
    <nav aria-label={t('main')} className="hidden md:flex items-center gap-1 md:gap-2">
        {/* The three destinations sit in a recessed track, so the raised tile can
            say «you are here». Only these three: the cog and the bell are
            actions, not destinations, and belong outside it. Same track as the
            display tabs in app/display/layout.tsx — minus their border, which
            would add the 2px that pushed every page down behind the header. */}
        <div className="flex items-center gap-0.5 rounded-xl bg-muted/50 p-1">
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
        </div>

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
