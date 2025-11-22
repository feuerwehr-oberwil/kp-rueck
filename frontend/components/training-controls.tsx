'use client';

import { useState, useEffect } from 'react';
import { useEvent } from '@/lib/contexts/event-context';
import { useNotifications } from '@/lib/contexts/notification-context';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Separator } from '@/components/ui/separator';
import {
  Zap,
  Flame,
  Droplet,
  Sparkles,
} from 'lucide-react';

export function TrainingControls() {
  const { selectedEvent } = useEvent();
  const { refetchNotifications } = useNotifications();
  const [isGenerating, setIsGenerating] = useState(false);

  if (!selectedEvent?.training_flag) {
    return null; // Only show for training events
  }

  const handleGenerateNormal = async () => {
    setIsGenerating(true);
    try {
      console.log('🚀 Generating normal training emergency...');
      const incidents = await apiClient.generateTrainingEmergency(selectedEvent.id, { category: 'normal', count: 1 });
      const incident = incidents[0];
      console.log('✓ Normal training emergency created:', incident.title, 'at', incident.location_address);

      // Refetch notifications to show the new alarm
      await refetchNotifications();

      toast.success('✓ Normal-Einsatz erstellt', {
        description: (
          <div className="mt-2 space-y-1">
            <div className="font-semibold">{incident.title}</div>
            {incident.location_address && <div className="text-sm text-muted-foreground">{incident.location_address}</div>}
          </div>
        ),
        duration: 5000,
      });
    } catch (error) {
      console.error('❌ Failed to generate emergency:', error);
      toast.error('Fehler', {
        description: 'Einsatz konnte nicht generiert werden',
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGenerateCritical = async () => {
    setIsGenerating(true);
    try {
      console.log('🚀 Generating critical training emergency...');
      const incidents = await apiClient.generateTrainingEmergency(selectedEvent.id, { category: 'critical', count: 1 });
      const incident = incidents[0];
      console.log('✓ Critical training emergency created:', incident.title, 'at', incident.location_address);

      // Refetch notifications to show the new alarm
      await refetchNotifications();

      toast.success('✓ Kritischer Einsatz erstellt', {
        description: (
          <div className="mt-2 space-y-1">
            <div className="font-semibold">{incident.title}</div>
            {incident.location_address && <div className="text-sm text-muted-foreground">{incident.location_address}</div>}
          </div>
        ),
        duration: 5000,
      });
    } catch (error) {
      console.error('❌ Failed to generate emergency:', error);
      toast.error('Fehler', {
        description: 'Einsatz konnte nicht generiert werden',
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGenerateBurst = async () => {
    setIsGenerating(true);
    try {
      console.log('🚀 Generating burst of 5 training emergencies...');
      const incidents = await apiClient.generateTrainingEmergency(selectedEvent.id, { category: null, count: 5 });
      console.log(`✓ ${incidents.length} training emergencies created:`, incidents.map(i => i.title).join(', '));

      // Refetch notifications to show the new alarms
      await refetchNotifications();

      toast.success(`✓ ${incidents.length} Einsätze erstellt`, {
        description: (
          <div className="mt-2 space-y-1">
            {incidents.map((inc, idx) => (
              <div key={inc.id} className="text-sm">
                {idx + 1}. {inc.title}
              </div>
            ))}
          </div>
        ),
        duration: 6000,
      });
    } catch (error) {
      console.error('❌ Failed to generate burst:', error);
      toast.error('Fehler', {
        description: 'Burst konnte nicht generiert werden',
      });
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-orange-600" />
            Übungs-Steuerung
          </CardTitle>
          <CardDescription>
            Manuelle Einsatz-Generierung für Training
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Manual Generation Buttons */}
        <div className="space-y-2">
          <Label>Einzelne Einsätze generieren</Label>
          <div className="grid grid-cols-2 gap-2">
            <Button
              onClick={handleGenerateNormal}
              disabled={isGenerating}
              variant="outline"
              className="w-full"
            >
              <Droplet className="mr-2 h-4 w-4 text-blue-600" />
              Normal
            </Button>
            <Button
              onClick={handleGenerateCritical}
              disabled={isGenerating}
              variant="outline"
              className="w-full"
            >
              <Flame className="mr-2 h-4 w-4 text-red-600" />
              Kritisch
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Normal: Wasser, Sturm, Baum | Kritisch: Brand, BMA, Personenrettung
          </p>
        </div>

        <Separator />

        {/* Burst Generation */}
        <div className="space-y-2">
          <Label>Mehrere Einsätze gleichzeitig</Label>
          <Button
            onClick={handleGenerateBurst}
            disabled={isGenerating}
            variant="secondary"
            className="w-full"
          >
            <Zap className="mr-2 h-4 w-4" />
            Burst (5x zufällig)
          </Button>
          <p className="text-xs text-muted-foreground">
            Generiert 5 zufällige Einsätze gleichzeitig
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
