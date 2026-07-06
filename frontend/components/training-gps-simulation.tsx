'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { toast } from 'sonner';
import { Satellite, Play, Square, Home } from 'lucide-react';

const MAGAZIN_TARGET = '__magazin__';

/**
 * GPS-Simulation (Übungssteuerung): send a vehicle on a simulated drive to a
 * training incident or back to the magazin. The backend feeds the simulated
 * positions through the exact same pipeline as real Traccar data, so trainees
 * see the real deal — map movement, distance labels, geofence notification and
 * the arrival/return prompts.
 */
export function TrainingGpsSimulation() {
  const { selectedEvent } = useEvent();
  const { operations } = useOperations();
  const [vehicles, setVehicles] = useState<ApiVehicle[]>([]);
  const [drives, setDrives] = useState<ApiGpsSimDrive[]>([]);
  const [targets, setTargets] = useState<Record<string, string>>({}); // vehicleId -> target value
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

  const refreshDrives = useCallback(async () => {
    try {
      setDrives(await apiClient.getGpsSimulations());
    } catch {
      // Endpoint unavailable (old backend) — leave list as-is.
    }
  }, []);

  useEffect(() => {
    apiClient.getVehicles().then(setVehicles).catch(() => setVehicles([]));
    refreshDrives();
    // Live status via WS, plus a light poll so progress bars advance.
    const unsubscribe = wsClient.on('gps_sim_status', () => refreshDrives());
    const interval = setInterval(refreshDrives, 5000);
    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, [refreshDrives]);

  // Incidents of this training event that can be driven to (need coordinates).
  const incidentTargets = useMemo(
    () =>
      operations
        .filter((op) => op.coordinates && op.status !== 'complete')
        .map((op) => ({ id: op.id, label: op.location || op.incidentType })),
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
        toast.info('Hinweis: Ankunftsmeldung kommt nur bei Status «Disponiert»', {
          description: 'Der Einsatz steht aktuell nicht auf Disponiert — die Fahrt läuft, aber ohne Ankunfts-Abfrage.',
        });
      }
    }
    setBusy(vehicle.id, true);
    try {
      await apiClient.startGpsSimulation({
        vehicle_id: vehicle.id,
        target: target === MAGAZIN_TARGET ? 'magazin' : 'incident',
        incident_id: target === MAGAZIN_TARGET ? undefined : target,
      });
      await refreshDrives();
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : 'Simulation konnte nicht gestartet werden';
      toast.error('Fehler', { description: detail });
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
      toast.error('Simulation konnte nicht gestoppt werden');
    } finally {
      if (vehicleId) setBusy(vehicleId, false);
    }
  };

  const formatEta = (secs: number) => {
    if (secs <= 5) return 'angekommen';
    const m = Math.floor(secs / 60);
    const s = Math.round(secs % 60);
    return m > 0 ? `noch ~${m} min ${s}s` : `noch ~${s}s`;
  };

  return (
    <Card className="mt-4">
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Satellite className="h-5 w-5 text-purple-600" />
              GPS-Simulation
            </CardTitle>
            <CardDescription>
              Schickt ein Fahrzeug auf eine simulierte Fahrt — Karte, Distanzen und die
              Ankunfts-/Rückkehr-Meldungen verhalten sich wie mit echtem GPS
            </CardDescription>
          </div>
          {drives.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => handleStop()}>
              <Square className="mr-1.5 h-3.5 w-3.5" />
              Alle stoppen
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {vehicles.length === 0 ? (
          <p className="text-xs text-muted-foreground">Keine Fahrzeuge vorhanden.</p>
        ) : (
          vehicles.map((vehicle) => {
            const drive = driveFor(vehicle.id);
            const busy = busyIds.has(vehicle.id);
            return (
              <div
                key={vehicle.id}
                className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm ${
                  drive ? 'border-purple-400/70 bg-purple-50/60 dark:bg-purple-950/30' : 'border-border'
                }`}
              >
                <div className="min-w-0 w-24 flex-shrink-0 truncate font-medium">{vehicle.name}</div>
                {drive ? (
                  <>
                    <div className="min-w-0 flex-1 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">
                        {drive.kind === 'magazin' ? 'Rückkehr Magazin' : `→ ${drive.target_label}`}
                      </span>
                      {' · '}
                      {Math.round(drive.progress * 100)}% · {formatEta(drive.eta_seconds)}
                    </div>
                    <Button
                      onClick={() => handleStop(vehicle.id)}
                      disabled={busy}
                      variant="outline"
                      size="sm"
                      className="flex-shrink-0"
                    >
                      <Square className="mr-1.5 h-3.5 w-3.5" />
                      Stopp
                    </Button>
                  </>
                ) : (
                  <>
                    <Select
                      value={targetFor(vehicle.id)}
                      onValueChange={(v) => setTargets((prev) => ({ ...prev, [vehicle.id]: v }))}
                    >
                      <SelectTrigger className="h-8 flex-1 text-xs">
                        <SelectValue placeholder="Ziel wählen…" />
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
                            Magazin (Rückkehr)
                          </span>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      onClick={() => handleStart(vehicle)}
                      disabled={busy || !targetFor(vehicle.id)}
                      size="sm"
                      className="flex-shrink-0"
                    >
                      <Play className="mr-1.5 h-3.5 w-3.5" />
                      Fahrt starten
                    </Button>
                  </>
                )}
              </div>
            );
          })
        )}
        <p className="text-xs text-muted-foreground pt-1">
          Fahrten laufen mit ~30 km/h (inkl. Umwegfaktor) in gerader Linie, bremsen vor dem Ziel ab
          und stoppen automatisch nach 30 Minuten. Rückfahrten starten am zugewiesenen Einsatzort.
          Gesperrt, solange ein Ernstfall-Ereignis aktive Einsätze hat.
        </p>
      </CardContent>
    </Card>
  );
}
