'use client';

/**
 * Resource Management Page
 * Manages personnel, vehicles, and materials
 * Only accessible to editors
 */

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PersonnelSettings } from '@/components/settings/personnel-settings';
import { VehicleSettings } from '@/components/settings/vehicle-settings';
import { MaterialSettings } from '@/components/settings/material-settings';
import { ProtectedRoute } from '@/components/protected-route';
import { PageNavigation } from '@/components/page-navigation';
import { MobileNavigation } from '@/components/mobile-navigation';
import { Button } from '@/components/ui/button';
import { Users } from 'lucide-react';
import Link from 'next/link';
import { useEvent } from '@/lib/contexts/event-context';
import { useIsMobile } from '@/components/ui/use-mobile';

export default function ResourcesPage() {
  const { selectedEvent } = useEvent();
  const isMobile = useIsMobile();

  return (
    <ProtectedRoute>
      <div className="flex h-screen flex-col bg-background text-foreground">
        {/* Header */}
        <header className="flex items-center justify-between border-b border-border/50 bg-card/50 backdrop-blur-sm px-4 md:px-6 py-4 min-h-20">
          <div className="flex items-center gap-2 md:gap-4 min-w-0 flex-1">
            <div className="flex items-center gap-2 md:gap-3 min-w-0">
              <div className="flex h-9 w-9 md:h-11 md:w-11 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-cyan-600 text-2xl shadow-lg flex-shrink-0">
                <Users className="h-5 w-5 md:h-6 md:w-6 text-white" />
              </div>
              <div className="min-w-0">
                <h1 className="text-lg md:text-2xl font-bold tracking-tight truncate">Ressourcenverwaltung</h1>
                <p className="text-xs md:text-sm text-muted-foreground hidden sm:block">
                  Personal, Fahrzeuge und Material verwalten
                </p>
              </div>
            </div>
          </div>

          <div className="flex-shrink-0">
            {/* Desktop Navigation */}
            {!isMobile && (
              <PageNavigation currentPage="resources" hasSelectedEvent={!!selectedEvent} />
            )}

            {/* Mobile Navigation */}
            {isMobile && (
              <MobileNavigation hasSelectedEvent={!!selectedEvent} />
            )}
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-auto p-4 md:p-6">
          <div className="max-w-7xl mx-auto">
            <Tabs defaultValue="personnel" className="w-full">
              <TabsList className="grid w-full grid-cols-3 mb-4 md:mb-6">
                <TabsTrigger value="personnel" className="text-xs md:text-sm">Personal</TabsTrigger>
                <TabsTrigger value="vehicles" className="text-xs md:text-sm">Fahrzeuge</TabsTrigger>
                <TabsTrigger value="materials" className="text-xs md:text-sm">Material</TabsTrigger>
              </TabsList>

              <TabsContent value="personnel">
                <PersonnelSettings />
              </TabsContent>

              <TabsContent value="vehicles">
                <VehicleSettings />
              </TabsContent>

              <TabsContent value="materials">
                <MaterialSettings />
              </TabsContent>
            </Tabs>
          </div>
        </main>
      </div>
    </ProtectedRoute>
  );
}
