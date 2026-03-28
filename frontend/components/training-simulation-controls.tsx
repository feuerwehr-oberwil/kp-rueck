'use client';

import { useState, useEffect, useCallback } from 'react';
import { useEvent } from '@/lib/contexts/event-context';
import { useOperations } from '@/lib/contexts/operations-context';
import { apiClient, type ApiIncident } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { Separator } from '@/components/ui/separator';
import {
  Users,
  ClipboardCheck,
  Bot,
} from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export function TrainingSimulationControls() {
  const { selectedEvent } = useEvent();
  const { operations } = useOperations();
  const [isCheckingIn, setIsCheckingIn] = useState(false);
  const [isSubmittingReko, setIsSubmittingReko] = useState(false);
  const [checkinCount, setCheckinCount] = useState(10);
  const [rekoIncidents, setRekoIncidents] = useState<ApiIncident[]>([]);
  const [selectedIncidentId, setSelectedIncidentId] = useState<string>('');

  if (!selectedEvent?.training_flag) {
    return null;
  }

  // Derive reko incidents from operations context (status "ready" = backend "reko")
  const rekoOps = operations.filter(op => op.status === 'ready');

  const handleSimulateCheckin = async () => {
    if (!selectedEvent) return;
    setIsCheckingIn(true);
    try {
      const result = await apiClient.simulateCheckin(selectedEvent.id, checkinCount);

      if (result.checked_in.length === 0) {
        toast.info('Keine weiteren Personen verfügbar', {
          description: 'Alle verfügbaren Personen sind bereits eingecheckt.',
        });
      } else {
        toast.success(`${result.checked_in.length} Person(en) eingecheckt`, {
          description: (
            <div className="mt-1 space-y-0.5">
              <div className="text-xs text-muted-foreground">
                {result.total_checked_in} von {result.total_available} total eingecheckt
              </div>
              {result.checked_in.length <= 5 && (
                <div className="text-xs">
                  {result.checked_in.join(', ')}
                </div>
              )}
            </div>
          ),
          duration: 4000,
        });
      }
    } catch (error) {
      console.error('Failed to simulate check-in:', error);
      toast.error('Fehler beim Simulieren der Check-ins');
    } finally {
      setIsCheckingIn(false);
    }
  };

  const handleSimulateReko = async () => {
    if (!selectedEvent || !selectedIncidentId) return;
    setIsSubmittingReko(true);
    try {
      const result = await apiClient.simulateReko(selectedEvent.id, selectedIncidentId);

      toast.success('Reko-Bericht eingereicht', {
        description: (
          <div className="mt-1 space-y-0.5">
            <div className="font-medium text-sm">{result.incident_title}</div>
            {result.summary_text && (
              <div className="text-xs text-muted-foreground line-clamp-2">{result.summary_text}</div>
            )}
          </div>
        ),
        duration: 5000,
      });

      // Clear selection since this incident is no longer in reko status
      setSelectedIncidentId('');
    } catch (error: any) {
      console.error('Failed to simulate reko:', error);
      const detail = error?.message || 'Reko-Simulation fehlgeschlagen';
      toast.error('Fehler', { description: detail });
    } finally {
      setIsSubmittingReko(false);
    }
  };

  return (
    <Card className="mt-4">
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-purple-600" />
            Feld-Simulation
          </CardTitle>
          <CardDescription>
            Simuliert Aktionen, die normalerweise von Personen im Feld ausgeführt werden
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Personnel Check-In Simulation */}
        <div className="space-y-2">
          <Label className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            Personal einchecken
          </Label>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={1}
              max={50}
              value={checkinCount}
              onChange={(e) => setCheckinCount(Math.max(1, Math.min(50, parseInt(e.target.value) || 1)))}
              className="w-20"
            />
            <Button
              onClick={handleSimulateCheckin}
              disabled={isCheckingIn}
              variant="outline"
              className="flex-1"
            >
              <Users className="mr-2 h-4 w-4" />
              {isCheckingIn ? 'Wird eingecheckt...' : 'Einchecken'}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Checkt zufällige verfügbare Personen ein
          </p>
        </div>

        <Separator />

        {/* Reko Report Simulation */}
        <div className="space-y-2">
          <Label className="flex items-center gap-2">
            <ClipboardCheck className="h-4 w-4" />
            Reko-Bericht ausfüllen
          </Label>
          {rekoOps.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Keine Einsätze im Status &quot;Reko&quot; vorhanden.
              Verschiebe einen Einsatz in den Reko-Status, um hier einen Bericht zu simulieren.
            </p>
          ) : (
            <>
              <Select
                value={selectedIncidentId}
                onValueChange={setSelectedIncidentId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Einsatz auswählen..." />
                </SelectTrigger>
                <SelectContent>
                  {rekoOps.map(op => (
                    <SelectItem key={op.id} value={op.id}>
                      <span className="truncate">
                        {op.incidentType} — {op.location || 'Kein Ort'}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                onClick={handleSimulateReko}
                disabled={isSubmittingReko || !selectedIncidentId}
                variant="outline"
                className="w-full"
              >
                <ClipboardCheck className="mr-2 h-4 w-4" />
                {isSubmittingReko ? 'Wird ausgefüllt...' : 'Reko ausfüllen'}
              </Button>
              <p className="text-xs text-muted-foreground">
                Simuliert Ankunft und füllt einen Reko-Bericht mit Zufallsdaten aus.
                Der Einsatz wird automatisch auf &quot;Reko abgeschlossen&quot; gesetzt.
              </p>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
