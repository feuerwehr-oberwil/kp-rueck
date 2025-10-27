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
import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Kbd } from '@/components/ui/kbd';

interface PageNavigationProps {
  currentPage: 'kanban' | 'map' | 'events' | 'settings' | 'combined';
  vehicleTypes?: Array<{ key: string; name: string }>;
  onShortcutsOpen?: () => void;
  hasSelectedEvent?: boolean;
}

export function PageNavigation({ currentPage, vehicleTypes = [], onShortcutsOpen, hasSelectedEvent = true }: PageNavigationProps) {
  const [shortcutsModalOpen, setShortcutsModalOpen] = useState(false);

  const handleShortcutsClick = () => {
    if (onShortcutsOpen) {
      onShortcutsOpen();
    } else {
      setShortcutsModalOpen(true);
    }
  };

  return (
    <>
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
        <Button
          variant="ghost"
          size="icon"
          onClick={handleShortcutsClick}
          className="rounded-lg"
          title="Hilfe"
        >
          <HelpCircle className="h-5 w-5" />
        </Button>

        {/* Notification Sidebar */}
        <NotificationSidebar />

        {/* User Menu (Cog Dropdown) */}
        <UserMenu />
      </div>

      {/* Default Shortcuts Modal (if no custom handler provided) */}
      {!onShortcutsOpen && (
        <Dialog open={shortcutsModalOpen} onOpenChange={setShortcutsModalOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle className="text-2xl">Tastaturkürzel & Hilfe</DialogTitle>
              <DialogDescription>Schnelle Navigation und nützliche Informationen</DialogDescription>
            </DialogHeader>

            <div className="space-y-6 py-4">
              <div>
                <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide mb-3">Navigation</h3>
                <div className="space-y-2">
                  <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/50">
                    <span className="text-sm font-medium">Suche fokussieren</span>
                    <Kbd>/</Kbd>
                  </div>
                  <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/50">
                    <span className="text-sm font-medium">Suche verlassen</span>
                    <Kbd>Esc</Kbd>
                  </div>
                  <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/50">
                    <span className="text-sm font-medium">Diese Hilfe anzeigen</span>
                    <Kbd>?</Kbd>
                  </div>
                </div>
              </div>

              {vehicleTypes.length > 0 && (
                <div>
                  <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide mb-3">
                    Fahrzeugzuweisung (Kanban)
                  </h3>
                  <div className="space-y-2">
                    {vehicleTypes.map((vt) => (
                      <div key={vt.key} className="flex items-center justify-between p-3 rounded-lg bg-secondary/50">
                        <span className="text-sm font-medium">{vt.name}</span>
                        <Kbd>{vt.key}</Kbd>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
