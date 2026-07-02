'use client';

import { useEffect, useMemo, useState } from 'react';
import { useEvent } from '@/lib/contexts/event-context';
import { useOperations, type Operation } from '@/lib/contexts/operations-context';
import { apiClient } from '@/lib/api-client';
import { nextAction, secondsInStep, isActionDue, stepStartedAt, type NextAction } from '@/lib/training-lifecycle';
import { getTimeSince } from '@/lib/kanban-utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { Separator } from '@/components/ui/separator';
import { OPERATION_STATUS_LABELS as STATUS_LABELS } from '@/lib/status-labels';
import {
  Users,
  ClipboardCheck,
  Bot,
  MapPin,
  Truck,
  Flag,
  ChevronRight,
} from 'lucide-react';

// Icon per field-action key — keeps the button scannable at a glance.
const ACTION_ICONS: Record<string, typeof MapPin> = {
  reko_arrived: MapPin,
  reko_report: ClipboardCheck,
  vehicle_on_scene: Truck,
  field_complete: Flag,
};

export function TrainingSimulationControls() {
  const { selectedEvent } = useEvent();
  const { operations, changeStatusToTop } = useOperations();
  const [isCheckingIn, setIsCheckingIn] = useState(false);
  // Track per-incident advance state so each row's button spins independently.
  const [advancingIds, setAdvancingIds] = useState<Set<string>>(new Set());
  const [checkinCount, setCheckinCount] = useState(10);

  // 1 Hz clock so "due" recomputes and the elapsed timers tick live.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Build the conductor list: every open incident with its single next
  // milestone, sorted due-first then longest-waiting-first so the most
  // "overdue" incident sits at the top, ready to advance.
  const rows = useMemo(() => {
    const built = operations
      .map((op) => {
        const action = nextAction(op);
        if (!action) return null;
        const secs = secondsInStep(op, now);
        return { op, action, secs, due: isActionDue(op, action, now) };
      })
      .filter((r): r is { op: Operation; action: NextAction; secs: number | null; due: boolean } => r !== null);

    return built.sort((a, b) => {
      if (a.due !== b.due) return a.due ? -1 : 1;
      return (b.secs ?? Number.MAX_SAFE_INTEGER) - (a.secs ?? Number.MAX_SAFE_INTEGER);
    });
  }, [operations, now]);

  if (!selectedEvent?.training_flag) {
    return null;
  }

  const setAdvancing = (id: string, on: boolean) =>
    setAdvancingIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const handleAdvance = async (op: Operation, action: NextAction) => {
    if (!selectedEvent) return;

    // Plain status transitions reuse the optimistic one-click board move.
    if (action.kind === 'status' && action.targetStatus) {
      changeStatusToTop(op.id, action.targetStatus);
      return;
    }

    // Field reports hit the backend; the board refreshes via WS/poll.
    setAdvancing(op.id, true);
    try {
      if (action.kind === 'reko_arrived') {
        await apiClient.simulateRekoArrived(selectedEvent.id, op.id);
      } else if (action.kind === 'reko_report') {
        await apiClient.simulateReko(selectedEvent.id, op.id);
      } else if (action.kind === 'field_complete') {
        await apiClient.simulateFieldComplete(selectedEvent.id, op.id);
      }
    } catch (error: unknown) {
      console.error('Failed to advance incident:', error);
      const detail = error instanceof Error ? error.message : 'Aktion fehlgeschlagen';
      toast.error('Fehler', { description: detail });
    } finally {
      setAdvancing(op.id, false);
    }
  };

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
        {/* Conductor console — one recommended next step per open incident,
            most-overdue first. Due rows are highlighted; a tap advances. */}
        <div className="space-y-2">
          <Label className="flex items-center gap-2">
            <ChevronRight className="h-4 w-4" />
            Nächste Aktionen
          </Label>
          {rows.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Keine offene Feldaktion. Reko aufbieten / disponieren macht der Operator am Board.
            </p>
          ) : (
            <>
              <div className="space-y-1.5">
                {rows.map(({ op, action, due }) => {
                  const busy = advancingIds.has(op.id);
                  const Icon = ACTION_ICONS[action.key] ?? ChevronRight;
                  const started = stepStartedAt(op);
                  return (
                    <div
                      key={op.id}
                      className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm ${
                        due ? 'border-amber-400/70 bg-amber-50/60 dark:bg-amber-950/30' : 'border-border'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium" title={op.location}>
                          {op.location || op.incidentType}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {STATUS_LABELS[op.status]}
                          {started && ` · seit ${getTimeSince(started)}`}
                        </div>
                      </div>
                      <Button
                        onClick={() => handleAdvance(op, action)}
                        disabled={busy}
                        variant={due ? 'default' : 'outline'}
                        size="sm"
                        className="flex-shrink-0"
                        title={due ? 'Empfohlene nächste Aktion' : undefined}
                      >
                        <Icon className="mr-1.5 h-3.5 w-3.5" />
                        {action.label}
                        {busy && <span className="ml-1.5 text-xs opacity-70">…</span>}
                      </Button>
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                Nur Feldaktionen. Hervorgehoben = fällig (Wartezeit erreicht). &quot;Einsatz beendet&quot; meldet nur — der Operator schliesst den Einsatz ab.
              </p>
            </>
          )}
        </div>

        <Separator />

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
      </CardContent>
    </Card>
  );
}
