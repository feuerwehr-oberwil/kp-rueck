'use client';

/**
 * Printer Settings Component
 * Configures thermal printer connection and auto-print behavior
 */

import { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { toast } from 'sonner';

export function PrinterSettings() {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [printerStatus, setPrinterStatus] = useState<ApiPrinterStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [testingConnection, setTestingConnection] = useState(false);
  const [statusLoading, setStatusLoading] = useState(false);

  // Track saved values to detect changes on blur
  const savedSettingsRef = useRef<Record<string, string>>({});

  useEffect(() => {
    loadSettings();
    loadPrinterStatus();
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
      toast.success('Einstellung gespeichert');
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

      if (status?.enabled && status.ip) {
        toast.success('Drucker ist konfiguriert und bereit');
      } else {
        toast.info('Drucker ist nicht aktiviert oder konfiguriert');
      }
    } catch (error) {
      toast.error('Verbindungstest fehlgeschlagen');
    } finally {
      setTestingConnection(false);
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
      <Card className="p-3 border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/30">
        <div className="flex gap-2">
          <Info className="h-4 w-4 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-blue-700 dark:text-blue-300">
            Funktioniert nur mit lokaler Docker-Installation. Print-Agent muss auf dem Kommandoposten laufen.
          </p>
        </div>
      </Card>

      {/* Status */}
      <Card className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {printerStatus?.enabled ? (
              <>
                <CheckCircle className="h-4 w-4 text-green-600" />
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
      <Card>
        <CardHeader>
          <CardTitle>Drucker-Konfiguration</CardTitle>
          <CardDescription>Einstellungen für den Thermodrucker</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Enable/Disable Toggle */}
          <div className="flex items-center justify-between space-x-2">
            <div className="space-y-1">
              <Label htmlFor="printer-enabled">Drucker aktiviert</Label>
              <p className="text-sm text-muted-foreground">Aktiviert die Thermodrucker-Funktionen</p>
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
          <div className="space-y-2">
            <Label htmlFor="printer-ip">Drucker IP-Adresse</Label>
            <Input
              id="printer-ip"
              type="text"
              placeholder="10.10.10.230"
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
            <p className="text-sm text-muted-foreground">Netzwerk-IP des Thermodruckers (z.B. 10.10.10.230)</p>
          </div>

          {/* Port */}
          <div className="space-y-2">
            <Label htmlFor="printer-port">Port</Label>
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
              className="max-w-xs"
            />
            <p className="text-sm text-muted-foreground">ESC/POS Standard-Port (normalerweise 9100)</p>
          </div>

          {/* Auto-print on Anfahrt */}
          <div className="flex items-center justify-between space-x-2">
            <div className="space-y-1">
              <Label htmlFor="auto-anfahrt">Auto-Druck bei Anfahrt</Label>
              <p className="text-sm text-muted-foreground">Automatisch Einsatzzettel drucken bei Status &quot;Einsatz&quot;</p>
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

          {/* Test Button */}
          <div className="flex justify-end pt-4">
            <Button
              variant="outline"
              onClick={handleTestPrint}
              disabled={testingConnection || !isEnabled}
            >
              {testingConnection ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Printer className="h-4 w-4 mr-2" />
              )}
              Verbindung testen
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Print Agent Instructions */}
      <Card className="p-4">
        <details className="group">
          <summary className="flex items-center gap-2 cursor-pointer font-medium text-sm">
            <Printer className="h-4 w-4" />
            Print-Agent starten
          </summary>
          <div className="mt-3 space-y-2 text-sm">
            <div className="bg-muted p-3 rounded-lg font-mono text-xs">
              <p># Mit Docker Compose:</p>
              <p>just print-agent</p>
              <p className="mt-2"># Im Hintergrund:</p>
              <p>just print-agent-bg</p>
            </div>
            <p className="text-muted-foreground text-xs">
              Der Agent verbindet sich automatisch mit dem Backend.
            </p>
          </div>
        </details>
      </Card>
    </div>
  );
}
