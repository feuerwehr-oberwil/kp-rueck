'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PersonnelSettings } from '@/components/settings/personnel-settings';
import { VehicleSettings } from '@/components/settings/vehicle-settings';
import { MaterialSettings } from '@/components/settings/material-settings';

export default function ResourcesPage() {
  return (
    <div className="container mx-auto py-8">
      <h1 className="text-3xl font-bold mb-6">Resource Management</h1>

      <Tabs defaultValue="personnel" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="personnel">Personnel</TabsTrigger>
          <TabsTrigger value="vehicles">Vehicles</TabsTrigger>
          <TabsTrigger value="materials">Materials</TabsTrigger>
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
  );
}
