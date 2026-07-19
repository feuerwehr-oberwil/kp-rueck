'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useEvent } from '@/lib/contexts/event-context';
import { useOperations, type Operation } from '@/lib/contexts/operations-context';
import { apiClient, type ApiGpsSimDrive, type ApiVehicle } from '@/lib/api-client';
import { wsClient } from '@/lib/websocket-client';
import { useGpsSimSpeed } from '@/lib/hooks/use-gps-sim-speed';
import { formatEta, liveDrive } from '@/lib/gps-sim';
import { nextActions, secondsInStep, isActionDue, stepStartedAt, type NextAction } from '@/lib/training-lifecycle';
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
  Home,
  ChevronRight,
  AlertTriangle,
  Megaphone,
  Wrench,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// Icon per field-action key — keeps the button scannable at a glance.
const ACTION_ICONS: Record<string, typeof MapPin> = {
  reko_arrived: MapPin,
  reko_report: ClipboardCheck,
  drive_to_incident: Truck,
  vehicle_on_scene: Truck,
  field_complete: Flag,
  drive_to_magazin: Home,
};


export function TrainingSimulationControls() {
  const t = useTranslations('training.simulation');
  const tCommon = useTranslations('training.common');
  const { selectedEvent } = useEvent();
  const { operations, changeStatusToTop } = useOperations();
  const [isCheckingIn, setIsCheckingIn] = useState(false);
  // Track per-incident advance state so each row's button spins independently.
  const [advancingIds, setAdvancingIds] = useState<Set<string>>(new Set());
  const [checkinCount, setCheckinCount] = useState(10);
  // 0 = sofort; >0 = check-ins trickle in over this many minutes.
  const [checkinMinutes, setCheckinMinutes] = useState(0);

  // GPS drive simulation: vehicles for name→id lookup, active drives for the
  // per-row progress state. The backend refuses simulations in demo mode, so
  // the console falls back to the plain "Fahrzeug vor Ort" action there.
  const [vehicles, setVehicles] = useState<ApiVehicle[]>([]);
  const [drives, setDrives] = useState<ApiGpsSimDrive[]>([]);
  const [drivesFetchedAt, setDrivesFetchedAt] = useState(() => Date.now());
  const [gpsSimAvailable, setGpsSimAvailable] = useState(true);
  const [speedKmh] = useGpsSimSpeed();

  const refreshDrives = useCallback(async () => {
    try {
      setDrives(await apiClient.getGpsSimulations());
      setDrivesFetchedAt(Date.now());
    } catch {
      // Endpoint unavailable (old backend) — leave list as-is.
    }
  }, []);

  useEffect(() => {
    apiClient.getVehicles().then(setVehicles).catch(() => setVehicles([]));
    apiClient.getDemoStatus().then((status) => setGpsSimAvailable(!status?.demo)).catch(() => {});
    refreshDrives();
    const unsubscribe = wsClient.on('gps_sim_status', () => refreshDrives());
    const interval = setInterval(refreshDrives, 3000);
    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, [refreshDrives]);

  // 1 Hz clock so "due" recomputes and the elapsed timers tick live.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Build the conductor list: every open incident with its recommended field
  // actions (usually one; on scene both "Einsatz beendet" and "Rückfahrt"),
  // sorted due-first then longest-waiting-first so the most "overdue" incident
  // sits at the top, ready to advance. Each action carries its own drive state
  // — a rolling drive renders as progress instead of a button.
  const rows = useMemo(() => {
    const built = operations
      .map((op) => {
        const actions = nextActions(op, { gpsSim: gpsSimAvailable }).map((action) => {
          const driveKind = action.kind === 'gps_drive' ? 'incident' : action.kind === 'gps_return' ? 'magazin' : null;
          const actionDrives = driveKind
            ? drives.filter((d) => d.kind === driveKind && op.vehicles.includes(d.vehicle_name))
            : [];
          return { action, actionDrives };
        });
        if (actions.length === 0) return null;
        const secs = secondsInStep(op, now);
        // Due-ness follows the primary action, and only while it isn't rolling.
        const primary = actions[0];
        const due = primary.actionDrives.length === 0 && isActionDue(op, primary.action, now);
        return { op, actions, secs, due };
      })
      .filter(
        (
          r
        ): r is {
          op: Operation;
          actions: { action: NextAction; actionDrives: ApiGpsSimDrive[] }[];
          secs: number | null;
          due: boolean;
        } => r !== null
      );

    return built.sort((a, b) => {
      if (a.due !== b.due) return a.due ? -1 : 1;
      return (b.secs ?? Number.MAX_SAFE_INTEGER) - (a.secs ?? Number.MAX_SAFE_INTEGER);
    });
  }, [operations, now, drives, gpsSimAvailable]);

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
      if (action.kind === 'gps_drive' || action.kind === 'gps_return') {
        // Send every assigned vehicle that isn't already rolling on this leg.
        // Arrival/return then flows through the real GPS pipeline (geofence
        // prompts). A finished outbound drive is simply replaced by the return.
        const target = action.kind === 'gps_drive' ? 'incident' : 'magazin';
        const rolling = new Set(drives.filter((d) => d.kind === target).map((d) => d.vehicle_name));
        const toSend = vehicles.filter((v) => op.vehicles.includes(v.name) && !rolling.has(v.name));
        if (toSend.length === 0) {
          toast.error(t('noVehicleFound'), {
            description: t('noVehicleFoundDescription'),
          });
          return;
        }
        for (const vehicle of toSend) {
          await apiClient.startGpsSimulation({
            vehicle_id: vehicle.id,
            target,
            incident_id: target === 'incident' ? op.id : undefined,
            speed_kmh: speedKmh,
          });
        }
        await refreshDrives();
      } else if (action.kind === 'reko_arrived') {
        await apiClient.simulateRekoArrived(selectedEvent.id, op.id);
      } else if (action.kind === 'reko_report') {
        await apiClient.simulateReko(selectedEvent.id, op.id);
      } else if (action.kind === 'field_complete') {
        await apiClient.simulateFieldComplete(selectedEvent.id, op.id);
      }
    } catch (error: unknown) {
      console.error('Failed to advance incident:', error);
      const detail = error instanceof Error ? error.message : t('actionFailed');
      toast.error(tCommon('error'), { description: detail });
    } finally {
      setAdvancing(op.id, false);
    }
  };

  const handleSimulateCheckin = async () => {
    if (!selectedEvent) return;
    setIsCheckingIn(true);
    try {
      const result = await apiClient.simulateCheckin(selectedEvent.id, checkinCount, checkinMinutes);

      if ((result.scheduled?.length ?? 0) > 0) {
        toast.success(t('checkinsScheduled', { count: result.scheduled!.length }), {
          description: t('checkinsScheduledDescription', { minutes: result.trickle_minutes }),
        });
      } else if (result.checked_in.length === 0) {
        toast.info(t('noMorePersons'), {
          description: t('noMorePersonsDescription'),
        });
      }
    } catch (error: unknown) {
      console.error('Failed to simulate check-in:', error);
      const detail = error instanceof Error ? error.message : undefined;
      toast.error(t('checkinFailed'), { description: detail });
    } finally {
      setIsCheckingIn(false);
    }
  };

  // Trainer injects — surprises that force the operator to react. Escalation
  // and reinforcement are always available on an open incident; the breakdown
  // needs an assigned vehicle.
  const handleInject = async (
    op: Operation,
    inject: 'escalate' | 'reinforcement' | 'breakdown'
  ) => {
    if (!selectedEvent) return;
    setAdvancing(op.id, true);
    try {
      if (inject === 'escalate') {
        await apiClient.simulateEscalation(selectedEvent.id, op.id);
        toast.success(t('escalated'), {
          description: t('escalatedDescription'),
        });
      } else if (inject === 'reinforcement') {
        const result = await apiClient.simulateReinforcement(selectedEvent.id, op.id);
        toast.success(t('reinforcementRequested'), { description: result.message });
      } else {
        const result = await apiClient.simulateVehicleBreakdown(selectedEvent.id, op.id);
        toast.success(t('vehicleBrokenDown', { name: result.vehicle_name }), {
          description: t('vehicleBrokenDownDescription'),
        });
      }
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : t('injectFailed');
      toast.error(tCommon('error'), { description: detail });
    } finally {
      setAdvancing(op.id, false);
    }
  };

  return (
    <Card className="mt-4">
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-purple-600" />
            {t('title')}
          </CardTitle>
          <CardDescription>
            {t('description')}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Conductor console — one recommended next step per open incident,
            most-overdue first. Due rows are highlighted; a tap advances. */}
        <div className="space-y-2">
          <Label className="flex items-center gap-2">
            <ChevronRight className="h-4 w-4" />
            {t('nextActions')}
          </Label>
          {rows.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {t('noOpenActions')}
            </p>
          ) : (
            <>
              <div className="space-y-1.5">
                {rows.map(({ op, actions, due }) => {
                  const busy = advancingIds.has(op.id);
                  const started = stepStartedAt(op);
                  const anyRolling = actions.some((a) => a.actionDrives.length > 0);
                  return (
                    <div
                      key={op.id}
                      className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm ${
                        due
                          ? 'border-amber-400/70 bg-amber-50/60 dark:bg-amber-950/30'
                          : anyRolling
                            ? 'border-purple-400/70 bg-purple-50/60 dark:bg-purple-950/30'
                            : 'border-border'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium" title={op.location}>
                          {op.location || op.incidentType}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {STATUS_LABELS[op.status]}
                          {started && ` · ${t('since', { time: getTimeSince(started) })}`}
                          {/* The "beendet" report lives ONLY here — the board is
                              informed in the exercise itself (e.g. via radio). */}
                          {op.fieldCompleteReportedAt && op.status === 'active' && (
                            <span className="text-emerald-600 dark:text-emerald-400"> · {t('fieldComplete')}</span>
                          )}
                        </div>
                      </div>
                      {actions.map(({ action, actionDrives }, idx) => {
                        const Icon = ACTION_ICONS[action.key] ?? ChevronRight;
                        // A rolling drive replaces its action's button with live
                        // progress (slowest vehicle counts), ticking between polls.
                        if (actionDrives.length > 0) {
                          const slowest = actionDrives.reduce((a, b) => (a.eta_seconds >= b.eta_seconds ? a : b));
                          const live = liveDrive(slowest, drivesFetchedAt, now);
                          return (
                            <div key={action.key} className="flex-shrink-0 text-xs text-muted-foreground">
                              {slowest.kind === 'magazin' ? (
                                <Home className="mr-1 inline h-3.5 w-3.5 text-purple-600" />
                              ) : (
                                <Truck className="mr-1 inline h-3.5 w-3.5 text-purple-600" />
                              )}
                              {Math.round(live.progress * 100)}% · {formatEta(live.eta)}
                            </div>
                          );
                        }
                        const isPrimary = idx === 0;
                        return (
                          <Button
                            key={action.key}
                            onClick={() => handleAdvance(op, action)}
                            disabled={busy}
                            variant={due && isPrimary ? 'default' : 'outline'}
                            size="sm"
                            className="flex-shrink-0"
                            title={due && isPrimary ? t('recommendedAction') : undefined}
                          >
                            <Icon className="mr-1.5 h-3.5 w-3.5" />
                            {action.label}
                            {busy && <span className="ml-1.5 text-xs opacity-70">…</span>}
                          </Button>
                        );
                      })}
                      {/* Trainer injects: surprises the operator has to handle. */}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            className="flex-shrink-0 px-2"
                            title={t('injectTitle')}
                          >
                            <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuLabel>{t('inject')}</DropdownMenuLabel>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => handleInject(op, 'escalate')}>
                            <AlertTriangle className="mr-2 h-4 w-4 text-red-600" />
                            {t('injectEscalate')}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleInject(op, 'reinforcement')}>
                            <Megaphone className="mr-2 h-4 w-4 text-amber-600" />
                            {t('injectReinforcement')}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => handleInject(op, 'breakdown')}
                            disabled={op.vehicles.length === 0}
                          >
                            <Wrench className="mr-2 h-4 w-4 text-zinc-500" />
                            {t('injectBreakdown')}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                {t('footer')}
              </p>
            </>
          )}
        </div>

        <Separator />

        {/* Personnel Check-In Simulation */}
        <div className="space-y-2">
          <Label className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            {t('checkinLabel')}
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
            <Select
              value={String(checkinMinutes)}
              onValueChange={(v) => setCheckinMinutes(parseInt(v))}
            >
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">{t('immediately')}</SelectItem>
                <SelectItem value="5">{t('overMinutes', { count: 5 })}</SelectItem>
                <SelectItem value="10">{t('overMinutes', { count: 10 })}</SelectItem>
                <SelectItem value="15">{t('overMinutes', { count: 15 })}</SelectItem>
              </SelectContent>
            </Select>
            <Button
              onClick={handleSimulateCheckin}
              disabled={isCheckingIn}
              variant="outline"
              size="sm"
              className="flex-1"
            >
              <Users className="mr-2 h-4 w-4" />
              {isCheckingIn ? t('checkingIn') : t('checkin')}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {t('checkinHint')}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
