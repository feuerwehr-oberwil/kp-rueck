'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useEvent } from '@/lib/contexts/event-context';
import { useOperations } from '@/lib/contexts/operations-context';
import { apiClient, type ApiGpsSimDrive, type ApiVehicle } from '@/lib/api-client';
import { wsClient } from '@/lib/websocket-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { toast } from 'sonner';
import { Satellite, Play, Square, Home, Gauge, Lock } from 'lucide-react';
import { useGpsSimSpeed, GPS_SIM_SPEED_MIN, GPS_SIM_SPEED_MAX } from '@/lib/hooks/use-gps-sim-speed';
import { formatEta, liveDrive } from '@/lib/gps-sim';
import { formatLocationForDisplay, getGlobalHomeCity } from '@/lib/utils';

const MAGAZIN_TARGET = '__magazin__';

/**
 * GPS-Simulation (Übungssteuerung): send a vehicle on a simulated drive to a
 * training incident or back to the magazin. The backend feeds the simulated
 * positions through the exact same pipeline as real Traccar data, so trainees
 * see the real deal — map movement, distance labels, geofence notification and
 * the arrival/return prompts.
 */
export function TrainingGpsSimulation() {
  const t = useTranslations('training.gpsSim');
  const tCommon = useTranslations('training.common');
  const { selectedEvent } = useEvent();
  const { operations } = useOperations();
  const [vehicles, setVehicles] = useState<ApiVehicle[]>([]);
  const [drives, setDrives] = useState<ApiGpsSimDrive[]>([]);
  const [drivesFetchedAt, setDrivesFetchedAt] = useState(() => Date.now());
  const [targets, setTargets] = useState<Record<string, string>>({}); // vehicleId -> target value
  // Global tempo, shared with the Nächste-Aktionen console (persisted).
  const [speedKmh, setSpeedKmh] = useGpsSimSpeed();
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  // The backend refuses simulated drives in demo mode. Ask up front so the
  // rows render disabled with a reason instead of failing on click.
  const [demoLocked, setDemoLocked] = useState(false);

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
    apiClient.getDemoStatus().then((status) => setDemoLocked(!!status?.demo)).catch(() => {});
    refreshDrives();
    // Live status via WS, plus a light poll so drive states stay fresh.
    const unsubscribe = wsClient.on('gps_sim_status', () => refreshDrives());
    const interval = setInterval(refreshDrives, 3000);
    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, [refreshDrives]);

  // 1 Hz clock: progress/ETA extrapolate between polls so drives tick live.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Same order as everywhere else: the display_order maintained in the
  // settings, with a natural name sort as tie-breaker (TLF 1 before TLF 10).
  const sortedVehicles = useMemo(
    () =>
      [...vehicles].sort(
        (a, b) =>
          a.display_order - b.display_order ||
          a.name.localeCompare(b.name, 'de', { numeric: true, sensitivity: 'base' }),
      ),
    [vehicles],
  );

  // Incidents of this training event that can be driven to (need coordinates).
  const incidentTargets = useMemo(
    () =>
      operations
        .filter((op) => op.coordinates && op.status !== 'complete')
        .map((op) => ({ id: op.id, label: (op.locationDisplay ?? formatLocationForDisplay(op.location, getGlobalHomeCity())) || op.incidentType })),
    [operations],
  );

  // Default target per vehicle, following its assignment: while the incident is
  // still outbound the vehicle drives there; once it's in Einsatz/Rückfahrt the
  // natural next drive is back to the magazin. A manual pick always wins.
  const defaultTargets = useMemo(() => {
    const map: Record<string, string> = {};
    for (const vehicle of vehicles) {
      const op = operations.find(
        (o) => o.status !== 'complete' && o.vehicles.includes(vehicle.name),
      );
      if (!op) continue;
      map[vehicle.id] =
        op.status === 'active' || op.status === 'returning' ? MAGAZIN_TARGET : op.id;
    }
    return map;
  }, [vehicles, operations]);

  const targetFor = (vehicleId: string) => targets[vehicleId] ?? defaultTargets[vehicleId] ?? '';

  if (!selectedEvent?.training_flag) return null;

  const driveFor = (vehicleId: string) => drives.find((d) => d.vehicle_id === vehicleId);

  // Committing the global tempo also re-paces every active drive: the backend
  // rebuilds each drive at its current position, so the markers keep rolling —
  // only the pace changes.
  const handleSpeedCommit = async (newSpeed: number) => {
    if (drives.length === 0) return; // idle: the value is only picked up on start
    try {
      await Promise.all(drives.map((d) => apiClient.setGpsSimulationSpeed(d.vehicle_id, newSpeed)));
      await refreshDrives();
    } catch {
      toast.error(t('speedChangeFailed'));
    }
  };

  const setBusy = (id: string, on: boolean) =>
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const handleStart = async (vehicle: ApiVehicle) => {
    const target = targetFor(vehicle.id);
    if (!target) return;
    // The arrival prompt only fires from Disponiert — warn the instructor
    // early instead of leaving them waiting for a modal that can't come.
    if (target !== MAGAZIN_TARGET) {
      const op = operations.find((o) => o.id === target);
      if (op && op.status !== 'enroute') {
        toast.info(t('arrivalHintTitle'), {
          description: t('arrivalHintDescription'),
        });
      }
    }
    setBusy(vehicle.id, true);
    try {
      await apiClient.startGpsSimulation({
        vehicle_id: vehicle.id,
        target: target === MAGAZIN_TARGET ? 'magazin' : 'incident',
        incident_id: target === MAGAZIN_TARGET ? undefined : target,
        speed_kmh: speedKmh,
      });
      await refreshDrives();
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : t('startFailed');
      toast.error(tCommon('error'), { description: detail });
    } finally {
      setBusy(vehicle.id, false);
    }
  };

  // Send an arrived vehicle back to the magazin — simulates a quick drop-off
  // without stopping the simulation first. start() replaces the finished drive,
  // and the backend starts the return at the current simulated position.
  const handleReturn = async (vehicle: ApiVehicle) => {
    setBusy(vehicle.id, true);
    try {
      await apiClient.startGpsSimulation({
        vehicle_id: vehicle.id,
        target: 'magazin',
        speed_kmh: speedKmh,
      });
      await refreshDrives();
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : t('returnFailed');
      toast.error(tCommon('error'), { description: detail });
    } finally {
      setBusy(vehicle.id, false);
    }
  };

  const handleStop = async (vehicleId?: string) => {
    if (vehicleId) setBusy(vehicleId, true);
    try {
      await apiClient.stopGpsSimulation(vehicleId);
      await refreshDrives();
    } catch {
      toast.error(t('stopFailed'));
    } finally {
      if (vehicleId) setBusy(vehicleId, false);
    }
  };

  return (
    <Card className="mt-4">
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Satellite className="h-5 w-5 text-purple-600" />
              {t('title')}
            </CardTitle>
            <CardDescription>
              {t('description')}
            </CardDescription>
          </div>
          {drives.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => handleStop()}>
              <Square className="size-3.5" />
              {t('stopAll')}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {/* Global tempo: applied when a drive starts and, on release, to all
            drives already rolling. */}
        <div className="flex items-center gap-2 pb-1">
          <Gauge className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
          <Slider
            min={GPS_SIM_SPEED_MIN}
            max={GPS_SIM_SPEED_MAX}
            step={5}
            value={[speedKmh]}
            onValueChange={([v]) => setSpeedKmh(v)}
            onValueCommit={([v]) => handleSpeedCommit(v)}
            className="flex-1"
          />
          <span className="w-16 flex-shrink-0 text-right text-xs tabular-nums text-muted-foreground">
            {t('speed', { speed: Math.round(speedKmh) })}
          </span>
        </div>
        {demoLocked && (
          <p className="flex items-center gap-1.5 rounded-md border border-border bg-muted/50 px-2 py-1.5 text-xs text-muted-foreground">
            <Lock className="h-3.5 w-3.5 flex-shrink-0" />
            {t('lockedDemo')}
          </p>
        )}
        {vehicles.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('noVehicles')}</p>
        ) : (
          sortedVehicles.map((vehicle) => {
            const drive = driveFor(vehicle.id);
            const busy = busyIds.has(vehicle.id);
            const live = drive ? liveDrive(drive, drivesFetchedAt, now) : null;
            return (
              <div
                key={vehicle.id}
                className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm ${
                  drive ? 'border-purple-400/70 bg-purple-50/60 dark:bg-purple-950/30' : 'border-border'
                }`}
              >
                <div className="min-w-0 w-24 flex-shrink-0 truncate font-medium">{vehicle.name}</div>
                {drive && live ? (
                  <>
                    <div className="min-w-0 flex-1 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">
                        {drive.kind === 'magazin' ? t('returnMagazin') : `→ ${drive.target_label}`}
                      </span>
                      {' · '}
                      {Math.round(live.progress * 100)}% · {formatEta(live.eta)}
                    </div>
                    {/* Arrival gate uses the SERVER eta, not the extrapolated one —
                        the extrapolation oscillates around the threshold between
                        polls and made this button flicker. Hidden while busy so it
                        vanishes the moment the return is requested. */}
                    {drive.kind === 'incident' && drive.eta_seconds <= 5 && !busy && (
                      <Button
                        onClick={() => handleReturn(vehicle)}
                        size="sm"
                        className="flex-shrink-0"
                        title={t('returnTitle')}
                      >
                        <Home className="size-3.5" />
                        {t('returnButton')}
                      </Button>
                    )}
                    <Button
                      onClick={() => handleStop(vehicle.id)}
                      disabled={busy}
                      variant="outline"
                      size="sm"
                      className="flex-shrink-0"
                    >
                      <Square className="size-3.5" />
                      {t('stopButton')}
                    </Button>
                  </>
                ) : (
                  <>
                    <Select
                      value={targetFor(vehicle.id)}
                      onValueChange={(v) => setTargets((prev) => ({ ...prev, [vehicle.id]: v }))}
                      disabled={demoLocked}
                    >
                      <SelectTrigger className="h-8 flex-1 text-xs">
                        <SelectValue placeholder={t('targetPlaceholder')} />
                      </SelectTrigger>
                      <SelectContent>
                        {incidentTargets.map((t) => (
                          <SelectItem key={t.id} value={t.id}>
                            {t.label}
                          </SelectItem>
                        ))}
                        <SelectItem value={MAGAZIN_TARGET}>
                          <span className="flex items-center gap-1.5">
                            <Home className="h-3.5 w-3.5" />
                            {t('magazinTarget')}
                          </span>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      onClick={() => handleStart(vehicle)}
                      disabled={busy || demoLocked || !targetFor(vehicle.id)}
                      size="sm"
                      className="flex-shrink-0"
                      title={demoLocked ? t('lockedDemo') : undefined}
                    >
                      <Play className="size-3.5" />
                      {t('startDrive')}
                    </Button>
                  </>
                )}
              </div>
            );
          })
        )}
        <p className="text-xs text-muted-foreground pt-1">
          {t('footer')}
        </p>
      </CardContent>
    </Card>
  );
}
