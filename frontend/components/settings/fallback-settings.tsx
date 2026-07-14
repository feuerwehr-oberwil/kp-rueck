'use client';

/**
 * Ausfallsicherheit — everything that keeps a usable board state OUTSIDE the
 * system for the moment it fails: automatic thermal snapshots (server-side),
 * the Lageblatt auto-download on this device, and the manual export. See
 * docs/AUSFALL_SOP.md for the operating procedure built on top of these.
 */

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ClipboardList, LifeBuoy, Printer, MonitorDown } from 'lucide-react';
import { toast } from 'sonner';
import { apiClient } from '@/lib/api-client';
import { useEvent } from '@/lib/contexts/event-context';

/** localStorage key for the per-device Lageblatt auto-download (15 min). */
export const LAGEBLATT_AUTODOWNLOAD_KEY = 'kp-lageblatt-autodownload';
/** Fired after the key changes so an already-mounted UserMenu picks it up. */
export const LAGEBLATT_AUTODOWNLOAD_EVENT = 'kp-lageblatt-autodownload-changed';

export function downloadLageblatt(eventId: string, eventName: string) {
  return apiClient.exportEventLageblatt(eventId).then((blob) => {
    const slug =
      eventName
        .toLowerCase()
        .replace(/ä/g, 'ae')
        .replace(/ö/g, 'oe')
        .replace(/ü/g, 'ue')
        .replace(/ß/g, 'ss')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'ereignis';
    const now = new Date();
    const stamp = `${now.toISOString().slice(0, 10)}-${now.toTimeString().slice(0, 5).replace(':', '')}`;
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lageblatt-${slug}-${stamp}.pdf`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  });
}

export function FallbackSettings() {
  const { selectedEvent } = useEvent();
  const [loaded, setLoaded] = useState(false);
  const [autoPrint, setAutoPrint] = useState(false);
  const [printerEnabled, setPrinterEnabled] = useState(false);
  const [interval, setIntervalMin] = useState('15');
  const [saving, setSaving] = useState<string | null>(null);
  const [autoDownload, setAutoDownload] = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    apiClient
      .getAllSettings()
      .then((settings) => {
        setAutoPrint(settings['fallback.auto_print_enabled'] === 'true');
        setPrinterEnabled(settings['printer.enabled'] === 'true');
        setIntervalMin(settings['fallback.auto_print_interval_min'] || '15');
      })
      .catch(() => toast.error('Einstellungen konnten nicht geladen werden'))
      .finally(() => setLoaded(true));
    setAutoDownload(localStorage.getItem(LAGEBLATT_AUTODOWNLOAD_KEY) === 'true');
  }, []);

  const saveSetting = async (key: string, value: string): Promise<boolean> => {
    setSaving(key);
    try {
      await apiClient.updateSetting(key, value);
      return true;
    } catch {
      toast.error('Einstellung konnte nicht gespeichert werden');
      return false;
    } finally {
      setSaving(null);
    }
  };

  const handleAutoPrintToggle = async (on: boolean) => {
    setAutoPrint(on);
    if (!(await saveSetting('fallback.auto_print_enabled', on ? 'true' : 'false'))) {
      setAutoPrint(!on);
    }
  };

  const handleIntervalBlur = async (raw: string) => {
    const clamped = String(Math.max(5, Math.min(120, parseInt(raw) || 15)));
    setIntervalMin(clamped);
    await saveSetting('fallback.auto_print_interval_min', clamped);
  };

  const handleAutoDownloadToggle = (on: boolean) => {
    setAutoDownload(on);
    localStorage.setItem(LAGEBLATT_AUTODOWNLOAD_KEY, on ? 'true' : 'false');
    window.dispatchEvent(new Event(LAGEBLATT_AUTODOWNLOAD_EVENT));
    if (on) {
      toast.success('Lageblatt Auto-Download aktiv', {
        description: 'Dieses Gerät lädt alle 15 Minuten ein aktuelles Lageblatt herunter.',
      });
      if (selectedEvent) {
        downloadLageblatt(selectedEvent.id, selectedEvent.name).catch(() =>
          toast.error('Lageblatt konnte nicht heruntergeladen werden')
        );
      }
    }
  };

  const handleManualDownload = async () => {
    if (!selectedEvent) return;
    setDownloading(true);
    try {
      await downloadLageblatt(selectedEvent.id, selectedEvent.name);
    } catch {
      toast.error('Lageblatt konnte nicht heruntergeladen werden');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Card className="p-6">
      <div className="space-y-6">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <LifeBuoy className="h-5 w-5" />
            Ausfallsicherheit
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            Hält den aktuellen Board-Stand ausserhalb des Systems bereit — auf Papier und auf
            diesem Gerät. Vorgehen im Ausfall: siehe Ausfall-SOP (docs/AUSFALL_SOP.md).
          </p>
        </div>

        {/* Server-side: automatic thermal snapshots */}
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <Label htmlFor="fallback-auto-print" className="font-medium flex items-center gap-2">
              <Printer className="h-4 w-4" />
              Board automatisch drucken (Thermo)
            </Label>
            <p className="text-xs text-muted-foreground">
              Druckt regelmässig einen Board-Schnappschuss, solange ein Live-Ereignis aktiv ist —
              nur wenn sich etwas geändert hat
              {!printerEnabled && loaded ? ' — benötigt aktivierten Drucker (Einstellungen → Drucker)' : ''}
            </p>
          </div>
          <Switch
            id="fallback-auto-print"
            checked={autoPrint}
            onCheckedChange={handleAutoPrintToggle}
            disabled={!loaded || saving === 'fallback.auto_print_enabled'}
          />
        </div>

        {autoPrint && (
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <Label htmlFor="fallback-interval" className="font-medium">Druck-Intervall (Minuten)</Label>
              <p className="text-xs text-muted-foreground">Frühestens alle 5, spätestens alle 120 Minuten</p>
            </div>
            <div className="flex-shrink-0 w-24">
              <Input
                id="fallback-interval"
                type="number"
                min={5}
                max={120}
                value={interval}
                onChange={(e) => setIntervalMin(e.target.value)}
                onBlur={(e) => handleIntervalBlur(e.target.value)}
                disabled={saving === 'fallback.auto_print_interval_min'}
              />
            </div>
          </div>
        )}

        {/* Device-side: Lageblatt auto-download */}
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <Label htmlFor="fallback-auto-download" className="font-medium flex items-center gap-2">
              <MonitorDown className="h-4 w-4" />
              Lageblatt Auto-Download (dieses Gerät)
            </Label>
            <p className="text-xs text-muted-foreground">
              Lädt alle 15 Minuten ein aktuelles Lageblatt (PDF) in den Download-Ordner — bleibt
              auch ohne Netz lesbar und druckbar. Gilt nur für dieses Gerät.
            </p>
          </div>
          <Switch
            id="fallback-auto-download"
            checked={autoDownload}
            onCheckedChange={handleAutoDownloadToggle}
          />
        </div>

        {/* Manual export */}
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <Label className="font-medium flex items-center gap-2">
              <ClipboardList className="h-4 w-4" />
              Lageblatt jetzt herunterladen
            </Label>
            <p className="text-xs text-muted-foreground">
              A4-Führungsformular (BL/BS-Layout) mit allen Einsatzdetails
              {!selectedEvent ? ' — kein Ereignis ausgewählt' : ''}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={handleManualDownload} disabled={!selectedEvent || downloading}>
            Herunterladen
          </Button>
        </div>
      </div>
    </Card>
  );
}
