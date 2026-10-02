'use client';

/**
 * Unified Settings & Administration Page
 * Sidebar navigation with all configuration and resource management
 *
 * Reached only by editors and admins: `ProtectedRoute` sends every `viewer` to
 * `/display/board` before this renders, so the `isEditor` checks below are constant-true
 * today – see `components/protected-route.tsx` for why they are kept.
 *
 * `activeSection` is read unfiltered from the URL, so `?section=users` and
 * `?section=audit` are reachable by anyone who gets this far. That is safe because the
 * data is not: `GET /api/users` requires `CurrentAdmin` and `GET /api/audit` requires
 * `CurrentEditor`, so those panels render empty rather than leaking. If you add a
 * section here, gate its endpoint on the backend – not just its sidebar entry.
 */

import { useMemo, useState, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/contexts/auth-context';
import { useEvent } from '@/lib/contexts/event-context';
import { apiClient } from '@/lib/api-client';
import { ProtectedRoute } from '@/components/protected-route';
import { SearchInput } from '@/components/ui/search-input'
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  WHATSAPP_MESSAGE_1_KEY,
  WHATSAPP_MESSAGE_2_KEY,
  DEFAULT_WHATSAPP_MESSAGE_1,
  DEFAULT_WHATSAPP_MESSAGE_2,
} from '@/lib/checklist-tasks';
import {
  WHATSAPP_INCIDENT_TEMPLATE_KEY,
  DEFAULT_WHATSAPP_INCIDENT_TEMPLATE,
} from '@/lib/message-template';
import {
  FELD_MESSAGE_CHIPS_KEY,
  DEFAULT_FELD_MESSAGE_CHIPS,
  FELD_DRIVER_MESSAGE_CHIPS_KEY,
  DEFAULT_FELD_DRIVER_MESSAGE_CHIPS,
} from '@/lib/pickup';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useGlobalNavigation } from '@/lib/hooks/use-global-navigation';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Settings2,
  Bell,
  RefreshCw,
  Users,
  Truck,
  Package,
  FileSpreadsheet,
  FileText,
  Save,
  Printer,
  Shield,
  Info,
  Megaphone,
  Inbox,
  Navigation,
  LifeBuoy,
  MessageSquareWarning,
  MonitorCog,
  ClipboardCheck,
  Route,
  Plug,
} from 'lucide-react';
import { useMessages, useTranslations } from 'next-intl';
import { useIntlLocale } from '@/lib/date-locale';
import { toast } from 'sonner';
import { PageNavigation } from '@/components/page-navigation';
import { MobileBottomNavigation } from '@/components/mobile-bottom-navigation';
import { NotificationSettingsCard } from '@/components/notifications/notification-settings';
import { AlarmWebhookSecretCard } from '@/components/settings/alarm-webhook-secret-card';
import { ExcelImportSection } from '@/components/settings/excel-import-section';
import { AuditLogSection } from '@/components/settings/audit-log-section';
import { useAuditLog } from '@/components/settings/use-audit-log';
import { useExcelImport } from '@/components/settings/use-excel-import';
import {
  LATITUDE_RANGE,
  LONGITUDE_RANGE,
  normalizeDecimal,
  validateRangedSetting,
  type SettingRange,
  type SettingValidationError,
} from '@/components/settings/setting-validation';
import { DiveraAlarmSettingsCard } from '@/components/divera/divera-alarm-settings-card';
import { GpsSettingsCard } from '@/components/settings/gps-settings';
import { AlarmDescriptionFilterSettings } from '@/components/settings/alarm-description-filter-settings';
import { SyncStatusCard } from '@/components/sync/sync-status-card';
import { SyncConfigCard } from '@/components/sync/sync-config-card';
import { SyncHistoryCard } from '@/components/sync/sync-history-card';
import { PersonnelSettings } from '@/components/settings/personnel-settings';
import { VehicleSettings } from '@/components/settings/vehicle-settings';
import { MaterialSettings } from '@/components/settings/material-settings';
import { PrinterSettings } from '@/components/settings/printer-settings';
import { FallbackSettings } from '@/components/settings/fallback-settings';
import { DeviceSettings } from '@/components/settings/device-settings';
import { ChecklistSettings } from '@/components/settings/checklist-settings';
import { AuftragTemplateSettings } from '@/components/settings/auftrag-template-settings';
import { UserSettings } from '@/components/settings/user-settings';
import { DemoLock } from '@/components/settings/demo-lock';
import {
  SettingBlock,
  SettingCard,
  SettingRow,
} from '@/components/settings/setting-row';
import { SettingUnavailableNote } from '@/components/settings/setting-unavailable';
import { IntegrationsSection } from './integrations-section';
import { useTileAvailability } from '@/lib/hooks/use-tile-availability';
import { BrandingSettings } from '@/components/settings/branding-settings';
import { TelemetrySettings } from '@/components/settings/telemetry-settings';
import { Skeleton } from '@/components/ui/skeleton';
import { useSyncStatus } from '@/lib/hooks/use-sync-status';
import { useRailwayRecovery } from '@/lib/hooks/use-railway-recovery';
import { useIsMobile } from '@/components/ui/use-mobile';
import { searchSettings } from '@/lib/settings-search';

/**
 * Der Beleg eines Suchtreffers: der Katalogtext mit hervorgehobener Fundstelle.
 * Gekürzt wird UM die Fundstelle herum – ein Beleg, der vor dem Treffer endet
 * («Benachrichtigung wenn…»), belegt nichts.
 */
function SearchHitEvidence({ text, matchStart, matchEnd }: { text: string; matchStart: number; matchEnd: number }) {
  const WINDOW = 30;
  const from = Math.max(0, matchStart - WINDOW);
  return (
    <span className="block truncate pl-5 text-xs">
      {from > 0 ? '…' : ''}
      {text.slice(from, matchStart)}
      <mark className="rounded-[2px] bg-warning/25 text-inherit">{text.slice(matchStart, matchEnd)}</mark>
      {text.slice(matchEnd)}
    </span>
  );
}

/**
 * Die Gruppen der Seitenleiste, in ihrer Reihenfolge.
 *
 * Sortiert nach **wie oft man sie anfasst**, nicht nach Sachgebiet. Vorher hiess die
 * erste «Konfiguration» und enthielt 11 von 17 Abschnitten – eine Gruppe, die nie falsch
 * sein kann, sagt auch nichts. Die Drucker-Adresse und der Traccar-Zugang werden einmal
 * pro Station gesetzt; Standard-Aufträge und die Checkliste pflegt das Kommando laufend.
 * Genau diesen Unterschied will man vor dem Klicken kennen.
 *
 * `device` steht zuoberst und für sich: alles darin liegt im Browser (Cookie,
 * localStorage, next-themes) und gilt nur auf diesem Bildschirm – und Erscheinungsbild
 * und Sprache sind das, was auch ein Viewer am ehesten sucht. Solange das über die
 * Seite verstreut war, brauchte jede einzelne Zeile eine Marke, um ihre Reichweite
 * anzuzeigen – jetzt trägt die Gliederung sie, und die Marke ist weg.
 */
const GROUPS = ['device', 'setup', 'operations', 'resources', 'records'] as const;

// Sidebar sections configuration (labels come from settings.page.sections.*)
const SECTIONS = [
  // ---- Dieses Gerät: Erscheinungsbild, Sprache, Auto-Download. Alles im Browser.
  { id: 'device', icon: MonitorCog, group: 'device', editorOnly: false, adminOnly: false },

  // ---- Einrichtung: einmal pro Station, meistens beim Aufbau
  { id: 'general', icon: Settings2, group: 'setup', editorOnly: false, adminOnly: false },
  // Read-only view of the capability registry (`GET /api/integrations`). No controls:
  // the keys it reports live in the server configuration, not in a form field here.
  { id: 'integrations', icon: Plug, group: 'setup', editorOnly: false, adminOnly: false },
  { id: 'printer', icon: Printer, group: 'setup', editorOnly: true, adminOnly: false },
  { id: 'gps', icon: Navigation, group: 'setup', editorOnly: true, adminOnly: false },
  { id: 'users', icon: Shield, group: 'setup', editorOnly: false, adminOnly: true },
  // Sync can rewrite whole tables and points at a database URL – admin-only (matches /api/sync/*).
  { id: 'sync', icon: RefreshCw, group: 'setup', editorOnly: false, adminOnly: true },

  // ---- Betrieb: was das Kommando über die Saison pflegt
  // Alarmierung ist an der RICHTUNG geteilt, nicht am Anbieter: was die Station
  // hinausschickt (WhatsApp-Vorlagen, Divera) gegen das, was hereinkommt (der
  // Alarmtext der Zentrale, der Webhook-Schlüssel, die Meldungs-Chips, mit denen
  // ein Trupp zurückmeldet). Zusammen war das ein Abschnitt von ~2500 Pixeln, in
  // dem «Alarmtext bereinigen» unter einer Überschrift «Alarmierung» stand und
  // darum nicht zu finden war. Die id `alerting` bleibt der ausgehenden Hälfte,
  // damit bestehende `?section=alerting`-Links nicht ins Leere zeigen.
  { id: 'alerting', icon: Megaphone, group: 'operations', editorOnly: true, adminOnly: false },
  { id: 'alarmIntake', icon: Inbox, group: 'operations', editorOnly: true, adminOnly: false },
  { id: 'notifications', icon: Bell, group: 'operations', editorOnly: false, adminOnly: false },
  { id: 'checklist', icon: ClipboardCheck, group: 'operations', editorOnly: true, adminOnly: false },
  { id: 'auftragTemplates', icon: Route, group: 'operations', editorOnly: true, adminOnly: false },
  { id: 'fallback', icon: LifeBuoy, group: 'operations', editorOnly: true, adminOnly: false },

  // ---- Bestand
  { id: 'personnel', icon: Users, group: 'resources', editorOnly: true, adminOnly: false },
  { id: 'vehicles', icon: Truck, group: 'resources', editorOnly: true, adminOnly: false },
  { id: 'materials', icon: Package, group: 'resources', editorOnly: true, adminOnly: false },

  // ---- Protokoll
  { id: 'import', icon: FileSpreadsheet, group: 'records', editorOnly: true, adminOnly: false },
  { id: 'audit', icon: FileText, group: 'records', editorOnly: true, adminOnly: false },
  // Not adminOnly: «Problem melden» is for whoever hit the problem. The consent switch
  // inside the section is what checks isAdmin — and it is the only gate now. The whole
  // «Daten» group used to be wrapped in `isEditor &&`, so a viewer who hit a problem
  // could not reach the one section written for them.
  // Nicht LifeBuoy: das trägt schon «Ausfallsicherheit». Zwei Einträge derselben Liste
  // mit demselben Symbol heben die Symbolspalte auf – sie ist dann Dekoration.
  { id: 'telemetry', icon: MessageSquareWarning, group: 'records', editorOnly: false, adminOnly: false },

] as const;

type SectionId = typeof SECTIONS[number]['id'];

interface SettingConfig {
  key: string;
  type: 'number' | 'boolean' | 'text' | 'select';
  unit?: string;
  options?: string[];
  /** Inclusive bounds for a `number`. Rejected client-side – the PATCH stores any string. */
  range?: SettingRange;
}

// Labels/descriptions/option labels come from settings.page.general.configs.*
const SETTING_CONFIGS: SettingConfig[] = [
  {
    key: 'home_city',
    type: 'text',
  },
  {
    key: 'funkrufname',
    type: 'text',
  },
  // Pre-printed next to the «Kommandant» signature line on the Einsatzrapport
  // (mirrors KP Front). Empty = the line stays blank.
  {
    key: 'kommandant_name',
    type: 'text',
  },
  // Station identity. All three have been PATCHable through the generic settings
  // endpoint since 0.4.0 (they are in the backend's DEFAULT_SETTINGS allowlist) –
  // what was missing is only this, the surface docs/SETUP.md already told operators
  // to use. `seed.py` writes "Feuerwehr Musterstadt" at 47.5596 / 7.5886 into a
  // fresh PRODUCTION install, so the failure mode is not a blank field: it is a
  // placeholder nobody is prompted to replace, quietly centring the map and
  // biasing every address search on a town the brigade has never been to.
  // (Dev, demo and staging seed Oberwil instead — their sample incidents are
  // real addresses there, and a matching home city is what makes the board
  // strip it off them.)
  {
    key: 'firestation_name',
    type: 'text',
  },
  {
    key: 'firestation_latitude',
    type: 'number',
    range: LATITUDE_RANGE,
  },
  {
    key: 'firestation_longitude',
    type: 'number',
    range: LONGITUDE_RANGE,
  },
  {
    key: 'map_mode',
    type: 'select',
    options: ['auto', 'online', 'offline'],
  },
  {
    key: 'map_style',
    type: 'select',
    options: ['osm', 'topo', 'carto-light', 'carto-dark'],
  },
  {
    key: 'incident_time_display',
    type: 'select',
    options: ['start', 'column', 'total'],
  },
];

export default function SettingsPage() {
  useGlobalNavigation();
  const t = useTranslations('settings');
  const intlLocale = useIntlLocale();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { isEditor, isAdmin, isAuthenticated } = useAuth();
  const { events, isLoading: eventsLoading } = useEvent();
  const isMobile = useIsMobile();
  // Active section from URL or default
  const sectionParam = searchParams.get('section') as SectionId | null;
  const activeSection = sectionParam && SECTIONS.some(s => s.id === sectionParam)
    ? sectionParam
    : 'general';

  // General settings state
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [serverSettings, setServerSettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  // Per-key validation failures for the ranged settings (the station coordinates).
  // A rejected value stays in the input so the operator can fix the typo instead of
  // retyping the whole coordinate – it is simply not PATCHed.
  const [settingErrors, setSettingErrors] = useState<Record<string, SettingValidationError>>({});
  const [historyRefreshTrigger, setHistoryRefreshTrigger] = useState(0);

  // Sync status
  const { status: syncStatus, isLoading: isSyncLoading, error: syncError, isStale } = useSyncStatus();
  useRailwayRecovery(syncStatus);

  // Are there real offline map tiles on this server? Answered next to the Karten-Modus
  // select, because that is where «Nur Offline» gets chosen – and choosing it without
  // tiles blanks the map for the whole station, silently.
  const { availability: tiles, recheck: recheckTiles } = useTileAvailability();
  // Only refuse the option when we positively KNOW there is nothing to fall back to.
  // A tile server that merely fails to answer right now must not lock an operator out
  // of a setting – and the option that is already stored stays selectable either way,
  // otherwise the select would show a disabled item as its own value.
  const offlineTilesUnavailable = tiles.status === 'bootstrap' || tiles.status === 'missing';

  // Import/Export state and handlers — see use-excel-import. The «Ersetzen»
  // confirmation stays on the page (it renders outside the section).
  const excelImport = useExcelImport(activeSection, isEditor);
  const { preview, replaceConfirmOpen, setReplaceConfirmOpen, selectImportMode, handleImport, setImportError } = excelImport;

  // Demo mode detection
  const [demoMode, setDemoMode] = useState(false);
  useEffect(() => {
    apiClient.getDemoStatus().then((status) => setDemoMode(status?.demo === true));
  }, []);

  // The audit section: export, log, filters — see use-audit-log. Called here so
  // its fetch effect keeps its place after the demo-status one.
  const auditLog = useAuditLog({ activeSection, isEditor, events, setImportError });

  const handleSyncComplete = () => {
    setHistoryRefreshTrigger((prev) => prev + 1);
  };

  // Navigate to section
  const navigateToSection = (sectionId: SectionId) => {
    router.push(`/settings?section=${sectionId}`, { scroll: false });
  };

  // Fetch general settings
  const fetchSettings = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.getAllSettings();
      setSettings(data);
      setServerSettings(data);
    } catch (err) {
      console.error('Failed to fetch settings:', err);
      setError(err instanceof Error ? err.message : t('common.loadError'));
      toast.error(t('common.loadSettingsError'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
      fetchSettings();
    }
  }, [isAuthenticated]);

  const updateSetting = async (key: string, value: string) => {
    if (!isEditor) {
      toast.error(t('page.toasts.editorsOnly'));
      return;
    }
    setSaving(key);
    try {
      await apiClient.updateSetting(key, value);
      setSettings((prev) => ({ ...prev, [key]: value }));
      setServerSettings((prev) => ({ ...prev, [key]: value }));
    } catch (err) {
      console.error(`Failed to update setting ${key}:`, err);
      toast.error(t('common.saveError'));
    } finally {
      setSaving(null);
    }
  };

  // Render setting input
  const renderSettingInput = (config: SettingConfig) => {
    const value = settings[config.key] || '';
    const isCurrentlySaving = saving === config.key;

    // Boolean without options → render as Switch
    if (config.type === 'boolean' && !config.options) {
      return (
        <Switch
          id={config.key}
          checked={value === 'true' || value === ''}
          onCheckedChange={(checked) => updateSetting(config.key, String(checked))}
          disabled={!isEditor || isCurrentlySaving}
        />
      );
    }

    if ((config.type === 'boolean' || config.type === 'select') && config.options) {
      return (
        <Select
          value={value}
          onValueChange={(newValue) => updateSetting(config.key, newValue)}
          disabled={!isEditor || isCurrentlySaving}
        >
          <SelectTrigger id={config.key} className="w-full">
            <SelectValue placeholder={t('page.general.selectPlaceholder')} />
          </SelectTrigger>
          <SelectContent>
            {config.options.map((option) => {
              const unavailable =
                config.key === 'map_mode' &&
                option === 'offline' &&
                offlineTilesUnavailable &&
                value !== option;
              return (
                <SelectItem key={option} value={option} disabled={unavailable}>
                  {t(`page.general.configs.${config.key}.options.${option}`)}
                  {unavailable && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      {t('page.general.tiles.optionUnavailable')}
                    </span>
                  )}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      );
    }

    const validationError = settingErrors[config.key];

    return (
      <div className="space-y-1">
        <Input
          id={config.key}
          // `text`, not `number`, even for the ranged ones: a number input silently
          // discards a pasted "47,5164" instead of letting the comma be normalised,
          // and its spinner is useless at six decimal places.
          type="text"
          inputMode={config.range ? 'decimal' : undefined}
          value={value}
          aria-invalid={validationError ? true : undefined}
          aria-describedby={validationError ? `${config.key}-error` : undefined}
          onChange={(e) => {
            setSettings((prev) => ({ ...prev, [config.key]: e.target.value }));
            setSettingErrors((prev) => {
              if (!(config.key in prev)) return prev;
              const { [config.key]: _removed, ...rest } = prev;
              return rest;
            });
          }}
          onBlur={(e) => {
            const raw = e.target.value;
            if (config.range) {
              const problem = validateRangedSetting(raw, config.range);
              if (problem) {
                setSettingErrors((prev) => ({ ...prev, [config.key]: problem }));
                return;
              }
            }
            const next = config.range ? normalizeDecimal(raw) : raw;
            if (next !== raw) setSettings((prev) => ({ ...prev, [config.key]: next }));
            if (next !== serverSettings[config.key]) {
              updateSetting(config.key, next);
            }
          }}
          disabled={!isEditor || isCurrentlySaving}
        />
        {validationError && config.range && (
          <p id={`${config.key}-error`} className="text-xs text-destructive">
            {t(`page.general.validation.${validationError}`, {
              min: config.range.min,
              max: config.range.max,
            })}
          </p>
        )}
      </div>
    );
  };

  /**
   * The line under Karten-Modus that says whether an offline fallback exists at all.
   *
   * It checks rather than believes: `scripts/init-tileserver.sh` creates an empty
   * bootstrap MBTiles on first start, so a tile file that merely exists proves nothing.
   * `unreachable` says exactly that – we could not ask – instead of inventing a verdict.
   */
  const renderTileAvailability = () => {
    if (tiles.status === 'checking') return null;

    const installed = tiles.status === 'installed';
    const zoom =
      tiles.status === 'installed' && tiles.minzoom !== null && tiles.maxzoom !== null
        ? t('page.general.tiles.zoomRange', { min: tiles.minzoom, max: tiles.maxzoom })
        : null;

    return (
      <div className="space-y-2 pl-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant="outline"
            className={
              installed
                ? 'border-success/40 bg-success/10 text-success-foreground'
                : 'border-warning/40 bg-warning/10 text-warning-foreground'
            }
          >
            {t(`page.general.tiles.${tiles.status}`)}
          </Badge>
          {tiles.status === 'installed' && (
            <span className="text-xs text-muted-foreground">
              {[tiles.name, zoom, t('page.general.tiles.checkedAt', {
                time: tiles.checkedAt.toLocaleTimeString(intlLocale, { hour: '2-digit', minute: '2-digit' }),
              })]
                .filter(Boolean)
                .join(' · ')}
            </span>
          )}
          <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={recheckTiles}>
            <RefreshCw className="size-3" />
            {t('page.general.tiles.recheck')}
          </Button>
        </div>
        {!installed && (
          <SettingUnavailableNote>
            {t(
              tiles.status === 'unreachable'
                ? 'page.general.tiles.unreachableHint'
                : 'page.general.tiles.hint',
            )}
          </SettingUnavailableNote>
        )}
      </div>
    );
  };

  // Filter sections based on editor role. Memoised because the search below depends on
  // it — a fresh array every render would re-run the catalogue scan on every keystroke
  // anywhere on the page, not only on the search field.
  const visibleSections = useMemo(
    () => SECTIONS.filter(s => (!s.editorOnly || isEditor) && (!s.adminOnly || isAdmin)),
    [isEditor, isAdmin],
  );

  // Suche. `null` heisst «nichts eingetippt» und lässt die Gliederung stehen; eine leere
  // Liste heisst «gesucht und nichts gefunden» und sagt das auch.
  const [search, setSearch] = useState('');
  // Tastatur: ↑/↓ bewegen die Auswahl über die Trefferliste, Enter öffnet sie.
  const [searchSelected, setSearchSelected] = useState(0);
  const messages = useMessages() as Record<string, unknown>;
  const searchHits = useMemo(() => {
    if (search.trim().length < 2) return null;
    return searchSettings(
      messages,
      search,
      visibleSections.map(s => ({ id: s.id, label: t(`page.sections.${s.id}`) })),
    );
  }, [messages, search, visibleSections, t]);
  useEffect(() => setSearchSelected(0), [search]);

  /**
   * Ein Treffer führt zur ZEILE, nicht zum Abschnittsanfang: nach dem Wechsel wird der
   * Katalogtext, der gepasst hat, im gerenderten Abschnitt gesucht, ins Bild gescrollt
   * und kurz markiert. Der Index kommt aus dem Katalog (lib/settings-search.ts), und
   * genau derselbe Text steht auf dem Bildschirm – die Verbindung braucht deshalb
   * keine zweite, handgepflegte Schlüsselliste. Interpolierte Texte ({count} …)
   * finden kein DOM-Gegenstück; dann bleibt es beim Abschnittswechsel von früher.
   */
  const jumpToHit = (hit: { section: string; text: string }) => {
    navigateToSection(hit.section as SectionId);
    setSearch('');
    // Zwei Frames Abstand: der Abschnitt muss erst rendern.
    window.setTimeout(() => {
      const scope = document.querySelector('main') ?? document.body;
      const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
      const wanted = hit.text.trim();
      let node: Node | null;
      let found: HTMLElement | null = null;
      while ((node = walker.nextNode())) {
        if (node.textContent?.trim() === wanted) {
          found = node.parentElement;
          break;
        }
      }
      if (!found) return;
      const row = (found.closest('[data-slot="setting-row"]') ?? found) as HTMLElement;
      row.scrollIntoView({ block: 'center', behavior: 'smooth' });
      row.classList.add('settings-search-flash');
      window.setTimeout(() => row.classList.remove('settings-search-flash'), 2600);
    }, 160);
  };

  const DemoHint = ({ text }: { text: string }) => (
    demoMode ? (
      <div className="flex items-center gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning-foreground">
        <Info className="h-4 w-4 flex-shrink-0" />
        {text}
      </div>
    ) : null
  );

  // Render content based on active section
  const renderContent = () => {
    switch (activeSection) {
      case 'general':
        return (
          <div className="space-y-6">
            {/* Nur noch Stationswerte: Erscheinungsbild und Sprache sind nach
                «Dieses Gerät» gezogen. Damit braucht keine Zeile dieser Karte mehr
                eine Reichweiten-Marke – der Abschnitt IST die Reichweite. */}
            <SettingCard>
              {loading ? (
                <div className="space-y-4 pt-3">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : error ? (
                <div className="pt-3">
                  <p className="text-destructive">{error}</p>
                  <Button onClick={fetchSettings} className="mt-4">{t('common.retry')}</Button>
                </div>
              ) : (
                <DemoLock active={demoMode}>
                  {SETTING_CONFIGS.map((config) => (
                    <SettingRow
                      key={config.key}
                      label={t(`page.general.configs.${config.key}.label`)}
                      htmlFor={config.key}
                      hint={t(`page.general.configs.${config.key}.description`)}
                      // What «Nur Offline» would actually get you, right at the control
                      // that offers it – see use-tile-availability.ts.
                      footer={config.key === 'map_mode' ? renderTileAvailability() : null}
                    >
                      <div className="flex w-full items-start gap-2">
                        {/* Schalter drängen sich an die rechte Kante, alles mit einem Feld
                            füllt die Spalte – so steht eine Kante über die ganze Karte. */}
                        <div className={config.type === 'boolean' && !config.options ? 'ml-auto' : 'min-w-0 flex-1'}>
                          {renderSettingInput(config)}
                        </div>
                        {saving === config.key && <Save className="mt-2.5 h-4 w-4 shrink-0 text-primary animate-pulse" />}
                      </div>
                    </SettingRow>
                  ))}
                  {/* Renders its own <SettingRow>, so it needs no spacer of its own. */}
                  <BrandingSettings readOnly={!isEditor} />
                </DemoLock>
              )}
            </SettingCard>
            {!isEditor && (
              <p className="text-sm text-muted-foreground">
                {t('page.general.editorsOnlyNote')}
              </p>
            )}
          </div>
        );

      case 'notifications': {
        return (
          <div className="space-y-6">
            <DemoLock active={demoMode}>
              <NotificationSettingsCard />
            </DemoLock>
          </div>
        );
      }

      case 'alerting': {
        const whatsappFields = [
          {
            key: WHATSAPP_MESSAGE_1_KEY,
            label: t('page.alerting.message1Label'),
            hint: t('page.alerting.message1Hint'),
            fallback: DEFAULT_WHATSAPP_MESSAGE_1,
          },
          {
            key: WHATSAPP_MESSAGE_2_KEY,
            label: t('page.alerting.message2Label'),
            hint: t('page.alerting.message2Hint'),
            fallback: DEFAULT_WHATSAPP_MESSAGE_2,
          },
        ];
        return (
          <div className="space-y-6">
            <DemoLock active={demoMode}>
            <SettingCard
              title={t('page.alerting.whatsappTitle')}
              subtitle={t('page.alerting.whatsappDescription')}
            >
              {whatsappFields.map((field) => {
                const value = settings[field.key] !== undefined ? settings[field.key] : field.fallback;
                const isCurrentlySaving = saving === field.key;
                return (
                  <SettingBlock
                    key={field.key}
                    label={field.label}
                    htmlFor={field.key}
                    hint={field.hint}
                    action={
                      <Button
                        variant="ghost"
                        size="xs"
                        className="text-muted-foreground"
                        disabled={!isEditor || isCurrentlySaving || value === field.fallback}
                        onClick={() => updateSetting(field.key, field.fallback)}
                      >
                        {t('common.reset')}
                      </Button>
                    }
                  >
                    <Textarea
                      id={field.key}
                      value={value}
                      rows={6}
                      className="font-mono text-xs"
                      onChange={(e) => setSettings((prev) => ({ ...prev, [field.key]: e.target.value }))}
                      onBlur={(e) => {
                        if (e.target.value !== (serverSettings[field.key] ?? field.fallback)) {
                          updateSetting(field.key, e.target.value);
                        }
                      }}
                      disabled={!isEditor || isCurrentlySaving}
                    />
                  </SettingBlock>
                );
              })}
            </SettingCard>
            {(() => {
              const key = WHATSAPP_INCIDENT_TEMPLATE_KEY;
              const fallback = DEFAULT_WHATSAPP_INCIDENT_TEMPLATE;
              const value = settings[key] !== undefined ? settings[key] : fallback;
              const isCurrentlySaving = saving === key;
              return (
                <SettingCard
                  title={t('page.alerting.incidentTemplateTitle')}
                  subtitle={
                    <>
                      {t('page.alerting.incidentTemplateDescription')}{' '}
                      <code className="font-mono">{'{type}'}</code>,{' '}
                      <code className="font-mono">{'{location}'}</code>,{' '}
                      <code className="font-mono">{'{notes}'}</code>,{' '}
                      <code className="font-mono">{'{contact}'}</code>,{' '}
                      <code className="font-mono">{'{internal_notes}'}</code>,{' '}
                      <code className="font-mono">{'{vehicles}'}</code>,{' '}
                      <code className="font-mono">{'{crew}'}</code>,{' '}
                      <code className="font-mono">{'{materials}'}</code>,{' '}
                      <code className="font-mono">{'{reko}'}</code>,{' '}
                      <code className="font-mono">{'{timestamp}'}</code>.
                    </>
                  }
                >
                  <SettingBlock
                    label={t('page.alerting.templateLabel')}
                    htmlFor={key}
                    action={
                      <Button
                        variant="ghost"
                        size="xs"
                        className="text-muted-foreground"
                        disabled={!isEditor || isCurrentlySaving || value === fallback}
                        onClick={() => updateSetting(key, fallback)}
                      >
                        {t('common.reset')}
                      </Button>
                    }
                  >
                    <Textarea
                      id={key}
                      value={value}
                      rows={14}
                      className="font-mono text-xs"
                      onChange={(e) => setSettings((prev) => ({ ...prev, [key]: e.target.value }))}
                      onBlur={(e) => {
                        if (e.target.value !== (serverSettings[key] ?? fallback)) {
                          updateSetting(key, e.target.value);
                        }
                      }}
                      disabled={!isEditor || isCurrentlySaving}
                    />
                  </SettingBlock>
                </SettingCard>
              );
            })()}
            <DiveraAlarmSettingsCard
              settings={settings}
              serverSettings={serverSettings}
              setSettings={setSettings}
              updateSetting={updateSetting}
              isEditor={isEditor}
              saving={saving}
            />
            </DemoLock>
          </div>
        );
      }

      // Die hereinkommende Hälfte: was die Alarmzentrale schickt, womit sie sich
      // ausweist, und was ein Trupp im Feld zurückmeldet.
      case 'alarmIntake': {
        return (
          <div className="space-y-6">
            <DemoLock active={demoMode}>
            {/* What the dispatch system puts into every alarm text – standing lines
                dropped whole, labels stripped off kept lines. Both lists ship empty,
                so an install that configures nothing filters nothing. */}
            <AlarmDescriptionFilterSettings
              settings={settings}
              serverSettings={serverSettings}
              setSettings={setSettings}
              updateSetting={updateSetting}
              isEditor={isEditor}
              saving={saving}
            />
            {/* The credential the dispatch provider signs POST /api/alarms with –
                admin-only, and next to the inbound filter above because that is the
                same half of the Alarmierung. Reading it is a rate-limited, audited
                call, so the card fetches nothing until asked. */}
            {isAdmin && <AlarmWebhookSecretCard />}
            {/* /feld Meldungs-Chips (plan 25, decision 20). Station config, NOT
                i18n: a brigade rewords them without a translation round – the
                same reasoning that puts the message templates above on this
                page instead of in de.json. One chip per line. */}
            {/* Two sets in one card: what a crew radios in, and what a FAHRER
                does. A driver cannot report «Angekommen» or «Einsatz beendet»
                at all, so the crew's chips are the wrong four for the person
                sitting outside in the vehicle. */}
            <SettingCard
              title={t('page.alarmIntake.feldChipsTitle')}
              subtitle={t('page.alarmIntake.feldChipsDescription')}
            >
              {([
                { key: FELD_MESSAGE_CHIPS_KEY, fallback: DEFAULT_FELD_MESSAGE_CHIPS, label: t('page.alarmIntake.feldChipsLabel') },
                { key: FELD_DRIVER_MESSAGE_CHIPS_KEY, fallback: DEFAULT_FELD_DRIVER_MESSAGE_CHIPS, label: t('page.alarmIntake.feldDriverChipsLabel') },
              ] as const).map(({ key, fallback, label }) => {
                const value = settings[key] !== undefined ? settings[key] : fallback;
                const isCurrentlySaving = saving === key;
                return (
                  <SettingBlock
                    key={key}
                    label={label}
                    htmlFor={key}
                    action={
                      <Button
                        variant="ghost"
                        size="xs"
                        className="text-muted-foreground"
                        disabled={!isEditor || isCurrentlySaving || value === fallback}
                        onClick={() => updateSetting(key, fallback)}
                      >
                        {t('common.reset')}
                      </Button>
                    }
                  >
                    <Textarea
                      id={key}
                      value={value}
                      rows={5}
                      className="text-xs"
                      onChange={(e) => setSettings((prev) => ({ ...prev, [key]: e.target.value }))}
                      onBlur={(e) => {
                        if (e.target.value !== (serverSettings[key] ?? fallback)) {
                          updateSetting(key, e.target.value);
                        }
                      }}
                      disabled={!isEditor || isCurrentlySaving}
                    />
                  </SettingBlock>
                );
              })}
            </SettingCard>
            </DemoLock>
          </div>
        );
      }

      case 'checklist': {
        return (
          <div className="space-y-6">
            <DemoLock active={demoMode}>
              <ChecklistSettings readOnly={!isEditor || demoMode} />
            </DemoLock>
          </div>
        );
      }

      case 'auftragTemplates': {
        return (
          <div className="space-y-6">
            <DemoLock active={demoMode}>
              <AuftragTemplateSettings readOnly={!isEditor || demoMode} />
            </DemoLock>
          </div>
        );
      }

      case 'gps': {
        return (
          <div className="space-y-6">
            <DemoLock active={demoMode}>
              <GpsSettingsCard
                settings={settings}
                serverSettings={serverSettings}
                setSettings={setSettings}
                updateSetting={updateSetting}
                isEditor={isEditor}
                saving={saving}
              />
            </DemoLock>
          </div>
        );
      }

      case 'integrations':
        return <IntegrationsSection />;

      case 'sync':
        return demoMode ? (
          <DemoHint text={t('page.demo.sync')} />
        ) : (
          <div className="space-y-6">
            <SyncStatusCard
              status={syncStatus}
              isLoading={isSyncLoading}
              error={syncError}
              isStale={isStale}
              onSyncComplete={handleSyncComplete}
            />
            <SyncConfigCard />
            <SyncHistoryCard refreshTrigger={historyRefreshTrigger} />
          </div>
        );

      case 'printer':
        return (
          <div className="space-y-6">
            <DemoLock active={demoMode}>
              <PrinterSettings />
            </DemoLock>
          </div>
        );

      case 'fallback':
        return (
          <div className="space-y-6">
            <FallbackSettings demoMode={demoMode} onOpenDeviceSection={() => navigateToSection('device')} />
          </div>
        );

      case 'device':
        return <DeviceSettings />;

      case 'telemetry':
        return <TelemetrySettings isAdmin={isAdmin} />;

      case 'users':
        return (
          <div className="space-y-6">
            <DemoLock active={demoMode}>
              <UserSettings />
            </DemoLock>
          </div>
        );

      case 'personnel':
        // Lock is applied inside so the "Sortierung" tab stays viewable in demo.
        return <PersonnelSettings demoMode={demoMode} />;

      case 'vehicles':
        return (
          <DemoLock active={demoMode}>
            <VehicleSettings />
          </DemoLock>
        );

      case 'materials':
        // Lock is applied inside so the "Sortierung" tab stays viewable in demo.
        return <MaterialSettings demoMode={demoMode} />;

      case 'import':
        return <ExcelImportSection importer={excelImport} demoMode={demoMode} />;

      case 'audit':
        return <AuditLogSection audit={auditLog} events={events} eventsLoading={eventsLoading} />;

      default:
        return null;
    }
  };

  return (
    <ProtectedRoute>
      <div className="flex h-full flex-col bg-background">
        {/* Header */}
        <header className="flex items-center justify-between border-b px-4 md:px-6 py-2 min-h-14">
          <div className="flex items-center gap-3">
            <h1 className="text-xl md:text-2xl font-bold tracking-tight">{t('page.title')}</h1>
          </div>
          {!isMobile && <PageNavigation currentPage="settings" />}
        </header>

        {/* Main content with sidebar – stack on mobile (selector above content),
            side-by-side sidebar on desktop. */}
        <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
          {/* Sidebar - Desktop */}
          {!isMobile && (
            <aside className="w-56 border-r bg-muted/30 p-4 overflow-y-auto">
              {/* Suche über Abschnittsnamen UND Katalogtexte. Eine Gliederung beantwortet
                  «wo gehört das hin», nicht «wo war noch mal der Port» – siehe
                  lib/settings-search.ts. Die Trefferliste ersetzt die Navigation, solange
                  etwas eingetippt ist; leeren bringt sie zurück. */}
              <SearchInput
                size="sm"
                containerClassName="mb-3"
                placeholder={t('page.searchPlaceholder')}
                value={search}
                onValueChange={setSearch}
                onKeyDown={(e) => {
                  if (!searchHits || searchHits.length === 0) return;
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setSearchSelected((i) => Math.min(i + 1, searchHits.length - 1));
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setSearchSelected((i) => Math.max(i - 1, 0));
                  } else if (e.key === 'Enter') {
                    e.preventDefault();
                    const hit = searchHits[searchSelected] ?? searchHits[0];
                    if (hit) jumpToHit(hit);
                  }
                }}
              />

              {searchHits !== null ? (
                <nav aria-label={t('page.searchPlaceholder')}>
                  {searchHits.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-muted-foreground">
                      {t('page.searchNoResults')}
                    </p>
                  ) : (
                    <>
                      {searchHits.map((hit, index) => {
                        const section = SECTIONS.find(s => s.id === hit.section);
                        if (!section) return null;
                        const Icon = section.icon;
                        const sectionLabel = t(`page.sections.${section.id}`);
                        // Gruppiert nach Abschnitt: der Kopf steht vor dem ersten
                        // Treffer eines Abschnitts, die weiteren rücken darunter ein.
                        const isFirstOfSection = searchHits[index - 1]?.section !== hit.section;
                        const selected = index === searchSelected;
                        return (
                          <button
                            key={`${hit.section}-${index}`}
                            onClick={() => jumpToHit(hit)}
                            onMouseEnter={() => setSearchSelected(index)}
                            className={`relative w-full rounded-lg px-3 py-1.5 text-left text-sm transition-colors ${
                              selected ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:bg-background/50 hover:text-foreground'
                            }`}
                          >
                            {selected && (
                              <span aria-hidden className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-primary" />
                            )}
                            {isFirstOfSection && (
                              <span className="flex items-center gap-2 pb-0.5 text-[11px] font-medium text-muted-foreground">
                                <Icon className="h-3.5 w-3.5 shrink-0" />
                                {sectionLabel}
                              </span>
                            )}
                            {/* Der Beleg: welcher Text gepasst hat, mit markierter
                                Fundstelle – gekürzt wird um sie herum, nie davor. */}
                            {hit.text === sectionLabel ? (
                              <span className="block pl-5 text-sm text-foreground">{sectionLabel}</span>
                            ) : (
                              <SearchHitEvidence
                                text={hit.text}
                                matchStart={hit.matchStart}
                                matchEnd={hit.matchEnd}
                              />
                            )}
                          </button>
                        );
                      })}
                      <p className="px-3 pt-1.5 text-right text-[11px] text-muted-foreground">
                        {t('page.searchHitCount', { count: searchHits.length })}
                      </p>
                    </>
                  )}
                </nav>
              ) : (
              /* One loop over GROUPS. This used to be three near-identical blocks,
                 which is how the «Daten» group ended up wrapped in `isEditor &&` and
                 hid Fehlerberichte from the very people it is for. A group renders
                 when it has visible sections and not otherwise. */
              <nav className="space-y-1">
                {GROUPS.map((group, groupIndex) => {
                  const groupSections = visibleSections.filter(s => s.group === group);
                  if (groupSections.length === 0) return null;
                  return (
                    <div key={group}>
                      <p className={`px-3 py-2 text-xs font-semibold tracking-wide text-muted-foreground ${groupIndex > 0 ? 'mt-4' : ''}`}>
                        {t(`page.groups.${group}`)}
                      </p>
                      {groupSections.map((section) => {
                        const Icon = section.icon;
                        const isActive = activeSection === section.id;
                        return (
                          <button
                            key={section.id}
                            onClick={() => navigateToSection(section.id)}
                            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                              isActive
                                ? 'bg-background text-foreground shadow-sm'
                                : 'text-muted-foreground hover:text-foreground hover:bg-background/50'
                            }`}
                          >
                            <Icon className="h-4 w-4" />
                            {t(`page.sections.${section.id}`)}
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </nav>
              )}
            </aside>
          )}

          {/* Mobile section selector */}
          {isMobile && (
            <div className="border-b px-4 py-2">
              <Select value={activeSection} onValueChange={(v) => navigateToSection(v as SectionId)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GROUPS.map((group) => {
                    const groupSections = visibleSections.filter(s => s.group === group);
                    if (groupSections.length === 0) return null;
                    const groupLabel = t(`page.groups.${group}`);
                    return (
                      <div key={group}>
                        <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground tracking-wide">
                          {groupLabel}
                        </div>
                        {groupSections.map((section) => (
                          <SelectItem key={section.id} value={section.id}>
                            {t(`page.sections.${section.id}`)}
                          </SelectItem>
                        ))}
                      </div>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Content area – min-h-0 so it scrolls inside the flex column on
              mobile; extra bottom padding so content clears the bottom nav. */}
          <main className="flex-1 min-h-0 overflow-y-auto p-4 pb-24 md:p-6 md:pb-6">
            {/* Form sections keep a reading width; the four resource LISTS get
                the whole screen — a five-column table squeezed to 896px on a
                1920 board while half the page stood empty was the opposite of
                density with order. */}
            <div className={`${['personnel', 'vehicles', 'materials', 'users'].includes(activeSection) ? 'max-w-none' : 'max-w-4xl'} space-y-6`}>
              {renderContent()}
            </div>
          </main>
        </div>

        {/* Mobile Bottom Navigation */}
        <MobileBottomNavigation currentPage="settings" />

        {/* UI #17 – confirm before replace-mode import wipes existing data.
            The dialog reports both halves of the trade: what arrives, and what
            leaves. Quoting only the arrivals is how «2 Personal» came to be the
            last thing an operator read before losing a roster of eighteen.
            `extraAction` is the safer sibling – the same file, appended. */}
        <ConfirmDialog
          open={replaceConfirmOpen}
          onOpenChange={setReplaceConfirmOpen}
          variant="destructive"
          title={t('page.import.replaceConfirmTitle')}
          description={
            <>
              {t('page.import.replaceConfirmDescription')}
              {preview && (
                <>
                  <span className="block mt-2">
                    {t.rich('page.import.replaceConfirmCounts', {
                      personnel: preview.personnel_total,
                      vehicles: preview.vehicles_total,
                      materials: preview.materials_total,
                      strong: (chunks) => <strong>{chunks}</strong>,
                    })}
                  </span>
                  <span className="block mt-2 text-destructive">
                    {t.rich('page.import.replaceConfirmDeletions', {
                      personnel: preview.deletions.personnel,
                      vehicles: preview.deletions.vehicles,
                      materials: preview.deletions.materials,
                      assignments: preview.deletions.incident_assignments,
                      strong: (chunks) => <strong>{chunks}</strong>,
                    })}
                  </span>
                </>
              )}
              <span className="block mt-2 text-destructive">
                {t('common.irreversible')}
              </span>
            </>
          }
          cancelText={t('common.cancel')}
          confirmText={t('page.import.replaceConfirmAction')}
          extraAction={{
            label: t('page.import.switchToAppend'),
            onSelect: () => {
              setReplaceConfirmOpen(false);
              selectImportMode('append');
            },
          }}
          onConfirm={handleImport}
        />
      </div>
    </ProtectedRoute>
  );
}
