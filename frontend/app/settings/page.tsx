'use client';

/**
 * Unified Settings & Administration Page
 * Sidebar navigation with all configuration and resource management
 */

import { useState, useEffect, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/contexts/auth-context';
import { useEvent } from '@/lib/contexts/event-context';
import { apiClient, type ApiExcelImportPreview, type ApiExcelImportResult, type ApiAuditLog } from '@/lib/api-client';
import { ProtectedRoute } from '@/components/protected-route';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  Settings2,
  Bell,
  RefreshCw,
  Users,
  Truck,
  Package,
  FileSpreadsheet,
  FileText,
  Upload,
  Download,
  AlertCircle,
  CheckCircle,
  X,
  Save,
  Filter,
  Calendar,
  User,
  Sun,
  Moon,
  Monitor,
  Printer,
  Shield,
  Info,
  Megaphone,
  Navigation,
  LifeBuoy,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { PageNavigation } from '@/components/page-navigation';
import { MobileBottomNavigation } from '@/components/mobile-bottom-navigation';
import { NotificationSettingsCard } from '@/components/notifications/notification-settings';
import { DiveraAlarmSettingsCard } from '@/components/divera/divera-alarm-settings-card';
import { GpsSettingsCard } from '@/components/settings/gps-settings';
import { SyncStatusCard } from '@/components/sync/sync-status-card';
import { SyncConfigCard } from '@/components/sync/sync-config-card';
import { SyncHistoryCard } from '@/components/sync/sync-history-card';
import { PersonnelSettings } from '@/components/settings/personnel-settings';
import { VehicleSettings } from '@/components/settings/vehicle-settings';
import { MaterialSettings } from '@/components/settings/material-settings';
import { PrinterSettings } from '@/components/settings/printer-settings';
import { FallbackSettings } from '@/components/settings/fallback-settings';
import { UserSettings } from '@/components/settings/user-settings';
import { DemoLock } from '@/components/settings/demo-lock';
import { Skeleton } from '@/components/ui/skeleton';
import { useSyncStatus } from '@/lib/hooks/use-sync-status';
import { useRailwayRecovery } from '@/lib/hooks/use-railway-recovery';
import { useIsMobile } from '@/components/ui/use-mobile';

// Sidebar sections configuration (labels come from settings.page.sections.*)
const SECTIONS = [
  { id: 'general', icon: Settings2, group: 'config', editorOnly: false, adminOnly: false },
  { id: 'notifications', icon: Bell, group: 'config', editorOnly: false, adminOnly: false },
  { id: 'alerting', icon: Megaphone, group: 'config', editorOnly: true, adminOnly: false },
  { id: 'gps', icon: Navigation, group: 'config', editorOnly: true, adminOnly: false },
  // Sync can rewrite whole tables and points at a database URL — admin-only (matches /api/sync/*).
  { id: 'sync', icon: RefreshCw, group: 'config', editorOnly: false, adminOnly: true },
  { id: 'printer', icon: Printer, group: 'config', editorOnly: true, adminOnly: false },
  { id: 'fallback', icon: LifeBuoy, group: 'config', editorOnly: true, adminOnly: false },
  { id: 'users', icon: Shield, group: 'config', editorOnly: false, adminOnly: true },
  { id: 'personnel', icon: Users, group: 'resources', editorOnly: true, adminOnly: false },
  { id: 'vehicles', icon: Truck, group: 'resources', editorOnly: true, adminOnly: false },
  { id: 'materials', icon: Package, group: 'resources', editorOnly: true, adminOnly: false },
  { id: 'import', icon: FileSpreadsheet, group: 'data', editorOnly: true, adminOnly: false },
  { id: 'audit', icon: FileText, group: 'data', editorOnly: true, adminOnly: false },
] as const;

// Audit log constants
const AUDIT_ACTION_TYPES = ['create', 'update', 'delete', 'assign', 'login_success', 'login_failure', 'logout'];
const AUDIT_RESOURCE_TYPES = ['incident', 'personnel', 'vehicle', 'material', 'user', 'api'];

type SectionId = typeof SECTIONS[number]['id'];

interface SettingConfig {
  key: string;
  type: 'number' | 'boolean' | 'text' | 'select';
  unit?: string;
  options?: string[];
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
];

export default function SettingsPage() {
  useGlobalNavigation();
  const t = useTranslations('settings');
  const searchParams = useSearchParams();
  const router = useRouter();
  const { isEditor, isAdmin, isAuthenticated } = useAuth();
  const { events, isLoading: eventsLoading } = useEvent();
  const isMobile = useIsMobile();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Avoid hydration mismatch
  useEffect(() => {
    setMounted(true);
  }, []);

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
  const [historyRefreshTrigger, setHistoryRefreshTrigger] = useState(0);

  // Sync status
  const { status: syncStatus, isLoading: isSyncLoading, error: syncError, isStale } = useSyncStatus();
  useRailwayRecovery(syncStatus);

  // Import/Export state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ApiExcelImportPreview | null>(null);
  const [importMode, setImportMode] = useState<'replace' | 'append'>('replace');
  const [replaceConfirmOpen, setReplaceConfirmOpen] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);

  // Mobile sidebar state
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  // Audit export state
  const [auditExportEventId, setAuditExportEventId] = useState<string>('');
  const [auditExportLoading, setAuditExportLoading] = useState(false);

  // Demo mode detection
  const [demoMode, setDemoMode] = useState(false);
  useEffect(() => {
    apiClient.getDemoStatus().then((status) => setDemoMode(status?.demo === true));
  }, []);

  // Audit log state
  const [auditEntries, setAuditEntries] = useState<ApiAuditLog[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [auditResourceFilter, setAuditResourceFilter] = useState<string>('all');
  const [auditActionFilter, setAuditActionFilter] = useState<string>('all');
  const [auditSearchQuery, setAuditSearchQuery] = useState('');
  const [auditLimit, setAuditLimit] = useState(100);

  const handleSyncComplete = () => {
    setHistoryRefreshTrigger((prev) => prev + 1);
  };

  // Fetch audit logs
  const fetchAuditLogs = async () => {
    setAuditLoading(true);
    setAuditError(null);
    try {
      const params: { limit: number; resource_type?: string; action_type?: string } = { limit: auditLimit };
      if (auditResourceFilter !== 'all') params.resource_type = auditResourceFilter;
      if (auditActionFilter !== 'all') params.action_type = auditActionFilter;
      const data = await apiClient.getAuditLogs(params);
      setAuditEntries(data);
    } catch (err) {
      console.error('Failed to fetch audit logs:', err);
      setAuditError(err instanceof Error ? err.message : t('common.loadError'));
    } finally {
      setAuditLoading(false);
    }
  };

  // Fetch audit logs when on audit section
  useEffect(() => {
    if (activeSection === 'audit' && isEditor) {
      fetchAuditLogs();
    }
  }, [activeSection, isEditor, auditResourceFilter, auditActionFilter, auditLimit]);

  // Navigate to section
  const navigateToSection = (sectionId: SectionId) => {
    router.push(`/settings?section=${sectionId}`, { scroll: false });
    setMobileSidebarOpen(false);
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

  // Import/Export handlers
  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setPreview(null);
      setImportError(null);
      setImportSuccess(null);
    }
  };

  const handlePreview = async () => {
    if (!selectedFile) return;
    setImportLoading(true);
    setImportError(null);
    try {
      const result = await apiClient.previewExcelImport(selectedFile);
      setPreview(result);
      setTimeout(() => {
        previewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : t('page.errors.previewFailed'));
    } finally {
      setImportLoading(false);
    }
  };

  const handleImport = async () => {
    if (!selectedFile) return;
    setImportLoading(true);
    setImportError(null);
    try {
      const result = await apiClient.executeExcelImport(selectedFile, importMode);
      setImportSuccess(
        t('page.import.importSuccess', {
          personnel: result.counts.personnel,
          vehicles: result.counts.vehicles,
          materials: result.counts.materials,
        })
      );
      setSelectedFile(null);
      setPreview(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err) {
      setImportError(err instanceof Error ? err.message : t('page.errors.importFailed'));
    } finally {
      setImportLoading(false);
    }
  };

  const handleExport = async () => {
    setImportLoading(true);
    setImportError(null);
    try {
      const blob = await apiClient.exportAllData();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      a.download = `kprueck_export_${timestamp}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      toast.success(t('page.toasts.exportSuccess'));
    } catch (err) {
      setImportError(err instanceof Error ? err.message : t('page.errors.exportFailed'));
    } finally {
      setImportLoading(false);
    }
  };

  const handleDownloadTemplate = async () => {
    setImportLoading(true);
    try {
      const blob = await apiClient.downloadImportTemplate();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'kprueck_import_template.xlsx';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      toast.error(t('page.toasts.templateDownloadFailed'));
    } finally {
      setImportLoading(false);
    }
  };

  const resetImport = () => {
    setSelectedFile(null);
    setPreview(null);
    setImportError(null);
    setImportSuccess(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleAuditExport = async () => {
    if (!auditExportEventId) {
      toast.error(t('page.toasts.selectEvent'));
      return;
    }
    setAuditExportLoading(true);
    setImportError(null);
    try {
      const blob = await apiClient.exportEventAudit(auditExportEventId);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const selectedEvent = events.find(e => e.id === auditExportEventId);
      const eventName = selectedEvent?.name || 'event';
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      const sanitizedName = eventName.replace(/[^a-zA-Z0-9_-]/g, '_');
      a.download = `audit_${sanitizedName}_${timestamp}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      toast.success(t('page.toasts.auditExportSuccess'));
    } catch (err) {
      setImportError(err instanceof Error ? err.message : t('page.errors.auditExportFailed'));
    } finally {
      setAuditExportLoading(false);
    }
  };

  // Audit log helpers
  const filteredAuditEntries = auditEntries.filter((entry) => {
    if (entry.action_type === 'get_request') return false;
    if (!auditSearchQuery) return true;
    const query = auditSearchQuery.toLowerCase();
    return (
      entry.action_type.toLowerCase().includes(query) ||
      entry.resource_type.toLowerCase().includes(query) ||
      (entry.resource_id && entry.resource_id.toLowerCase().includes(query)) ||
      (entry.user_id && entry.user_id.toLowerCase().includes(query)) ||
      (entry.ip_address && entry.ip_address.toLowerCase().includes(query))
    );
  });

  const formatAuditTimestamp = (timestamp: string) => {
    return new Date(timestamp).toLocaleString('de-CH', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  };

  const getAuditBadgeVariant = (actionType: string) => {
    if (actionType.includes('delete')) return 'destructive' as const;
    if (actionType.includes('create')) return 'default' as const;
    if (actionType.includes('update')) return 'secondary' as const;
    return 'outline' as const;
  };

  const clearAuditFilters = () => {
    setAuditResourceFilter('all');
    setAuditActionFilter('all');
    setAuditSearchQuery('');
  };

  const hasActiveAuditFilters = auditResourceFilter !== 'all' || auditActionFilter !== 'all' || auditSearchQuery !== '';

  // Render setting input
  const renderSettingInput = (config: SettingConfig) => {
    const value = settings[config.key] || '';
    const isCurrentlySaving = saving === config.key;

    // Boolean without options → render as Switch
    if (config.type === 'boolean' && !config.options) {
      return (
        <Switch
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
          <SelectTrigger className="w-full">
            <SelectValue placeholder={t('page.general.selectPlaceholder')} />
          </SelectTrigger>
          <SelectContent>
            {config.options.map((option) => (
              <SelectItem key={option} value={option}>
                {t(`page.general.configs.${config.key}.options.${option}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }

    return (
      <Input
        type={config.type === 'number' ? 'number' : 'text'}
        value={value}
        onChange={(e) => setSettings((prev) => ({ ...prev, [config.key]: e.target.value }))}
        onBlur={(e) => {
          if (e.target.value !== serverSettings[config.key]) {
            updateSetting(config.key, e.target.value);
          }
        }}
        disabled={!isEditor || isCurrentlySaving}
      />
    );
  };

  // Filter sections based on editor role
  const visibleSections = SECTIONS.filter(s =>
    (!s.editorOnly || isEditor) && (!s.adminOnly || isAdmin)
  );

  const DemoHint = ({ text }: { text: string }) => (
    demoMode ? (
      <div className="flex items-center gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
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
            <Card className="p-6 space-y-4">
              {/* Theme Selection */}
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <Label className="font-medium">{t('page.general.appearance')}</Label>
                  <p className="text-xs text-muted-foreground">{t('page.general.appearanceHint')}</p>
                </div>
                {mounted && (
                  <div className="flex gap-1.5 flex-shrink-0">
                    {([
                      { value: 'light', icon: Sun, label: t('page.general.themeLight') },
                      { value: 'dark', icon: Moon, label: t('page.general.themeDark') },
                      { value: 'system', icon: Monitor, label: t('page.general.themeSystem') },
                    ] as const).map(({ value, icon: Icon, label }) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setTheme(value)}
                        className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-all ${
                          theme === value ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
                        }`}
                        title={label}
                      >
                        <Icon className="h-3.5 w-3.5" />
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Other Settings */}
              {loading ? (
                <div className="space-y-4">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : error ? (
                <div>
                  <p className="text-destructive">{error}</p>
                  <Button onClick={fetchSettings} className="mt-4">{t('common.retry')}</Button>
                </div>
              ) : (
                <DemoLock active={demoMode}>
                  <div className="space-y-4">
                    {SETTING_CONFIGS.map((config) => (
                      <div key={config.key} className="flex items-center justify-between gap-4">
                        <div className="min-w-0">
                          <Label htmlFor={config.key} className="font-medium">{t(`page.general.configs.${config.key}.label`)}</Label>
                          <p className="text-xs text-muted-foreground">{t(`page.general.configs.${config.key}.description`)}</p>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <div className={config.type === 'text' ? 'w-48' : config.type === 'select' ? 'w-56' : ''}>
                            {renderSettingInput(config)}
                          </div>
                          {saving === config.key && <Save className="h-4 w-4 text-primary animate-pulse" />}
                        </div>
                      </div>
                    ))}
                  </div>
                </DemoLock>
              )}
            </Card>
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
            <Card className="p-6 space-y-4">
              <div>
                <h3 className="font-medium">{t('page.alerting.whatsappTitle')}</h3>
                <p className="text-xs text-muted-foreground mt-1">
                  {t('page.alerting.whatsappDescription')}
                </p>
              </div>
              {whatsappFields.map((field) => {
                const value = settings[field.key] !== undefined ? settings[field.key] : field.fallback;
                const isCurrentlySaving = saving === field.key;
                return (
                  <div key={field.key} className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <Label className="font-medium">{field.label}</Label>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs text-muted-foreground"
                        disabled={!isEditor || isCurrentlySaving || value === field.fallback}
                        onClick={() => updateSetting(field.key, field.fallback)}
                      >
                        {t('common.reset')}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">{field.hint}</p>
                    <Textarea
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
                  </div>
                );
              })}
            </Card>
            {(() => {
              const key = WHATSAPP_INCIDENT_TEMPLATE_KEY;
              const fallback = DEFAULT_WHATSAPP_INCIDENT_TEMPLATE;
              const value = settings[key] !== undefined ? settings[key] : fallback;
              const isCurrentlySaving = saving === key;
              return (
                <Card className="p-6 space-y-4">
                  <div>
                    <h3 className="font-medium">{t('page.alerting.incidentTemplateTitle')}</h3>
                    <p className="text-xs text-muted-foreground mt-1">
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
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <Label className="font-medium">{t('page.alerting.templateLabel')}</Label>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs text-muted-foreground"
                        disabled={!isEditor || isCurrentlySaving || value === fallback}
                        onClick={() => updateSetting(key, fallback)}
                      >
                        {t('common.reset')}
                      </Button>
                    </div>
                    <Textarea
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
                  </div>
                </Card>
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
          <div className="space-y-4">
            <DemoLock active={demoMode}>
              <PrinterSettings />
            </DemoLock>
          </div>
        );

      case 'fallback':
        return (
          <div className="space-y-4">
            <FallbackSettings demoMode={demoMode} />
          </div>
        );

      case 'users':
        return (
          <div className="space-y-4">
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
        return (
          <div className="space-y-6">
            {/* Notifications */}
            {importError && (
              <Card className="p-4 border-destructive bg-destructive/10">
                <div className="flex items-start gap-3">
                  <AlertCircle className="h-5 w-5 text-destructive mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm text-destructive/90">{importError}</p>
                  </div>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setImportError(null)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </Card>
            )}

            {importSuccess && (
              <Card className="p-4 border-success bg-success/10">
                <div className="flex items-start gap-3">
                  <CheckCircle className="h-5 w-5 text-success mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm text-success">{importSuccess}</p>
                  </div>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setImportSuccess(null)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </Card>
            )}

            {/* Export - Simple one-click action */}
            <Card className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">{t('page.import.exportTitle')}</p>
                  <p className="text-sm text-muted-foreground">{t('page.import.exportDescription')}</p>
                </div>
                <Button onClick={handleExport} disabled={importLoading}>
                  <Download className="h-4 w-4 mr-2" />
                  {t('page.import.exportButton')}
                </Button>
              </div>
            </Card>

            {/* Import - Stepped workflow */}
            <DemoLock active={demoMode}>
            <Card className="p-5">
              <div className="space-y-5">
                <div>
                  <p className="font-medium">{t('page.import.importTitle')}</p>
                  <p className="text-sm text-muted-foreground">{t('page.import.importDescription')}</p>
                </div>

                {/* Step 1: Template */}
                <div className="flex items-center gap-4 p-3 bg-muted/50 rounded-lg">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-sm font-medium">1</div>
                  <div className="flex-1">
                    <p className="text-sm font-medium">{t('page.import.step1Title')}</p>
                    <p className="text-xs text-muted-foreground">{t('page.import.step1Description')}</p>
                  </div>
                  <Button onClick={handleDownloadTemplate} disabled={importLoading} variant="outline" size="sm">
                    <FileSpreadsheet className="h-4 w-4 mr-2" />
                    {t('page.import.templateButton')}
                  </Button>
                </div>

                {/* Step 2: File selection */}
                <div className="flex items-center gap-4 p-3 bg-muted/50 rounded-lg">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-sm font-medium">2</div>
                  <div className="flex-1">
                    <p className="text-sm font-medium">{t('page.import.step2Title')}</p>
                    {selectedFile && (
                      <p className="text-xs text-muted-foreground truncate max-w-[200px]">{selectedFile.name}</p>
                    )}
                  </div>
                  <div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".xlsx,.xls"
                      onChange={handleFileSelect}
                      className="hidden"
                      id="file-upload"
                    />
                    <label
                      htmlFor="file-upload"
                      className="inline-flex items-center gap-2 px-3 py-2 rounded-md border bg-background hover:bg-accent cursor-pointer text-sm"
                    >
                      <Upload className="h-4 w-4" />
                      {selectedFile ? t('page.import.changeFile') : t('page.import.chooseFile')}
                    </label>
                  </div>
                </div>

                {/* Step 3: Mode selection (only if file selected) */}
                {selectedFile && (
                  <div className="p-3 bg-muted/50 rounded-lg space-y-3">
                    <div className="flex items-center gap-4">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-sm font-medium">3</div>
                      <p className="text-sm font-medium">{t('page.import.step3Title')}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-3 ml-12">
                      <button
                        type="button"
                        onClick={() => setImportMode('replace')}
                        className={`rounded-lg border-2 p-3 text-left transition-all ${
                          importMode === 'replace' ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
                        }`}
                      >
                        <p className="font-medium text-sm">{t('page.import.modeReplace')}</p>
                        <p className="text-xs text-muted-foreground">{t('page.import.modeReplaceHint')}</p>
                      </button>
                      <button
                        type="button"
                        onClick={() => setImportMode('append')}
                        className={`rounded-lg border-2 p-3 text-left transition-all ${
                          importMode === 'append' ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
                        }`}
                      >
                        <p className="font-medium text-sm">{t('page.import.modeAppend')}</p>
                        <p className="text-xs text-muted-foreground">{t('page.import.modeAppendHint')}</p>
                      </button>
                    </div>
                  </div>
                )}

                {/* Step 4: Actions (only if file selected) */}
                {selectedFile && (
                  <div className="flex items-center gap-3 pt-2 border-t">
                    <Button onClick={handlePreview} disabled={importLoading || !!preview} variant="outline">
                      {t('page.import.showPreview')}
                    </Button>
                    {preview && (
                      <Button
                        onClick={() => {
                          if (importMode === 'replace') {
                            setReplaceConfirmOpen(true);
                          } else {
                            handleImport();
                          }
                        }}
                        disabled={importLoading}
                      >
                        {t('page.import.importNow')}
                      </Button>
                    )}
                    <Button onClick={resetImport} variant="ghost" size="sm" className="ml-auto">
                      <X className="h-4 w-4 mr-1" />
                      {t('common.reset')}
                    </Button>
                  </div>
                )}
              </div>
            </Card>
            </DemoLock>

            {/* Preview */}
            {preview && (
              <Card ref={previewRef} className="p-5 space-y-4">
                <p className="font-medium">{t('page.import.previewTitle')}</p>

                {preview.personnel_total > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <Users className="h-4 w-4" />
                      <span className="font-medium text-sm">{t('page.sections.personnel')}</span>
                      <Badge variant="secondary">{preview.personnel_total}</Badge>
                    </div>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t('common.name')}</TableHead>
                          <TableHead>{t('common.role')}</TableHead>
                          <TableHead>{t('common.status')}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {preview.personnel_preview.map((row, idx) => (
                          <TableRow key={idx}>
                            <TableCell>{row.name}</TableCell>
                            <TableCell>{row.role || '-'}</TableCell>
                            <TableCell>{row.availability}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}

                {preview.vehicles_total > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <Truck className="h-4 w-4" />
                      <span className="font-medium text-sm">{t('page.sections.vehicles')}</span>
                      <Badge variant="secondary">{preview.vehicles_total}</Badge>
                    </div>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t('common.name')}</TableHead>
                          <TableHead>{t('common.type')}</TableHead>
                          <TableHead>{t('common.radioCallSign')}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {preview.vehicles_preview.map((row, idx) => (
                          <TableRow key={idx}>
                            <TableCell>{row.name}</TableCell>
                            <TableCell>{row.type}</TableCell>
                            <TableCell>{row.radio_call_sign || '-'}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}

                {preview.materials_total > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <Package className="h-4 w-4" />
                      <span className="font-medium text-sm">{t('page.sections.materials')}</span>
                      <Badge variant="secondary">{preview.materials_total}</Badge>
                    </div>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t('common.name')}</TableHead>
                          <TableHead>{t('common.type')}</TableHead>
                          <TableHead>{t('common.location')}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {preview.materials_preview.map((row, idx) => (
                          <TableRow key={idx}>
                            <TableCell>{row.name}</TableCell>
                            <TableCell>{row.type}</TableCell>
                            <TableCell>{row.location || '-'}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </Card>
            )}
          </div>
        );

      case 'audit':
        return (
          <div className="space-y-4">
            {/* Audit Export */}
            <Card className="p-5">
              <div className="space-y-4">
                <div>
                  <p className="font-medium">{t('page.audit.exportTitle')}</p>
                  <p className="text-sm text-muted-foreground">
                    {t('page.audit.exportDescription')}
                  </p>
                </div>

                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
                  <div className="flex-1 w-full sm:w-auto">
                    <Select
                      value={auditExportEventId}
                      onValueChange={setAuditExportEventId}
                      disabled={eventsLoading || auditExportLoading}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={t('page.audit.selectEventPlaceholder')} />
                      </SelectTrigger>
                      <SelectContent>
                        {events
                          .filter(e => !e.archived_at)
                          .map((event) => (
                            <SelectItem key={event.id} value={event.id}>
                              {event.name}
                              {event.training_flag && (
                                <span className="ml-2 text-xs text-muted-foreground">{t('page.audit.trainingTag')}</span>
                              )}
                            </SelectItem>
                          ))}
                        {events.filter(e => e.archived_at).length > 0 && (
                          <>
                            <SelectItem value="_divider" disabled>
                              {t('page.audit.archivedDivider')}
                            </SelectItem>
                            {events
                              .filter(e => e.archived_at)
                              .map((event) => (
                                <SelectItem key={event.id} value={event.id}>
                                  {event.name}
                                  {event.training_flag && (
                                    <span className="ml-2 text-xs text-muted-foreground">{t('page.audit.trainingTag')}</span>
                                  )}
                                </SelectItem>
                              ))}
                          </>
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    onClick={handleAuditExport}
                    disabled={!auditExportEventId || auditExportLoading || eventsLoading}
                    className="w-full sm:w-auto"
                  >
                    <Download className="h-4 w-4 mr-2" />
                    {auditExportLoading ? t('page.audit.exporting') : t('page.audit.exportButton')}
                  </Button>
                </div>
              </div>
            </Card>

            {/* Search - Full width */}
            <Input
              placeholder={t('page.audit.searchPlaceholder')}
              value={auditSearchQuery}
              onChange={(e) => setAuditSearchQuery(e.target.value)}
              className="w-full"
            />

            {/* Filters - Compact row */}
            <div className="flex flex-wrap items-center gap-2">
              <Select value={auditResourceFilter} onValueChange={setAuditResourceFilter}>
                <SelectTrigger className="w-36 h-9">
                  <SelectValue placeholder={t('page.audit.resource')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('page.audit.allResources')}</SelectItem>
                  {AUDIT_RESOURCE_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>{type}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={auditActionFilter} onValueChange={setAuditActionFilter}>
                <SelectTrigger className="w-36 h-9">
                  <SelectValue placeholder={t('page.audit.action')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('page.audit.allActions')}</SelectItem>
                  {AUDIT_ACTION_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>{type}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {hasActiveAuditFilters && (
                <Button variant="ghost" size="sm" onClick={clearAuditFilters} className="h-9">
                  <X className="h-4 w-4 mr-1" />
                  {t('page.audit.clearFilters')}
                </Button>
              )}
              <span className="text-sm text-muted-foreground ml-auto">
                {t('common.entriesCount', { count: filteredAuditEntries.length })}
              </span>
            </div>

            {/* Content */}
            {auditLoading ? (
              <Card className="p-6">
                <div className="space-y-3">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="flex gap-3">
                      <Skeleton className="h-4 w-32" />
                      <Skeleton className="h-4 w-16" />
                      <Skeleton className="h-4 w-20" />
                    </div>
                  ))}
                </div>
              </Card>
            ) : auditError ? (
              <Card className="p-6">
                <p className="text-destructive">{auditError}</p>
                <Button onClick={fetchAuditLogs} className="mt-4">{t('common.retry')}</Button>
              </Card>
            ) : filteredAuditEntries.length === 0 ? (
              <Card className="p-8 text-center text-muted-foreground">
                {hasActiveAuditFilters ? t('page.audit.noEntriesFiltered') : t('page.audit.noEntries')}
              </Card>
            ) : (
              <>
                {/* Desktop Table - Hidden on mobile */}
                <Card className="hidden md:block overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-40">{t('page.audit.timeHead')}</TableHead>
                        <TableHead>{t('page.audit.action')}</TableHead>
                        <TableHead>{t('page.audit.resource')}</TableHead>
                        <TableHead className="hidden lg:table-cell">{t('page.audit.userHead')}</TableHead>
                        <TableHead>{t('page.audit.detailsHead')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredAuditEntries.map((entry) => (
                        <TableRow key={entry.id}>
                          <TableCell className="font-mono text-xs">
                            {formatAuditTimestamp(entry.timestamp)}
                          </TableCell>
                          <TableCell>
                            <Badge variant={getAuditBadgeVariant(entry.action_type)}>
                              {entry.action_type}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{entry.resource_type}</Badge>
                          </TableCell>
                          <TableCell className="hidden lg:table-cell font-mono text-xs text-muted-foreground">
                            {entry.user_id ? `${entry.user_id.substring(0, 8)}...` : <em>{t('page.audit.system')}</em>}
                          </TableCell>
                          <TableCell>
                            {entry.changes_json ? (
                              <details className="cursor-pointer">
                                <summary className="text-xs text-primary hover:text-primary/80">{t('page.audit.show')}</summary>
                                <pre className="mt-2 text-xs bg-muted p-2 rounded overflow-auto max-h-32">
                                  {JSON.stringify(entry.changes_json, null, 2)}
                                </pre>
                              </details>
                            ) : (
                              <span className="text-xs text-muted-foreground">-</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Card>

                {/* Mobile Cards - Shown only on mobile */}
                <div className="md:hidden space-y-3">
                  {filteredAuditEntries.map((entry) => (
                    <Card key={entry.id} className="p-4">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <Badge variant={getAuditBadgeVariant(entry.action_type)}>
                          {entry.action_type}
                        </Badge>
                        <Badge variant="outline">{entry.resource_type}</Badge>
                      </div>
                      <p className="font-mono text-xs text-muted-foreground mb-2">
                        {formatAuditTimestamp(entry.timestamp)}
                      </p>
                      {entry.user_id && (
                        <p className="text-xs text-muted-foreground">
                          <User className="h-3 w-3 inline mr-1" />
                          {entry.user_id.substring(0, 8)}...
                        </p>
                      )}
                      {entry.changes_json && (
                        <details className="mt-2 cursor-pointer">
                          <summary className="text-xs text-primary">{t('page.audit.showDetails')}</summary>
                          <pre className="mt-2 text-xs bg-muted p-2 rounded overflow-auto max-h-32">
                            {JSON.stringify(entry.changes_json, null, 2)}
                          </pre>
                        </details>
                      )}
                    </Card>
                  ))}
                </div>
              </>
            )}
          </div>
        );

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

        {/* Main content with sidebar — stack on mobile (selector above content),
            side-by-side sidebar on desktop. */}
        <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
          {/* Sidebar - Desktop */}
          {!isMobile && (
            <aside className="w-56 border-r bg-muted/30 p-4 overflow-y-auto">
              <nav className="space-y-1">
                {/* Config group */}
                <p className="text-xs font-semibold text-muted-foreground tracking-wide px-3 py-2">
                  {t('page.groups.config')}
                </p>
                {visibleSections.filter(s => s.group === 'config').map((section) => {
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

                {/* Resources group */}
                {isEditor && (
                  <>
                    <p className="text-xs font-semibold text-muted-foreground tracking-wide px-3 py-2 mt-4">
                      {t('page.groups.resources')}
                    </p>
                    {visibleSections.filter(s => s.group === 'resources').map((section) => {
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
                  </>
                )}

                {/* Data group */}
                {isEditor && (
                  <>
                    <p className="text-xs font-semibold text-muted-foreground tracking-wide px-3 py-2 mt-4">
                      {t('page.groups.data')}
                    </p>
                    {visibleSections.filter(s => s.group === 'data').map((section) => {
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
                  </>
                )}

              </nav>
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
                  {(['config', 'resources', 'data'] as const).map((group) => {
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

          {/* Content area — min-h-0 so it scrolls inside the flex column on
              mobile; extra bottom padding so content clears the bottom nav. */}
          <main className="flex-1 min-h-0 overflow-y-auto p-4 pb-24 md:p-6 md:pb-6">
            <div className="max-w-4xl">
              {renderContent()}
            </div>
          </main>
        </div>

        {/* Mobile Bottom Navigation */}
        <MobileBottomNavigation currentPage="settings" />

        {/* UI #17 — confirm before replace-mode import wipes existing data. */}
        <AlertDialog open={replaceConfirmOpen} onOpenChange={setReplaceConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('page.import.replaceConfirmTitle')}</AlertDialogTitle>
              <AlertDialogDescription>
                {t('page.import.replaceConfirmDescription')}
                {preview && (
                  <span className="block mt-2">
                    {t.rich('page.import.replaceConfirmCounts', {
                      personnel: preview.personnel_total,
                      vehicles: preview.vehicles_total,
                      materials: preview.materials_total,
                      strong: (chunks) => <strong>{chunks}</strong>,
                    })}
                  </span>
                )}
                <span className="block mt-2 text-destructive">
                  {t('common.irreversible')}
                </span>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
              <AlertDialogAction
                onClick={(event) => {
                  event.preventDefault();
                  setReplaceConfirmOpen(false);
                  handleImport();
                }}
                className={cn(buttonVariants({ variant: 'destructive' }))}
              >
                {t('page.import.replaceConfirmAction')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </ProtectedRoute>
  );
}
