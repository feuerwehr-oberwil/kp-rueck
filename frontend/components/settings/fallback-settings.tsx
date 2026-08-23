'use client';

/**
 * Ausfallsicherheit — everything that keeps a usable board state OUTSIDE the
 * system for the moment it fails: automatic thermal snapshots (server-side),
 * the Lageblatt auto-download on this device, and the manual export. See
 * docs/AUSFALL_SOP.md for the operating procedure built on top of these.
 */

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { ClipboardList, Printer, MonitorDown } from 'lucide-react';
import { toast } from 'sonner';
import { apiClient } from '@/lib/api-client';
import { useEvent } from '@/lib/contexts/event-context';
import { useTranslations } from 'next-intl';
import { DemoLock } from '@/components/settings/demo-lock';
import { SettingCard, SettingRow } from '@/components/settings/setting-row';
import { downloadLageblatt } from '@/lib/lageblatt';

export function FallbackSettings({
  demoMode = false,
  onOpenDeviceSection,
}: {
  demoMode?: boolean;
  /** Springt zum Abschnitt «Dieses Gerät», wo der Auto-Download jetzt wohnt. */
  onOpenDeviceSection?: () => void;
}) {
  const t = useTranslations('settings');
  const { selectedEvent } = useEvent();
  const [loaded, setLoaded] = useState(false);
  const [autoPrint, setAutoPrint] = useState(false);
  // Ob überhaupt ein Thermodrucker eingerichtet ist – Schalter AN und Adresse gesetzt.
  // Beides kommt aus derselben Einstellungs-Abfrage; ohne beides druckt der Board-
  // Schnappschuss nichts, egal was hier steht.
  const [printerConfigured, setPrinterConfigured] = useState(false);
  const [interval, setIntervalMin] = useState('15');
  const [saving, setSaving] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    apiClient
      .getAllSettings()
      .then((settings) => {
        setAutoPrint(settings['fallback.auto_print_enabled'] === 'true');
        setPrinterConfigured(
          settings['printer.enabled'] === 'true' && (settings['printer.ip'] ?? '').trim() !== '',
        );
        setIntervalMin(settings['fallback.auto_print_interval_min'] || '15');
      })
      .catch(() => toast.error(t('fallback.loadFailed')))
      .finally(() => setLoaded(true));
  }, [t]);

  const saveSetting = async (key: string, value: string): Promise<boolean> => {
    setSaving(key);
    try {
      await apiClient.updateSetting(key, value);
      return true;
    } catch {
      toast.error(t('fallback.saveFailed'));
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

  const handleManualDownload = async () => {
    if (!selectedEvent) return;
    setDownloading(true);
    try {
      await downloadLageblatt(selectedEvent.id, selectedEvent.name);
    } catch {
      toast.error(t('fallback.downloadFailed'));
    } finally {
      setDownloading(false);
    }
  };

  // Ohne eingerichteten Thermodrucker bewirkt der Schnappschuss-Schalter nichts – darum ist
  // er dann gesperrt und sagt weshalb, statt sich umlegen zu lassen und zu schweigen. Ein
  // bereits gespeichertes «an» bleibt stehen und wirkt wieder, sobald der Drucker steht.
  const printerMissing = loaded && !printerConfigured ? t('fallback.autoPrintPrinterRequired') : null;

  return (
    <SettingCard title={t('fallback.title')} subtitle={t('fallback.intro')}>
      {/* Server-side: automatic thermal snapshots (shared setting → locked in demo). */}
      <DemoLock active={demoMode}>
        <SettingRow
          label={t('fallback.autoPrintLabel')}
          htmlFor="fallback-auto-print"
          hint={t('fallback.autoPrintHint')}
          icon={<Printer className="size-3.5 text-muted-foreground" />}
          unavailable={printerMissing}
          unavailableBadge={t('common.notConfiguredBadge')}
        >
          <Switch
            id="fallback-auto-print"
            checked={autoPrint}
            title={printerMissing ?? undefined}
            onCheckedChange={handleAutoPrintToggle}
            disabled={!loaded || !printerConfigured || saving === 'fallback.auto_print_enabled'}
          />
        </SettingRow>

        {autoPrint && (
          <SettingRow
            label={t('fallback.intervalLabel')}
            htmlFor="fallback-interval"
            hint={t('fallback.intervalHint')}
          >
            <Input
              id="fallback-interval"
              type="number"
              className="w-24"
              min={5}
              max={120}
              value={interval}
              onChange={(e) => setIntervalMin(e.target.value)}
              onBlur={(e) => handleIntervalBlur(e.target.value)}
              disabled={saving === 'fallback.auto_print_interval_min'}
            />
          </SettingRow>
        )}
      </DemoLock>

      {/* Device-side: Lageblatt auto-download. Liegt im localStorage – die einzige Zeile
          dieser Karte, die nicht die ganze Station betrifft, und darum die einzige mit
          einer eigenen Marke. */}
      {/* Der automatische Lageblatt-Download liegt in «Dieses Gerät»: er schreibt eine
          Datei in den Download-Ordner DIESES Rechners, nicht in die Anlage. Hier steht
          nur noch, dass es ihn gibt – sonst sucht ihn jeder erst hier. */}
      <SettingRow
        label={t('fallback.autoDownloadLabel')}
        hint={t('fallback.autoDownloadMovedHint')}
        icon={<MonitorDown className="size-3.5 text-muted-foreground" />}
      >
        <Button variant="outline" size="sm" onClick={() => onOpenDeviceSection?.()}>
          {t('fallback.autoDownloadMovedAction')}
        </Button>
      </SettingRow>

      {/* Manual export */}
      <SettingRow
        label={t('fallback.manualLabel')}
        hint={`${t('fallback.manualHint')}${!selectedEvent ? t('fallback.manualNoEvent') : ''}`}
        icon={<ClipboardList className="size-3.5 text-muted-foreground" />}
      >
        <Button variant="outline" size="sm" onClick={handleManualDownload} disabled={!selectedEvent || downloading}>
          {t('fallback.downloadButton')}
        </Button>
      </SettingRow>
    </SettingCard>
  );
}
