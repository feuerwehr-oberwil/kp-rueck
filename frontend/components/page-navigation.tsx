'use client';

/**
 * Page Navigation Component
 * Consistent navigation across all pages with map/list icons, help button, and UserMenu
 */

import { Button } from '@/components/ui/button';
import { UserMenu } from '@/components/user-menu';
import { NotificationSidebar } from '@/components/notifications/notification-sidebar';
import { NavbarSyncIndicator } from '@/components/sync/navbar-sync-indicator';
import { Map as MapIcon, List, HelpCircle, Calendar, LayoutGrid } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Kbd } from '@/components/ui/kbd';

interface PageNavigationProps {
  currentPage: 'kanban' | 'map' | 'events' | 'settings' | 'combined' | 'training' | 'stats';
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

        {/* Sync Status Indicator */}
        <NavbarSyncIndicator />

        {/* Notification Sidebar */}
        <NotificationSidebar />

        {/* User Menu (Cog Dropdown) */}
        <UserMenu />
      </div>

      {/* Default Shortcuts Modal (if no custom handler provided) */}
      {!onShortcutsOpen && (
        <Dialog open={shortcutsModalOpen} onOpenChange={setShortcutsModalOpen}>
          <DialogContent className="max-w-xl">
            <DialogHeader>
              <DialogTitle className="text-2xl">Schnellreferenz</DialogTitle>
              <DialogDescription>
                Die wichtigsten Tastaturkürzel
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              {/* Pointer to Cmd+K */}
              <div className="rounded-lg bg-blue-500/10 border border-blue-500/30 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Kbd className="bg-blue-500/20">⌘K</Kbd>
                  <span className="text-sm font-semibold">Alle Befehle & Tastaturkürzel</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Drücke Cmd+K (Mac) oder Ctrl+K (Windows) für die vollständige Liste
                </p>
              </div>

              {/* Essential shortcuts */}
              <div>
                <h3 className="font-semibold text-xs text-muted-foreground uppercase tracking-wide mb-2">Häufig verwendet</h3>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between p-2 rounded-md bg-secondary/30">
                    <span className="text-sm">Suchen</span>
                    <Kbd className="h-5 text-xs">/</Kbd>
                  </div>
                  <div className="flex items-center justify-between p-2 rounded-md bg-secondary/30">
                    <span className="text-sm">Neuer Einsatz</span>
                    <Kbd className="h-5 text-xs">N</Kbd>
                  </div>
                  <div className="flex items-center justify-between p-2 rounded-md bg-secondary/30">
                    <span className="text-sm">Bearbeiten</span>
                    <Kbd className="h-5 text-xs">E</Kbd>
                  </div>
                  <div className="flex items-center justify-between p-2 rounded-md bg-secondary/30">
                    <span className="text-sm">Navigation (Kanban → Map → Events)</span>
                    <Kbd className="h-5 text-xs">G dann K/M/E</Kbd>
                  </div>
                  <div className="flex items-center justify-between p-2 rounded-md bg-secondary/30">
                    <span className="text-sm">Aktualisieren</span>
                    <Kbd className="h-5 text-xs">R</Kbd>
                  </div>
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
