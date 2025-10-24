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
import { Button } from '@/components/ui/button';
import { ArrowLeft, Users } from 'lucide-react';
import Link from 'next/link';

export default function ResourcesPage() {
  return (
    <ProtectedRoute>
      <div className="flex h-screen flex-col bg-background text-foreground">
        {/* Header */}
        <header className="flex items-center justify-between border-b border-border/50 bg-card/50 backdrop-blur-sm px-6 py-4">
          <div className="flex items-center gap-4">
            <Link href="/">
              <Button variant="ghost" size="icon">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-cyan-600 text-2xl shadow-lg">
                <Users className="h-6 w-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight">Ressourcenverwaltung</h1>
                <p className="text-sm text-muted-foreground">
                  Personal, Fahrzeuge und Material verwalten
                </p>
              </div>
            </div>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-auto p-6">
          <div className="max-w-7xl mx-auto">
            <Tabs defaultValue="personnel" className="w-full">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="personnel">Personal</TabsTrigger>
                <TabsTrigger value="vehicles">Fahrzeuge</TabsTrigger>
                <TabsTrigger value="materials">Material</TabsTrigger>
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
