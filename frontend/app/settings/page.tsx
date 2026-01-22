'use client';

/**
 * Unified Settings & Administration Page
 * Sidebar navigation with all configuration and resource management
 */

import { useState, useEffect, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/contexts/auth-context';
import { apiClient, type ApiExcelImportPreview, type ApiExcelImportResult, type ApiAuditLog } from '@/lib/api-client';
import { ProtectedRoute } from '@/components/protected-route';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
} from 'lucide-react';
import { toast } from 'sonner';
import { PageNavigation } from '@/components/page-navigation';
import { MobileBottomNavigation } from '@/components/mobile-bottom-navigation';
import { NotificationSettingsCard } from '@/components/notifications/notification-settings';
import { SyncStatusCard } from '@/components/sync/sync-status-card';
import { SyncConfigCard } from '@/components/sync/sync-config-card';
import { SyncHistoryCard } from '@/components/sync/sync-history-card';
import { PersonnelSettings } from '@/components/settings/personnel-settings';
import { VehicleSettings } from '@/components/settings/vehicle-settings';
import { MaterialSettings } from '@/components/settings/material-settings';
import { useSyncStatus } from '@/lib/hooks/use-sync-status';
import { useRailwayRecovery } from '@/lib/hooks/use-railway-recovery';
import { useIsMobile } from '@/components/ui/use-mobile';

// Sidebar sections configuration
const SECTIONS = [
  { id: 'general', label: 'Allgemein', icon: Settings2, group: 'config', editorOnly: false },
  { id: 'notifications', label: 'Benachrichtigungen', icon: Bell, group: 'config', editorOnly: false },
  { id: 'sync', label: 'Synchronisation', icon: RefreshCw, group: 'config', editorOnly: false },
  { id: 'personnel', label: 'Personal', icon: Users, group: 'resources', editorOnly: true },
  { id: 'vehicles', label: 'Fahrzeuge', icon: Truck, group: 'resources', editorOnly: true },
  { id: 'materials', label: 'Material', icon: Package, group: 'resources', editorOnly: true },
  { id: 'import', label: 'Import/Export', icon: FileSpreadsheet, group: 'data', editorOnly: true },
  { id: 'audit', label: 'Audit-Protokoll', icon: FileText, group: 'data', editorOnly: true },
] as const;

// Audit log constants
const AUDIT_ACTION_TYPES = ['create', 'update', 'delete', 'assign', 'login_success', 'login_failure', 'logout'];
const AUDIT_RESOURCE_TYPES = ['incident', 'personnel', 'vehicle', 'material', 'user', 'api'];

type SectionId = typeof SECTIONS[number]['id'];

interface SettingConfig {
  key: string;
  label: string;
  description: string;
  type: 'number' | 'boolean' | 'text' | 'select';
  unit?: string;
  options?: { value: string; label: string }[];
}

const SETTING_CONFIGS: SettingConfig[] = [
  {
    key: 'home_city',
    label: 'Heimatort',
    description: 'Haupteinsatzgebiet für vereinfachte Adressanzeige',
    type: 'text',
  },
  {
    key: 'map_mode',
    label: 'Karten-Modus',
    description: 'Auto (Online mit Offline-Fallback), Online oder Offline',
    type: 'select',
    options: [
      { value: 'auto', label: 'Auto (empfohlen)' },
      { value: 'online', label: 'Nur Online' },
      { value: 'offline', label: 'Nur Offline' },
    ],
  },
];

export default function SettingsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { isEditor } = useAuth();
  const isMobile = useIsMobile();

  // Active section from URL or default
  const sectionParam = searchParams.get('section') as SectionId | null;
  const activeSection = sectionParam && SECTIONS.some(s => s.id === sectionParam)
    ? sectionParam
    : 'general';

  // General settings state
  const [settings, setSettings] = useState<Record<string, string>>({});
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
  const [importLoading, setImportLoading] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);

  // Mobile sidebar state
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

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
      setAuditError(err instanceof Error ? err.message : 'Fehler beim Laden');
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
    } catch (err) {
      console.error('Failed to fetch settings:', err);
      setError(err instanceof Error ? err.message : 'Fehler beim Laden');
      toast.error('Fehler beim Laden der Einstellungen');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  const updateSetting = async (key: string, value: string) => {
    if (!isEditor) {
      toast.error('Nur Bearbeiter können Einstellungen ändern');
      return;
    }
    setSaving(key);
    try {
      await apiClient.updateSetting(key, value);
      setSettings((prev) => ({ ...prev, [key]: value }));
      toast.success('Einstellung gespeichert');
    } catch (err) {
      console.error(`Failed to update setting ${key}:`, err);
      toast.error('Fehler beim Speichern');
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
      setImportError(err instanceof Error ? err.message : 'Vorschau fehlgeschlagen');
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
        `Import erfolgreich! ${result.counts.personnel} Personal, ${result.counts.vehicles} Fahrzeuge, ${result.counts.materials} Material importiert.`
      );
      setSelectedFile(null);
      setPreview(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Import fehlgeschlagen');
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
      toast.success('Export erfolgreich');
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Export fehlgeschlagen');
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
      toast.error('Template-Download fehlgeschlagen');
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
    return new Date(timestamp).toLocaleString('de-DE', {
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

    if ((config.type === 'boolean' || config.type === 'select') && config.options) {
      return (
        <Select
          value={value}
          onValueChange={(newValue) => updateSetting(config.key, newValue)}
          disabled={!isEditor || isCurrentlySaving}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Wählen..." />
          </SelectTrigger>
          <SelectContent>
            {config.options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
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
          if (e.target.value !== settings[config.key]) {
            updateSetting(config.key, e.target.value);
          }
        }}
        disabled={!isEditor || isCurrentlySaving}
      />
    );
  };

  // Filter sections based on editor role
  const visibleSections = SECTIONS.filter(s => !s.editorOnly || isEditor);

  // Render content based on active section
  const renderContent = () => {
    switch (activeSection) {
      case 'general':
        return (
          <div className="space-y-6">
            {loading ? (
              <Card className="p-6">
                <div className="space-y-4">
                  <div className="h-4 w-24 bg-muted animate-pulse rounded" />
                  <div className="h-10 w-full bg-muted animate-pulse rounded" />
                  <div className="h-4 w-32 bg-muted animate-pulse rounded" />
                  <div className="h-10 w-full bg-muted animate-pulse rounded" />
                </div>
              </Card>
            ) : error ? (
              <Card className="p-6">
                <p className="text-destructive">{error}</p>
                <Button onClick={fetchSettings} className="mt-4">Erneut versuchen</Button>
              </Card>
            ) : (
              <Card className="p-6 space-y-6">
                {SETTING_CONFIGS.map((config) => (
                  <div key={config.key} className="space-y-2">
                    <Label htmlFor={config.key} className="font-medium">{config.label}</Label>
                    <p className="text-sm text-muted-foreground">{config.description}</p>
                    <div className="flex items-center gap-2">
                      {renderSettingInput(config)}
                      {saving === config.key && <Save className="h-4 w-4 text-blue-600 animate-pulse" />}
                    </div>
                  </div>
                ))}
              </Card>
            )}
            {!isEditor && (
              <p className="text-sm text-muted-foreground">
                Nur Bearbeiter können Einstellungen ändern.
              </p>
            )}
          </div>
        );

      case 'notifications':
        return <NotificationSettingsCard />;

      case 'sync':
        return (
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

      case 'personnel':
        return <PersonnelSettings />;

      case 'vehicles':
        return <VehicleSettings />;

      case 'materials':
        return <MaterialSettings />;

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
              <Card className="p-4 border-green-600 bg-green-600/10">
                <div className="flex items-start gap-3">
                  <CheckCircle className="h-5 w-5 text-green-600 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm text-green-600/90">{importSuccess}</p>
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
                  <p className="font-medium">Export</p>
                  <p className="text-sm text-muted-foreground">Alle Ressourcen als Excel herunterladen</p>
                </div>
                <Button onClick={handleExport} disabled={importLoading}>
                  <Download className="h-4 w-4 mr-2" />
                  Exportieren
                </Button>
              </div>
            </Card>

            {/* Import - Stepped workflow */}
            <Card className="p-5">
              <div className="space-y-5">
                <div>
                  <p className="font-medium">Import</p>
                  <p className="text-sm text-muted-foreground">Ressourcen aus Excel-Datei importieren</p>
                </div>

                {/* Step 1: Template */}
                <div className="flex items-center gap-4 p-3 bg-muted/50 rounded-lg">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-sm font-medium">1</div>
                  <div className="flex-1">
                    <p className="text-sm font-medium">Vorlage herunterladen</p>
                    <p className="text-xs text-muted-foreground">Excel-Vorlage mit korrektem Format</p>
                  </div>
                  <Button onClick={handleDownloadTemplate} disabled={importLoading} variant="outline" size="sm">
                    <FileSpreadsheet className="h-4 w-4 mr-2" />
                    Vorlage
                  </Button>
                </div>

                {/* Step 2: File selection */}
                <div className="flex items-center gap-4 p-3 bg-muted/50 rounded-lg">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-sm font-medium">2</div>
                  <div className="flex-1">
                    <p className="text-sm font-medium">Datei auswählen</p>
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
                      {selectedFile ? 'Ändern' : 'Auswählen'}
                    </label>
                  </div>
                </div>

                {/* Step 3: Mode selection (only if file selected) */}
                {selectedFile && (
                  <div className="p-3 bg-muted/50 rounded-lg space-y-3">
                    <div className="flex items-center gap-4">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-sm font-medium">3</div>
                      <p className="text-sm font-medium">Import-Modus wählen</p>
                    </div>
                    <div className="grid grid-cols-2 gap-3 ml-12">
                      <button
                        type="button"
                        onClick={() => setImportMode('replace')}
                        className={`rounded-lg border-2 p-3 text-left transition-all ${
                          importMode === 'replace' ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
                        }`}
                      >
                        <p className="font-medium text-sm">Ersetzen</p>
                        <p className="text-xs text-muted-foreground">Bestehende Daten löschen</p>
                      </button>
                      <button
                        type="button"
                        onClick={() => setImportMode('append')}
                        className={`rounded-lg border-2 p-3 text-left transition-all ${
                          importMode === 'append' ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
                        }`}
                      >
                        <p className="font-medium text-sm">Anhängen</p>
                        <p className="text-xs text-muted-foreground">Zu bestehenden hinzufügen</p>
                      </button>
                    </div>
                  </div>
                )}

                {/* Step 4: Actions (only if file selected) */}
                {selectedFile && (
                  <div className="flex items-center gap-3 pt-2 border-t">
                    <Button onClick={handlePreview} disabled={importLoading || !!preview} variant="outline">
                      Vorschau anzeigen
                    </Button>
                    {preview && (
                      <Button onClick={handleImport} disabled={importLoading}>
                        Jetzt importieren
                      </Button>
                    )}
                    <Button onClick={resetImport} variant="ghost" size="sm" className="ml-auto">
                      <X className="h-4 w-4 mr-1" />
                      Zurücksetzen
                    </Button>
                  </div>
                )}
              </div>
            </Card>

            {/* Preview */}
            {preview && (
              <Card ref={previewRef} className="p-5 space-y-4">
                <p className="font-medium">Vorschau (erste 10 Zeilen)</p>

                {preview.personnel_total > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <Users className="h-4 w-4" />
                      <span className="font-medium text-sm">Personal</span>
                      <Badge variant="secondary">{preview.personnel_total}</Badge>
                    </div>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Name</TableHead>
                          <TableHead>Rolle</TableHead>
                          <TableHead>Status</TableHead>
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
                      <span className="font-medium text-sm">Fahrzeuge</span>
                      <Badge variant="secondary">{preview.vehicles_total}</Badge>
                    </div>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Name</TableHead>
                          <TableHead>Typ</TableHead>
                          <TableHead>Funkrufname</TableHead>
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
                      <span className="font-medium text-sm">Material</span>
                      <Badge variant="secondary">{preview.materials_total}</Badge>
                    </div>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Name</TableHead>
                          <TableHead>Typ</TableHead>
                          <TableHead>Standort</TableHead>
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
            {/* Search - Full width */}
            <Input
              placeholder="Suche nach Aktion, Ressource, ID, Benutzer oder IP..."
              value={auditSearchQuery}
              onChange={(e) => setAuditSearchQuery(e.target.value)}
              className="w-full"
            />

            {/* Filters - Compact row */}
            <div className="flex flex-wrap items-center gap-2">
              <Select value={auditResourceFilter} onValueChange={setAuditResourceFilter}>
                <SelectTrigger className="w-36 h-9">
                  <SelectValue placeholder="Ressource" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Alle Ressourcen</SelectItem>
                  {AUDIT_RESOURCE_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>{type}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={auditActionFilter} onValueChange={setAuditActionFilter}>
                <SelectTrigger className="w-36 h-9">
                  <SelectValue placeholder="Aktion" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Alle Aktionen</SelectItem>
                  {AUDIT_ACTION_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>{type}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {hasActiveAuditFilters && (
                <Button variant="ghost" size="sm" onClick={clearAuditFilters} className="h-9">
                  <X className="h-4 w-4 mr-1" />
                  Filter zurücksetzen
                </Button>
              )}
              <span className="text-sm text-muted-foreground ml-auto">
                {filteredAuditEntries.length} Einträge
              </span>
            </div>

            {/* Content */}
            {auditLoading ? (
              <Card className="p-6">
                <div className="space-y-3">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="flex gap-3">
                      <div className="h-4 w-32 bg-muted animate-pulse rounded" />
                      <div className="h-4 w-16 bg-muted animate-pulse rounded" />
                      <div className="h-4 w-20 bg-muted animate-pulse rounded" />
                    </div>
                  ))}
                </div>
              </Card>
            ) : auditError ? (
              <Card className="p-6">
                <p className="text-destructive">{auditError}</p>
                <Button onClick={fetchAuditLogs} className="mt-4">Erneut versuchen</Button>
              </Card>
            ) : filteredAuditEntries.length === 0 ? (
              <Card className="p-8 text-center text-muted-foreground">
                {hasActiveAuditFilters ? 'Keine Einträge gefunden.' : 'Noch keine Audit-Protokolle vorhanden.'}
              </Card>
            ) : (
              <>
                {/* Desktop Table - Hidden on mobile */}
                <Card className="hidden md:block overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-40">Zeit</TableHead>
                        <TableHead>Aktion</TableHead>
                        <TableHead>Ressource</TableHead>
                        <TableHead className="hidden lg:table-cell">Benutzer</TableHead>
                        <TableHead>Details</TableHead>
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
                            {entry.user_id ? `${entry.user_id.substring(0, 8)}...` : <em>System</em>}
                          </TableCell>
                          <TableCell>
                            {entry.changes_json ? (
                              <details className="cursor-pointer">
                                <summary className="text-xs text-blue-600 hover:text-blue-800">Anzeigen</summary>
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
                          <summary className="text-xs text-blue-600">Details anzeigen</summary>
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
      <div className="flex h-screen flex-col bg-background">
        {/* Header */}
        <header className="flex items-center justify-between border-b px-4 md:px-6 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-600">
              <Settings2 className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-semibold">Einstellungen</h1>
              <p className="text-sm text-muted-foreground hidden sm:block">
                Konfiguration & Verwaltung
              </p>
            </div>
          </div>
          {!isMobile && <PageNavigation currentPage="settings" />}
        </header>

        {/* Main content with sidebar */}
        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar - Desktop */}
          {!isMobile && (
            <aside className="w-56 border-r bg-muted/30 p-4 overflow-y-auto">
              <nav className="space-y-1">
                {/* Config group */}
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-3 py-2">
                  Konfiguration
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
                      {section.label}
                    </button>
                  );
                })}

                {/* Resources group */}
                {isEditor && (
                  <>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-3 py-2 mt-4">
                      Ressourcen
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
                          {section.label}
                        </button>
                      );
                    })}
                  </>
                )}

                {/* Data group */}
                {isEditor && (
                  <>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-3 py-2 mt-4">
                      Daten
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
                          {section.label}
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
                  {visibleSections.map((section) => (
                    <SelectItem key={section.id} value={section.id}>
                      {section.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Content area */}
          <main className="flex-1 overflow-y-auto p-4 md:p-6">
            <div className="max-w-4xl">
              {renderContent()}
            </div>
          </main>
        </div>

        {/* Mobile Bottom Navigation */}
        <MobileBottomNavigation currentPage="settings" />
      </div>
    </ProtectedRoute>
  );
}
