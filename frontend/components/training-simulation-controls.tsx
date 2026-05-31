'use client';

import { useState } from 'react';
import { useEvent } from '@/lib/contexts/event-context';
import { useOperations } from '@/lib/contexts/operations-context';
import { apiClient } from '@/lib/api-client';
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

export function TrainingSimulationControls() {
  const { selectedEvent } = useEvent();
  const { operations } = useOperations();
  const [isCheckingIn, setIsCheckingIn] = useState(false);
  // Track per-incident submit state so each row's button can show its own
  // loading spinner without locking out the others.
  const [submittingRekoIds, setSubmittingRekoIds] = useState<Set<string>>(new Set());
  const [checkinCount, setCheckinCount] = useState(10);

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
      }
    } catch (error) {
      console.error('Failed to simulate check-in:', error);
      toast.error('Fehler beim Simulieren der Check-ins');
    } finally {
      setIsCheckingIn(false);
    }
  };

  const handleSimulateReko = async (incidentId: string) => {
    if (!selectedEvent) return;
    setSubmittingRekoIds((prev) => new Set(prev).add(incidentId));
    try {
      await apiClient.simulateReko(selectedEvent.id, incidentId);
    } catch (error: unknown) {
      console.error('Failed to simulate reko:', error);
      const detail = error instanceof Error ? error.message : 'Reko-Simulation fehlgeschlagen';
      toast.error('Fehler', { description: detail });
    } finally {
      setSubmittingRekoIds((prev) => {
        const next = new Set(prev);
        next.delete(incidentId);
        return next;
      });
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
              size="sm"
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

        {/* Reko Report Simulation — one button per Reko incident, single click
            fills + submits (no dropdown, no confirmation step). */}
        <div className="space-y-2">
          <Label className="flex items-center gap-2">
            <ClipboardCheck className="h-4 w-4" />
            Reko-Bericht ausfüllen
          </Label>
          {rekoOps.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Keine Einsätze im Status &quot;Reko&quot; vorhanden.
            </p>
          ) : (
            <>
              <div className="space-y-1.5">
                {rekoOps.map((op) => {
                  const submitting = submittingRekoIds.has(op.id);
                  return (
                    <Button
                      key={op.id}
                      onClick={() => handleSimulateReko(op.id)}
                      disabled={submitting}
                      variant="outline"
                      className="w-full justify-start text-left h-auto py-2"
                    >
                      <ClipboardCheck className="mr-2 h-4 w-4 flex-shrink-0" />
                      <span className="flex-1 truncate">
                        {op.location || op.incidentType}
                      </span>
                      {submitting && (
                        <span className="ml-2 text-xs text-muted-foreground">…</span>
                      )}
                    </Button>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                Klick füllt + reicht den Bericht ein. Einsatz geht auf &quot;Reko abgeschlossen&quot;.
              </p>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
