'use client';

import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { apiClient, ApiPersonnel, ApiVehicle, ApiMaterialResource } from '@/lib/api-client';

interface Resource {
  id: string;
  name: string;
  status: string;
}

interface AssignmentSelectorProps {
  incidentId: string;
  onAssignmentComplete?: () => void;
}

export function AssignmentSelector({ incidentId, onAssignmentComplete }: AssignmentSelectorProps) {
  const [resourceType, setResourceType] = useState<'personnel' | 'vehicle' | 'material'>('personnel');
  const [resourceId, setResourceId] = useState('');
  const [personnel, setPersonnel] = useState<ApiPersonnel[]>([]);
  const [vehicles, setVehicles] = useState<ApiVehicle[]>([]);
  const [materials, setMaterials] = useState<ApiMaterialResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [assigning, setAssigning] = useState(false);
  // Track pending operations to prevent duplicate assignments
  const pendingOperationsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    loadResources();
  }, []);

  const loadResources = async () => {
    setLoading(true);
    try {
      const [personnelData, vehiclesData, materialsData] = await Promise.all([
        apiClient.getAllPersonnel(),
        apiClient.getVehicles(),
        apiClient.getAllMaterials(),
      ]);
      setPersonnel(personnelData);
      setVehicles(vehiclesData);
      setMaterials(materialsData);
    } catch (error) {
      console.error('Failed to load resources:', error);
    } finally {
      setLoading(false);
    }
  };

  const assign = async () => {
    if (!resourceId) return;

    // Create unique key for this resource
    const operationKey = `${resourceType}-${resourceId}`;

    // Check if operation is already pending
    if (pendingOperationsRef.current.has(operationKey)) {
      console.log(`Assignment for ${operationKey} is already pending`);
      return;
    }

    setAssigning(true);
    pendingOperationsRef.current.add(operationKey);

    try {
      const response = await apiClient.assignResource(incidentId, {
        resource_type: resourceType,
        resource_id: resourceId,
      });

      // Refresh resources to update availability status
      await loadResources();

      // Reset selection
      setResourceId('');

      // Notify parent component
      onAssignmentComplete?.();
    } catch (error: any) {
      // Only log non-409 errors (409 means already assigned, which is expected in race conditions)
      if (!error.message.includes('409') && !error.message.includes('already assigned')) {
        console.error('Failed to assign resource:', error);
      }
    } finally {
      setAssigning(false);
      pendingOperationsRef.current.delete(operationKey);
    }
  };

  const availableResources: Resource[] =
    resourceType === 'personnel'
      ? personnel
          .filter((p) => p.availability === 'available')
          .map((p) => ({ id: p.id, name: p.name, status: p.availability }))
      : resourceType === 'vehicle'
      ? vehicles
          .filter((v) => v.status === 'available')
          .map((v) => ({ id: v.id, name: v.name, status: v.status }))
      : materials
          .filter((m) => m.status === 'available')
          .map((m) => ({ id: m.id, name: m.name, status: m.status }));

  if (loading) {
    return <div className="text-sm text-muted-foreground">Loading resources...</div>;
  }

  return (
    <div className="flex gap-2">
      <Select value={resourceType} onValueChange={(value) => {
        setResourceType(value as 'personnel' | 'vehicle' | 'material');
        setResourceId(''); // Reset resource selection when type changes
      }}>
        <SelectTrigger className="w-[180px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="personnel">Personnel</SelectItem>
          <SelectItem value="vehicle">Vehicle</SelectItem>
          <SelectItem value="material">Material</SelectItem>
        </SelectContent>
      </Select>

      <Select value={resourceId} onValueChange={setResourceId}>
        <SelectTrigger className="flex-1">
          <SelectValue placeholder={`Select ${resourceType}`} />
        </SelectTrigger>
        <SelectContent>
          {availableResources.length === 0 ? (
            <SelectItem value="_none" disabled>
              No available {resourceType}
            </SelectItem>
          ) : (
            availableResources.map((r) => (
              <SelectItem key={r.id} value={r.id}>
                {r.name}
              </SelectItem>
            ))
          )}
        </SelectContent>
      </Select>

      <Button onClick={assign} disabled={!resourceId || assigning}>
        {assigning ? 'Assigning...' : 'Assign'}
      </Button>
    </div>
  );
}
