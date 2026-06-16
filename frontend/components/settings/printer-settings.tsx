'use client';

/**
 * Printer Settings Component
 * Configures thermal printer connection and auto-print behavior
 */

import { useState, useEffect, useRef } from 'react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Printer,
  CheckCircle,
  AlertCircle,
  Loader2,
  RefreshCw,
  Info,
} from 'lucide-react';
import { apiClient, type ApiPrinterStatus } from '@/lib/api-client';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';

// The Pi print-agent polls ~5s while "active" (within ACTIVE window of its last
// job) and ~60s when idle. We estimate the pickup window the same way so the
// Testdruck progress bar reflects the real refresh cadence instead of spinning
// forever. Padded slightly to cover the print itself.
const TESTDRUCK_ACTIVE_POLL_MS = 8000;
const TESTDRUCK_IDLE_POLL_MS = 62000;
const TESTDRUCK_AGENT_ACTIVE_WINDOW_MS = 15 * 60 * 1000;

type TestDruckPhase = 'queued' | 'printing' | 'done' | null;

export function PrinterSettings() {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [printerStatus, setPrinterStatus] = useState<ApiPrinterStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [testingConnection, setTestingConnection] = useState(false);
  const [testingPrint, setTestingPrint] = useState(false);
  const [statusLoading, setStatusLoading] = useState(false);

  // Testdruck progress (time-based, driven by the Pi's expected poll cadence)
  const [testPhase, setTestPhase] = useState<TestDruckPhase>(null);
  const [testProgress, setTestProgress] = useState(0);
  const [testEta, setTestEta] = useState<string | null>(null);

  // Track saved values to detect changes on blur
  const savedSettingsRef = useRef<Record<string, string>>({});
  // Pending "reset the done bar" timer, so a quick re-run can cancel it.
  const testResetTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    loadSettings();
    loadPrinterStatus();
    return () => {
      if (testResetTimerRef.current) clearTimeout(testResetTimerRef.current);
    };
  }, []);

  const loadSettings = async () => {
    setLoading(true);
    try {
      const data = await apiClient.getAllSettings();
      setSettings(data);
      savedSettingsRef.current = { ...data };
    } catch (error) {
      console.error('Failed to load settings:', error);
      toast.error('Fehler beim Laden der Einstellungen');
    } finally {
      setLoading(false);
    }
  };

  const loadPrinterStatus = async (): Promise<ApiPrinterStatus | null> => {
    setStatusLoading(true);
    try {
      const status = await apiClient.getPrinterStatus();
      setPrinterStatus(status);
      return status;
    } catch (error) {
      console.error('Failed to load printer status:', error);
      // Don't show error toast - printer might just not be configured
      return null;
    } finally {
      setStatusLoading(false);
    }
  };

  const updateSetting = async (key: string, value: string) => {
    setSaving(key);
    try {
      await apiClient.updateSetting(key, value);
      setSettings((prev) => ({ ...prev, [key]: value }));
      savedSettingsRef.current[key] = value;
      // Refresh status after settings change
      loadPrinterStatus();
    } catch (error) {
      console.error(`Failed to update setting ${key}:`, error);
      toast.error('Fehler beim Speichern');
    } finally {
      setSaving(null);
    }
  };

  const handleTestPrint = async () => {
    setTestingConnection(true);
    try {
      const status = await loadPrinterStatus();

      if (!status?.enabled || !status.ip) {
        toast.info('Drucker ist nicht aktiviert oder konfiguriert');
      } else if (!status.agent_online) {
        toast.error('Print-Service (Raspberry Pi) ist offline – er meldet sich nicht beim Backend.');
      } else if (status.last_error) {
        toast.error(`Letzter Druckauftrag fehlgeschlagen: ${status.last_error}`);
      } else {
        toast.success('Print-Service online und Drucker konfiguriert');
      }
    } catch (error) {
      toast.error('Verbindungstest fehlgeschlagen');
    } finally {
      setTestingConnection(false);
    }
  };

  const handleTestDruck = async () => {
    if (testResetTimerRef.current) clearTimeout(testResetTimerRef.current);
    setTestingPrint(true);
    setTestPhase('queued');
    setTestProgress(0);
    setTestEta(null);

    const TIMEOUT_MS = 70000;
    const POLL_MS = 2000;
    let ticker: ReturnType<typeof setInterval> | undefined;
    let phase: Exclude<TestDruckPhase, null> = 'queued';

    try {
      const job = await apiClient.queueTestPrint();
      const start = Date.now();
      toast.info('Testdruck eingereiht – warte auf Drucker…');

      // Estimate how long until the Pi picks up the job, mirroring the agent's
      // own active/idle decision: if it processed a job recently it's polling
      // fast (~5s), otherwise it's idle (~60s). The progress bar fills over that
      // window so the user sees a realistic wait instead of an endless spinner.
      const preStatus = await loadPrinterStatus();
      const lastJobAt = preStatus?.last_job_at ? new Date(preStatus.last_job_at).getTime() : 0;
      const agentActive = lastJobAt > 0 && Date.now() - lastJobAt < TESTDRUCK_AGENT_ACTIVE_WINDOW_MS;
      const expectedMs = agentActive ? TESTDRUCK_ACTIVE_POLL_MS : TESTDRUCK_IDLE_POLL_MS;
      setTestEta(agentActive ? 'in ~5 s' : 'in ~60 s');

      // Smooth fill toward the expected pickup window, capped at 90% while the
      // job is still pending so it never claims completion early.
      ticker = setInterval(() => {
        if (phase !== 'queued') return;
        setTestProgress(Math.min(90, ((Date.now() - start) / expectedMs) * 90));
      }, 200);

      // Poll the job until the agent reports completion or failure. If it's never
      // claimed AND the agent isn't sending heartbeats, the print-service is down.
      let result = job;
      let bailedServiceOffline = false;

      while (Date.now() - start < TIMEOUT_MS) {
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        result = await apiClient.getPrintJob(job.id);

        // The agent claimed the job → it's printing now; jump the bar forward.
        if (phase === 'queued' && (result.status === 'printing' || result.claimed_at)) {
          phase = 'printing';
          setTestPhase('printing');
          setTestProgress(94);
        }

        if (result.status === 'completed' || result.status === 'failed') break;

        // Still pending after a few seconds → check whether the agent is alive.
        if (result.status === 'pending' && Date.now() - start > 6000) {
          const status = await loadPrinterStatus();
          if (status && !status.agent_online) {
            bailedServiceOffline = true;
            break;
          }
        }
      }

      if (result.status === 'completed') {
        phase = 'done';
        setTestPhase('done');
        setTestProgress(100);
        toast.success('Testdruck erfolgreich gedruckt – das System ist bereit.');
      } else if (result.status === 'failed') {
        // Job was claimed and failed → agent is alive, the printer is the problem.
        toast.error(`Drucker-Fehler: ${result.error_message ?? 'Drucker nicht erreichbar'}`);
      } else if (bailedServiceOffline) {
        toast.error('Print-Service (Raspberry Pi) ist offline – der Auftrag wird nicht abgeholt.');
      } else {
        toast.warning('Testdruck noch in der Warteschlange – der Agent verarbeitet ihn in Kürze.');
      }
    } catch (error) {
      console.error('Test print failed:', error);
      toast.error('Testdruck konnte nicht gestartet werden');
    } finally {
      if (ticker) clearInterval(ticker);
      setTestingPrint(false);
      loadPrinterStatus();
      // Let a completed bar linger briefly so the 100% reads as success; otherwise
      // clear immediately.
      if (phase === 'done') {
        testResetTimerRef.current = setTimeout(() => {
          setTestPhase(null);
          setTestProgress(0);
          setTestEta(null);
        }, 1800);
      } else {
        setTestPhase(null);
        setTestProgress(0);
        setTestEta(null);
      }
    }
  };

  const isEnabled = settings['printer.enabled'] === 'true';
  const printerIp = settings['printer.ip'] || '';
  const printerPort = settings['printer.port'] || '9100';
  const autoAnfahrt = settings['printer.auto_anfahrt'] === 'true';

  if (loading) {
    return (
      <Card className="p-6">
        <div className="space-y-4">
          <div className="h-4 w-32 bg-muted animate-pulse rounded" />
          <div className="h-10 w-full bg-muted animate-pulse rounded" />
          <div className="h-10 w-full bg-muted animate-pulse rounded" />
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Info banner */}
      <Card className="p-3 border-info/30 bg-info/5">
        <div className="flex gap-2">
          <Info className="h-4 w-4 text-info flex-shrink-0 mt-0.5" />
          <p className="text-sm text-info-foreground">
            Der Print-Agent muss auf dem Kommandoposten-Netzwerk laufen und Zugriff auf den Drucker haben.
          </p>
        </div>
      </Card>

      {/* Status */}
      <Card className="p-4">
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              {printerStatus?.enabled ? (
                <>
                  <CheckCircle className="h-4 w-4 text-success" />
                  <span className="text-sm font-medium">Drucker aktiviert</span>
                  {printerStatus.ip && (
                    <span className="text-sm text-muted-foreground">
                      ({printerStatus.ip}:{printerStatus.port})
                    </span>
                  )}
                </>
              ) : (
                <>
                  <AlertCircle className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">Drucker deaktiviert</span>
                </>
              )}
            </div>
            {/* Print-service (Raspberry Pi agent) liveness */}
            {printerStatus?.enabled && (
              <div className="flex items-center gap-2">
                {printerStatus.agent_online ? (
                  <>
                    <CheckCircle className="h-4 w-4 text-success" />
                    <span className="text-sm font-medium">Print-Service online</span>
                  </>
                ) : (
                  <>
                    <AlertCircle className="h-4 w-4 text-destructive" />
                    <span className="text-sm text-destructive">Print-Service offline</span>
                    <span className="text-xs text-muted-foreground">(Raspberry Pi meldet sich nicht)</span>
                  </>
                )}
              </div>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={loadPrinterStatus}
            disabled={statusLoading}
          >
            <RefreshCw className={`h-4 w-4 ${statusLoading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </Card>

      {/* Configuration Card */}
      <Card className="p-6">
        <div className="space-y-1 mb-4">
          <p className="font-medium">Drucker-Konfiguration</p>
          <p className="text-xs text-muted-foreground">Einstellungen für den Thermodrucker</p>
        </div>
        <div className="space-y-4">
          {/* Enable/Disable Toggle */}
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <Label htmlFor="printer-enabled" className="font-medium">Drucker aktiviert</Label>
              <p className="text-xs text-muted-foreground">Aktiviert die Thermodrucker-Funktionen</p>
            </div>
            <Switch
              id="printer-enabled"
              checked={isEnabled}
              onCheckedChange={(checked) =>
                updateSetting('printer.enabled', checked ? 'true' : 'false')
              }
              disabled={saving === 'printer.enabled'}
            />
          </div>

          {/* IP Address */}
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <Label htmlFor="printer-ip" className="font-medium">IP-Adresse</Label>
              <p className="text-xs text-muted-foreground">Netzwerk-IP des Thermodruckers</p>
            </div>
            <div className="flex-shrink-0 w-48">
              <Input
                id="printer-ip"
                type="text"
                placeholder="192.168.1.100"
                value={printerIp}
                onChange={(e) =>
                  setSettings((prev) => ({ ...prev, 'printer.ip': e.target.value }))
                }
                onBlur={(e) => {
                  if (e.target.value !== savedSettingsRef.current['printer.ip']) {
                    updateSetting('printer.ip', e.target.value);
                  }
                }}
                disabled={saving === 'printer.ip'}
              />
            </div>
          </div>

          {/* Port */}
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <Label htmlFor="printer-port" className="font-medium">Port</Label>
              <p className="text-xs text-muted-foreground">ESC/POS Standard-Port (normalerweise 9100)</p>
            </div>
            <div className="flex-shrink-0 w-24">
              <Input
                id="printer-port"
                type="number"
                placeholder="9100"
                value={printerPort}
                onChange={(e) =>
                  setSettings((prev) => ({ ...prev, 'printer.port': e.target.value }))
                }
                onBlur={(e) => {
                  if (e.target.value !== savedSettingsRef.current['printer.port']) {
                    updateSetting('printer.port', e.target.value);
                  }
                }}
                disabled={saving === 'printer.port'}
              />
            </div>
          </div>

          {/* Auto-print on Anfahrt */}
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <Label htmlFor="auto-anfahrt" className="font-medium">Auto-Druck bei Anfahrt</Label>
              <p className="text-xs text-muted-foreground">Einsatzzettel automatisch drucken bei Status &quot;Einsatz&quot;</p>
            </div>
            <Switch
              id="auto-anfahrt"
              checked={autoAnfahrt}
              onCheckedChange={(checked) =>
                updateSetting('printer.auto_anfahrt', checked ? 'true' : 'false')
              }
              disabled={saving === 'printer.auto_anfahrt'}
            />
          </div>

          {/* Test Buttons */}
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleTestPrint}
              disabled={testingConnection || testingPrint || !isEnabled}
            >
              {testingConnection ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <CheckCircle className="h-4 w-4 mr-2" />
              )}
              Verbindung testen
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={handleTestDruck}
              disabled={testingPrint || testingConnection || !isEnabled}
            >
              {testingPrint ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Printer className="h-4 w-4 mr-2" />
              )}
              Testdruck
            </Button>
          </div>

          {/* Testdruck progress — fills over the Pi's expected pickup window */}
          {testPhase && (
            <div className="space-y-1.5" aria-live="polite">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  {testPhase === 'done' ? (
                    <CheckCircle className="h-3.5 w-3.5 text-green-600 dark:text-green-500" />
                  ) : (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  )}
                  {testPhase === 'queued' && 'Warte auf Print-Agent (Pi)…'}
                  {testPhase === 'printing' && 'Drucke…'}
                  {testPhase === 'done' && 'Fertig gedruckt'}
                </span>
                {testPhase === 'queued' && testEta && <span>Abholung {testEta}</span>}
              </div>
              <Progress value={testProgress} />
            </div>
          )}
        </div>
      </Card>

      {/* Print Agent Info */}
      <Card className="p-4">
        <details className="group">
          <summary className="flex items-center gap-2 cursor-pointer font-medium text-sm">
            <Printer className="h-4 w-4" />
            So funktioniert der Thermodruck
          </summary>
          <div className="mt-3 space-y-3 text-sm text-muted-foreground">
            <div className="space-y-1.5">
              <p className="font-medium text-foreground">Aufbau</p>
              <p>
                Ein Print-Agent (Raspberry Pi) im Kommandoposten-Netzwerk fragt das Backend
                regelmässig nach neuen Druckaufträgen ab und sendet diese an den Thermodrucker.
              </p>
            </div>
            <div className="space-y-1.5">
              <p className="font-medium text-foreground">Druckaufträge</p>
              <ul className="list-disc list-inside space-y-1">
                <li><strong>Einsatzzettel</strong> — wird automatisch gedruckt wenn ein Einsatz auf &quot;Disponiert&quot; oder &quot;Einsatz&quot; gesetzt wird, oder manuell über das Kontextmenü</li>
                <li><strong>Board-Snapshot</strong> — über den &quot;Thermo&quot;-Button in der Fussleiste, mit Optionen für abgeschlossene Einsätze, Fahrzeuge und Personal</li>
              </ul>
            </div>
            <div className="space-y-1.5">
              <p className="font-medium text-foreground">Polling-Verhalten</p>
              <p>
                Im Ruhezustand fragt der Agent alle 60 Sekunden ab. Nach einem Druckauftrag
                wechselt er für 15 Minuten auf 5-Sekunden-Intervalle, damit Folgeaufträge
                schneller verarbeitet werden.
              </p>
            </div>
            <div className="space-y-1.5">
              <p className="font-medium text-foreground">Netzwerk</p>
              <p>
                Der Raspberry Pi benötigt Internetzugang (Backend) und LAN-Zugang zum Drucker.
                Nur ausgehende Verbindungen — keine Portfreigaben nötig.
              </p>
            </div>
          </div>
        </details>
      </Card>
    </div>
  );
}
