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
import { getOperationStatusLabel } from '@/lib/status-labels';
import Link from 'next/link';
import {
  ClipboardCheck,
  Bot,
  Bus,
  MapPin,
  MapPinCheck,
  Truck,
  Flag,
  Home,
  ChevronRight,
  AlertTriangle,
  Megaphone,
  MessageSquare,
  Wrench,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
  rapport: ClipboardCheck,
};


export function TrainingSimulationControls() {
  const t = useTranslations('training.simulation');
  const tCommon = useTranslations('training.common');
  // Reuses the GPS card's warning copy for the same missing-Magazin case.
  const tGps = useTranslations('training.gpsSim');
  const { selectedEvent } = useEvent();
  const { operations, changeStatusToTop, formatLocation, refreshOperations } = useOperations();
  // Track per-incident advance state so each row's button spins independently.
  const [advancingIds, setAdvancingIds] = useState<Set<string>>(new Set());
  // The incident whose "Kommt ihr selbst zurück?" question is open (decision 24).
  const [pickupPrompt, setPickupPrompt] = useState<Operation | null>(null);
  const [isFilingRapports, setIsFilingRapports] = useState(false);
  // Simulated «Neue Meldung»: which incident's Trupp reports, and what they say.
  const [fieldReportIncidentId, setFieldReportIncidentId] = useState('');
  const [fieldReportText, setFieldReportText] = useState('');
  const [isSendingFieldReport, setIsSendingFieldReport] = useState(false);

  // GPS drive simulation: vehicles for name→id lookup, active drives for the
  // per-row progress state. The backend refuses simulations in demo mode, so
  // the console falls back to the plain "Fahrzeug vor Ort" action there.
  const [vehicles, setVehicles] = useState<ApiVehicle[]>([]);
  const [drives, setDrives] = useState<ApiGpsSimDrive[]>([]);
  const [drivesFetchedAt, setDrivesFetchedAt] = useState(() => Date.now());
  const [gpsSimAvailable, setGpsSimAvailable] = useState(true);
  // Same preflight as the GPS card (training-gps-simulation.tsx): a «Rückfahrt
  // Magazin» drive 400s when gps.station_lat/lng are unset, so warn on the
  // button instead of after the click. Defaults to true — no false warning
  // while settings are still loading; the backend error stays the backstop.
  const [magazinConfigured, setMagazinConfigured] = useState(true);
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
    apiClient
      .getAllSettings()
      .then((settings) => {
        // Exactly the pair the backend parses for the Magazin target.
        const lat = parseFloat(settings['gps.station_lat'] ?? '');
        const lng = parseFloat(settings['gps.station_lng'] ?? '');
        setMagazinConfigured(Number.isFinite(lat) && Number.isFinite(lng));
      })
      .catch(() => {}); // unknown → don't block; the backend error still catches it
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

  // Incidents whose crew can report something new — a Meldung needs a Trupp
  // standing somewhere (the backend refuses one without assigned personnel).
  const crewedOps = useMemo(
    () => operations.filter((op) => op.status !== 'complete' && op.crew.length > 0),
    [operations]
  );

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

    // The rapport step IS the existing per-incident inject — same endpoint,
    // same toast, just surfaced as a lifecycle step instead of a menu item.
    if (action.kind === 'rapport') {
      await handleInject(op, 'rapport');
      return;
    }

    // Plain status transitions reuse the optimistic one-click board move.
    if (action.kind === 'status' && action.targetStatus) {
      // …but «Fahrzeug vor Ort» IS the crew arriving, so it also files the
      // "Angekommen" report. The GPS route stamps that arrival on its own (the
      // automation does it at the geofence); without this the exercise that
      // falls back to the button was the only one whose Schadenplatz never got
      // an arrival time. A failed stamp must not block the board move.
      if (action.key === 'vehicle_on_scene' && !op.fieldArrivedAt) {
        setAdvancing(op.id, true);
        try {
          await apiClient.simulateFieldArrived(selectedEvent.id, op.id);
          void refreshOperations();
        } catch (error: unknown) {
          const detail = error instanceof Error ? error.message : t('actionFailed');
          toast.error(tCommon('error'), { description: detail });
        } finally {
          setAdvancing(op.id, false);
        }
      }
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
        // Reko sub-state lives in its own table — refresh directly so the
        // console advances even when the WebSocket is down (the poll's
        // sync-version only covers it since the same fix backend-side).
        void refreshOperations();
      } else if (action.kind === 'reko_report') {
        await apiClient.simulateReko(selectedEvent.id, op.id);
        void refreshOperations();
      } else if (action.kind === 'field_complete') {
        // "Einsatz beendet" asks the same follow-up the field gets — see
        // handleFieldComplete; the button only opens the question.
        setPickupPrompt(op);
        return;
      }
    } catch (error: unknown) {
      console.error('Failed to advance incident:', error);
      const detail = error instanceof Error ? error.message : t('actionFailed');
      toast.error(tCommon('error'), { description: detail });
    } finally {
      setAdvancing(op.id, false);
    }
  };

  const handleSimulateRapports = async () => {
    if (!selectedEvent) return;
    setIsFilingRapports(true);
    try {
      const result = await apiClient.simulateRapportsBulk(selectedEvent.id);
      if (result.candidates === 0) {
        toast.info(t('rapportNoCandidates'), { description: t('rapportNoCandidatesDescription') });
      } else {
        toast.success(t('rapportBulkDone', { covered: result.covered, candidates: result.candidates }), {
          description: t('rapportBulkDoneDescription', { skipped: result.skipped }),
        });
        void refreshOperations();
      }
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : t('injectFailed');
      toast.error(tCommon('error'), { description: detail });
    } finally {
      setIsFilingRapports(false);
    }
  };

  // Simulated «Neue Meldung» (plan 26 §3): the chosen incident's Trupp reports
  // a fresh emergency in free text. The backend routes it through the REAL
  // field creation path, so it arrives exactly like a crew's Meldung — bell,
  // Eingegangen column, provenance and all.
  const handleSendFieldReport = async () => {
    if (!selectedEvent || !fieldReportIncidentId || !fieldReportText.trim()) return;
    setIsSendingFieldReport(true);
    try {
      const result = await apiClient.simulateFieldReport(
        selectedEvent.id,
        fieldReportIncidentId,
        fieldReportText.trim()
      );
      toast.success(t('fieldReportSent'), { description: result.message });
      setFieldReportText('');
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : t('injectFailed');
      toast.error(tCommon('error'), { description: detail });
    } finally {
      setIsSendingFieldReport(false);
    }
  };

  // "Kommt ihr selbst zurück?" — the one follow-up "Einsatz beendet" asks in
  // the field (decision 24). Answering nothing lets the backend preselect it
  // from the situation (zu Fuss / kein Fahrzeug = meist gestrandet); the
  // Übungsleiter can always override, exactly as the crew can.
  const handleFieldComplete = async (op: Operation, pickupNeeded?: boolean) => {
    if (!selectedEvent) return;
    setPickupPrompt(null);
    setAdvancing(op.id, true);
    try {
      const result = await apiClient.simulateFieldComplete(selectedEvent.id, op.id, { pickupNeeded });
      if (result.pickup_needed) {
        // Never a warning: the Übungsleiter is being told about their own click.
        // It is only NEWS when they let the backend decide («Lage entscheidet»)
        // — then the Abholung is something they did not choose, and `info` says
        // so without dressing an exercise step up as an alarm.
        const description = t('pickupNeededDescription');
        if (pickupNeeded === undefined) toast.info(t('pickupNeeded'), { description });
        else toast.success(t('pickupNeeded'), { description });
      }
      void refreshOperations();
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : t('actionFailed');
      toast.error(tCommon('error'), { description: detail });
    } finally {
      setAdvancing(op.id, false);
    }
  };

  // Trainer injects — surprises that force the operator to react. Escalation
  // and reinforcement are always available on an open incident; the breakdown
  // needs an assigned vehicle.
  const handleInject = async (
    op: Operation,
    inject: 'escalate' | 'reinforcement' | 'breakdown' | 'rapport' | 'fieldMessage' | 'arrived' | 'pickup'
  ) => {
    if (!selectedEvent) return;
    setAdvancing(op.id, true);
    try {
      if (inject === 'arrived') {
        const result = await apiClient.simulateFieldArrived(selectedEvent.id, op.id);
        toast.success(t('arrivedReported'), { description: result.message });
      } else if (inject === 'pickup') {
        // One item, both halves: a Trupp either needs a lift or has just been
        // picked up — the same toggle the crew has on /feld.
        const result = await apiClient.simulatePickup(selectedEvent.id, op.id, {
          needed: !op.pickupNeeded,
        });
        if (op.pickupNeeded) {
          toast.success(t('pickupCleared'), { description: result.message });
        } else {
          // Both halves confirm, neither warns — the trainer picked this item
          // out of the inject menu a moment ago. The description says what it
          // changed on the board instead of echoing the server's sentence back:
          // that one ends in «· im KP erfasst», provenance the Meldungen thread
          // needs and a toast about your own click does not.
          toast.success(t('pickupNeeded'), { description: t('pickupNeededDescription') });
        }
      } else if (inject === 'escalate') {
        await apiClient.simulateEscalation(selectedEvent.id, op.id);
        toast.success(t('escalated'), {
          description: t('escalatedDescription'),
        });
      } else if (inject === 'reinforcement') {
        const result = await apiClient.simulateReinforcement(selectedEvent.id, op.id);
        toast.success(t('reinforcementRequested'), { description: result.message });
      } else if (inject === 'rapport') {
        const result = await apiClient.simulateRapport(selectedEvent.id, op.id);
        // The photo count is worth saying out loud: it is the one part of the
        // rapport the KP has to open the card to see.
        let description = result.message;
        if (result.filed_by && result.photos > 0) {
          description = t('rapportFiledByPhotos', { name: result.filed_by, count: result.photos });
        } else if (result.filed_by) {
          description = t('rapportFiledBy', { name: result.filed_by });
        }
        toast.success(t('rapportFiled'), { description });
      } else if (inject === 'fieldMessage') {
        const result = await apiClient.simulateFieldMessage(selectedEvent.id, op.id);
        toast.success(t('fieldMessageSent'), { description: result.message });
      } else {
        const result = await apiClient.simulateVehicleBreakdown(selectedEvent.id, op.id);
        toast.success(t('vehicleBrokenDown', { name: result.vehicle_name }), {
          description: t('vehicleBrokenDownDescription'),
        });
      }
      // Reflect the inject immediately, WebSocket or not — several of these
      // write tables the polling fallback watches only coarsely.
      void refreshOperations();
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : t('injectFailed');
      toast.error(tCommon('error'), { description: detail });
    } finally {
      setAdvancing(op.id, false);
    }
  };

  return (
    <Card>
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
          <div className="flex items-center justify-between gap-2">
            <Label className="flex items-center gap-2">
              <ChevronRight className="h-4 w-4" />
              {t('nextActions')}
            </Label>
            {/* Bulk rapports stay one click for storm drills (plan 25 §16):
                twenty-three per-incident rapport steps would be twenty-three
                clicks — and the missing fifth is deliberate (the Restliste). */}
            <Button
              onClick={handleSimulateRapports}
              disabled={isFilingRapports}
              variant="ghost"
              size="xs"
              className="text-muted-foreground"
              title={t('rapportHint')}
            >
              <ClipboardCheck className="size-3.5" />
              {isFilingRapports ? t('rapportFiling') : t('rapportBulk')}
            </Button>
          </div>
          {/* Same preflight banner as the GPS card: without the Magazin
              coordinates every «Rückfahrt Magazin» button below is disabled,
              and a disabled button with only a hover tooltip reads as "does
              nothing" — especially on touch (testing sweep 2026-08-19 #7). */}
          {!magazinConfigured && (
            <p className="flex items-center gap-1.5 rounded-md border border-warning/40 bg-warning/10 px-2 py-1.5 text-xs text-warning-foreground">
              <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
              <span>
                {tGps('magazinMissing')}{' '}
                <Link href="/settings" className="underline underline-offset-2 hover:text-foreground">
                  {tGps('magazinMissingLink')}
                </Link>
              </span>
            </p>
          )}
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
                    // flex-wrap + the text block claiming the full width below `sm`:
                    // on a phone the buttons drop onto their own line instead of
                    // squeezing the text to one word per line (testing image #12).
                    <div
                      key={op.id}
                      className={`flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-md border px-2 py-1.5 text-sm ${
                        due
                          ? 'border-warning/70 bg-warning/10'
                          : anyRolling
                            ? 'border-purple-400/70 bg-purple-50/60 dark:bg-purple-950/30'
                            : 'border-border'
                      }`}
                    >
                      <div className="min-w-0 flex-1 basis-full sm:basis-48">
                        <div className="truncate font-medium" title={formatLocation(op.location) || op.incidentType}>
                          {formatLocation(op.location) || op.incidentType}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {getOperationStatusLabel(op.status)}
                          {started && ` · ${t('since', { time: getTimeSince(started) })}`}
                          {/* The "beendet" report lives ONLY here — the board is
                              informed in the exercise itself (e.g. via radio). */}
                          {op.fieldCompleteReportedAt && op.status === 'active' && (
                            <span className="text-emerald-600 dark:text-emerald-400"> · {t('fieldComplete')}</span>
                          )}
                        </div>
                      </div>
                      <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
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
                        // The return drive needs the Magazin coordinates — warn
                        // on the button, same preflight as the GPS card.
                        const needsMagazin = action.kind === 'gps_return' && !magazinConfigured;
                        return (
                          <Button
                            key={action.key}
                            onClick={() => handleAdvance(op, action)}
                            disabled={busy || needsMagazin}
                            variant={due && isPrimary ? 'default' : 'outline'}
                            size="sm"
                            className="flex-shrink-0"
                            title={
                              needsMagazin
                                ? tGps('magazinMissing')
                                : due && isPrimary
                                  ? t('recommendedAction')
                                  : undefined
                            }
                          >
                            <Icon className="size-3.5" />
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
                            <AlertTriangle className="size-3.5 text-amber-600" />
                          </Button>
                        </DropdownMenuTrigger>
                        {/* Every item carries a one-line description (testing
                            image #11: several labels were unclear on their own). */}
                        <DropdownMenuContent align="end" className="max-w-72">
                          <DropdownMenuLabel>{t('inject')}</DropdownMenuLabel>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => handleInject(op, 'escalate')}>
                            <AlertTriangle className="mr-2 h-4 w-4 flex-shrink-0 text-red-600" />
                            <span className="min-w-0">
                              <span className="block">{t('injectEscalate')}</span>
                              <span className="block text-xs text-muted-foreground">{t('injectEscalateDesc')}</span>
                            </span>
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleInject(op, 'reinforcement')}>
                            <Megaphone className="mr-2 h-4 w-4 flex-shrink-0 text-amber-600" />
                            <span className="min-w-0">
                              <span className="block">{t('injectReinforcement')}</span>
                              <span className="block text-xs text-muted-foreground">{t('injectReinforcementDesc')}</span>
                            </span>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => handleInject(op, 'breakdown')}
                            disabled={op.vehicles.length === 0}
                          >
                            <Wrench className="mr-2 h-4 w-4 flex-shrink-0 text-muted-foreground" />
                            <span className="min-w-0">
                              <span className="block">{t('injectBreakdown')}</span>
                              <span className="block text-xs text-muted-foreground">{t('injectBreakdownDesc')}</span>
                            </span>
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          {/* Plan 25: the field side of the exercise — every
                              report a real crew can send. "Angekommen" is
                              normally filed by «Fahrzeug vor Ort» or by the GPS
                              arrival; it stays here for the Trupp that walked,
                              or the card an operator moved by hand. */}
                          <DropdownMenuItem
                            onClick={() => handleInject(op, 'arrived')}
                            disabled={op.fieldArrivedAt != null}
                          >
                            <MapPinCheck className="mr-2 h-4 w-4 flex-shrink-0 text-emerald-600" />
                            <span className="min-w-0">
                              <span className="block">{t('injectArrived')}</span>
                              <span className="block text-xs text-muted-foreground">{t('injectArrivedDesc')}</span>
                            </span>
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleInject(op, 'rapport')}>
                            <ClipboardCheck className="mr-2 h-4 w-4 flex-shrink-0 text-emerald-600" />
                            <span className="min-w-0">
                              <span className="block">{t('injectRapport')}</span>
                              <span className="block text-xs text-muted-foreground">{t('injectRapportDesc')}</span>
                            </span>
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleInject(op, 'fieldMessage')}>
                            <MessageSquare className="mr-2 h-4 w-4 flex-shrink-0 text-blue-600" />
                            <span className="min-w-0">
                              <span className="block">{t('injectFieldMessage')}</span>
                              <span className="block text-xs text-muted-foreground">{t('injectFieldMessageDesc')}</span>
                            </span>
                          </DropdownMenuItem>
                          {/* Decision 24: a Schadenplatz can be finished and
                              still have three people standing in the rain — and
                              the lift arriving is a report of its own. */}
                          <DropdownMenuItem onClick={() => handleInject(op, 'pickup')}>
                            <Bus className="mr-2 h-4 w-4 flex-shrink-0 text-amber-600" />
                            <span className="min-w-0">
                              <span className="block">
                                {op.pickupNeeded ? t('injectPickupDone') : t('injectPickupNeeded')}
                              </span>
                              <span className="block text-xs text-muted-foreground">
                                {op.pickupNeeded ? t('injectPickupDoneDesc') : t('injectPickupNeededDesc')}
                              </span>
                            </span>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                      </div>
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

        {/* Simulated «Neue Meldung»: a Trupp mentions a fresh emergency. Goes
            through the real field intake, so the KP trains the real path —
            triage in Eingegangen, disposition — instead of a trainer shortcut
            that plants a finished card. */}
        <div className="space-y-2">
          <Label className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4" />
            {t('fieldReportLabel')}
          </Label>
          {crewedOps.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('fieldReportNoIncidents')}</p>
          ) : (
            <>
              <Select value={fieldReportIncidentId} onValueChange={setFieldReportIncidentId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t('fieldReportIncidentPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {crewedOps.map((op) => (
                    <SelectItem key={op.id} value={op.id}>
                      {formatLocation(op.location) || op.incidentType}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex items-center gap-2">
                <Input
                  value={fieldReportText}
                  onChange={(e) => setFieldReportText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleSendFieldReport();
                  }}
                  placeholder={t('fieldReportPlaceholder')}
                  className="flex-1"
                />
                <Button
                  onClick={handleSendFieldReport}
                  disabled={isSendingFieldReport || !fieldReportIncidentId || !fieldReportText.trim()}
                  variant="outline"
                  size="sm"
                  className="flex-shrink-0"
                >
                  <MessageSquare className="size-3.5" />
                  {isSendingFieldReport ? t('fieldReportSending') : t('fieldReportSend')}
                </Button>
              </div>
              {/* Canned examples — quick-fills, not sends: the trainer can
                  still edit before the Meldung goes out. */}
              <div className="flex flex-wrap gap-1.5">
                {[t('fieldReportExample1'), t('fieldReportExample2'), t('fieldReportExample3')].map((example) => (
                  <Button
                    key={example}
                    variant="outline"
                    size="xs"
                    className="text-muted-foreground"
                    onClick={() => setFieldReportText(example)}
                  >
                    {example}
                  </Button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">{t('fieldReportHint')}</p>
            </>
          )}
        </div>
      </CardContent>

      {/* The follow-up "Einsatz beendet" asks in the field: a Schadenplatz can
          be finished and still have three people standing in the rain. */}
      <Dialog open={pickupPrompt !== null} onOpenChange={(open) => !open && setPickupPrompt(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('pickupQuestion')}</DialogTitle>
            <DialogDescription>
              {pickupPrompt
                ? t('pickupQuestionDescription', {
                    location: formatLocation(pickupPrompt.location) || pickupPrompt.incidentType,
                  })
                : ''}
            </DialogDescription>
          </DialogHeader>
          {/* The app's footer shape (see ConfirmDialog): the "…but do this
              instead" option sits left on `mr-auto`, the answers right, the
              recommended one last and loudest. `flex-wrap` because three German
              labels are wider than any max-width guess — the buttons carry
              `shrink-0`, so without it the last one simply overflowed the
              dialog's own padding, which is what made the row look unbalanced.

              Emphasis, deliberately moved: «Lage entscheidet» used to be the
              primary. It is not an answer to the question — it hands the
              decision to the backend's inference (zu Fuss / kein Fahrzeug), and
              as the loud default it made the pickup inject almost unreachable
              in a normal exercise, because a crew with a vehicle always infers
              "fährt selbst". So it drops to a quiet aside. The primary is now
              «Fährt selbst»: the true answer in the large majority of cases and
              the only one of the three that costs the operator nothing. */}
          <DialogFooter className="flex-wrap">
            <Button
              variant="ghost"
              className="sm:mr-auto"
              onClick={() => pickupPrompt && handleFieldComplete(pickupPrompt)}
            >
              {t('pickupAuto')}
            </Button>
            <Button
              variant="outline"
              onClick={() => pickupPrompt && handleFieldComplete(pickupPrompt, true)}
            >
              <AlertTriangle className="size-3.5 text-amber-600" />
              {t('pickupRequired')}
            </Button>
            <Button onClick={() => pickupPrompt && handleFieldComplete(pickupPrompt, false)}>
              {t('pickupSelfReturn')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
