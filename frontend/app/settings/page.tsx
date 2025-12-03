'use client';

/**
 * Settings Management Page
 * Allows editors to configure system-wide settings
 * Read-only view for viewers
 */

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/contexts/auth-context';
import { apiClient } from '@/lib/api-client';
import { ProtectedRoute } from '@/components/protected-route';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Settings2, Save, AlertCircle, Bell, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import { PageNavigation } from '@/components/page-navigation';
import { MobileBottomNavigation } from "@/components/mobile-bottom-navigation"
import { NotificationSettingsCard } from '@/components/notifications/notification-settings';
import { SyncStatusCard } from '@/components/sync/sync-status-card';
import { SyncConfigCard } from '@/components/sync/sync-config-card';
import { SyncHistoryCard } from '@/components/sync/sync-history-card';
import { useSyncStatus } from '@/lib/hooks/use-sync-status';
import { useRailwayRecovery } from '@/lib/hooks/use-railway-recovery';
import { useIsMobile } from '@/components/ui/use-mobile';

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
    description: 'Haupteinsatzgebiet für vereinfachte Adressanzeige (z.B. "Oberwil" oder "Oberwil, Basel-Landschaft")',
    type: 'text',
  },
  {
    key: 'map_mode',
    label: 'Karten-Modus',
    description: 'Kartenquelle: Auto (Online → Offline-Fallback), Online (nur OSM), Offline (nur lokale Tiles)',
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
  const { isEditor } = useAuth();
  const isMobile = useIsMobile();
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [historyRefreshTrigger, setHistoryRefreshTrigger] = useState(0);

  // Get tab from URL parameter, default to 'general'
  const defaultTab = searchParams.get('tab') || 'general';

  // Sync status and hooks
  const { status: syncStatus, isLoading: isSyncLoading, error: syncError, isStale } = useSyncStatus();
  useRailwayRecovery(syncStatus);

  // Callback to refresh sync history after manual sync
  const handleSyncComplete = () => {
    setHistoryRefreshTrigger((prev) => prev + 1);
  };

  // Fetch all settings on mount
  const fetchSettings = async () => {
    setLoading(true);
    setError(null);

    try {
      const data = await apiClient.getAllSettings();
      setSettings(data);
    } catch (err) {
      console.error('Failed to fetch settings:', err);
      const errorMessage = err instanceof Error ? err.message : 'Fehler beim Laden der Einstellungen';
      setError(errorMessage);
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
      toast.error('Fehler beim Speichern der Einstellung');
    } finally {
      setSaving(null);
    }
  };

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

    if (config.type === 'number') {
      return (
        <div className="flex gap-2">
          <Input
            type="number"
            value={value}
            onChange={(e) => {
              // Update local state immediately for better UX
              setSettings((prev) => ({ ...prev, [config.key]: e.target.value }));
            }}
            onBlur={(e) => {
              // Save on blur
              if (e.target.value !== settings[config.key]) {
                updateSetting(config.key, e.target.value);
              }
            }}
            disabled={!isEditor || isCurrentlySaving}
            className="flex-1"
          />
          {config.unit && (
            <div className="flex items-center px-3 text-sm text-muted-foreground">
              {config.unit}
            </div>
          )}
        </div>
      );
    }

    // Default: text input
    return (
      <Input
        type="text"
        value={value}
        onChange={(e) => {
          setSettings((prev) => ({ ...prev, [config.key]: e.target.value }));
        }}
        onBlur={(e) => {
          if (e.target.value !== settings[config.key]) {
            updateSetting(config.key, e.target.value);
          }
        }}
        disabled={!isEditor || isCurrentlySaving}
      />
    );
  };

  return (
    <ProtectedRoute>
      <div className="flex h-screen flex-col bg-background text-foreground">
        {/* Header */}
        <header className="flex items-center justify-between border-b border-border/50 bg-card/50 backdrop-blur-sm px-4 md:px-6 py-4 min-h-20">
          <div className="flex items-center gap-2 md:gap-4 min-w-0 flex-1">
            <div className="flex items-center gap-2 md:gap-3 min-w-0">
              <div className="flex h-9 w-9 md:h-11 md:w-11 items-center justify-center rounded-xl bg-gradient-to-br from-purple-600 to-pink-600 text-2xl shadow-lg flex-shrink-0">
                <Settings2 className="h-5 w-5 md:h-6 md:w-6 text-white" />
              </div>
              <div className="min-w-0">
                <h1 className="text-lg md:text-2xl font-bold tracking-tight truncate">Systemeinstellungen</h1>
                <p className="text-xs md:text-sm text-muted-foreground hidden sm:block">
                  {isEditor
                    ? 'Systemweite Konfiguration bearbeiten'
                    : 'Systemweite Konfiguration (nur Lesezugriff)'}
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 md:gap-4 flex-shrink-0">
            {/* Desktop Navigation */}
            {!isMobile && (
              <PageNavigation currentPage="settings" />
            )}

          </div>
        </header>

        {/* Info Banner for Viewers */}
        {!isEditor && (
          <div className="border-b border-border/50 bg-blue-50 dark:bg-blue-950/20 px-6 py-3">
            <div className="flex items-center gap-2 text-sm text-blue-800 dark:text-blue-300">
              <AlertCircle className="h-4 w-4" />
              <span>
                Sie haben nur Lesezugriff. Nur Bearbeiter können Einstellungen ändern.
              </span>
            </div>
          </div>
        )}

        {/* Content */}
        <main className="flex-1 overflow-auto p-4 md:p-6">
          <div className="max-w-5xl mx-auto">
            <Tabs defaultValue={defaultTab} className="w-full">
              <TabsList className="grid w-full grid-cols-3 mb-4 md:mb-6 h-auto">
                <TabsTrigger value="general" className="flex items-center gap-1 md:gap-2 text-xs md:text-sm px-2 md:px-3">
                  <Settings2 className="h-3.5 w-3.5 md:h-4 md:w-4 flex-shrink-0" />
                  <span className="hidden sm:inline">Allgemein</span>
                  <span className="sm:hidden truncate">All.</span>
                </TabsTrigger>
                <TabsTrigger value="notifications" className="flex items-center gap-1 md:gap-2 text-xs md:text-sm px-2 md:px-3">
                  <Bell className="h-3.5 w-3.5 md:h-4 md:w-4 flex-shrink-0" />
                  <span className="hidden sm:inline">Benachrichtigungen</span>
                  <span className="sm:hidden truncate">Ben.</span>
                </TabsTrigger>
                <TabsTrigger value="sync" className="flex items-center gap-1 md:gap-2 text-xs md:text-sm px-2 md:px-3">
                  <RefreshCw className="h-3.5 w-3.5 md:h-4 md:w-4 flex-shrink-0" />
                  <span className="hidden sm:inline">Synchronisation</span>
                  <span className="sm:hidden truncate">Sync</span>
                </TabsTrigger>
              </TabsList>

              {/* General Settings Tab */}
              <TabsContent value="general">
                {loading ? (
                  <div className="flex h-full items-center justify-center py-12">
                    <div className="text-muted-foreground">Lade Einstellungen...</div>
                  </div>
                ) : error ? (
                  <Card className="p-8">
                    <div className="text-center">
                      <p className="text-destructive font-medium">{error}</p>
                      <Button onClick={fetchSettings} className="mt-4">
                        Erneut versuchen
                      </Button>
                    </div>
                  </Card>
                ) : (
                  <>
                    <Card className="p-6">
                      <div className="space-y-6">
                        {SETTING_CONFIGS.map((config) => (
                          <div key={config.key} className="space-y-2">
                            <div>
                              <Label htmlFor={config.key} className="text-base font-semibold">
                                {config.label}
                              </Label>
                              <p className="text-sm text-muted-foreground mt-1">
                                {config.description}
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              {renderSettingInput(config)}
                              {saving === config.key && (
                                <Save className="h-4 w-4 text-blue-600 animate-pulse" />
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </Card>

                    {/* Help Text */}
                    <div className="mt-6 text-sm text-muted-foreground">
                      <p>
                        <strong>Hinweis:</strong> Änderungen werden automatisch gespeichert.
                        Einige Einstellungen werden erst nach dem nächsten Polling-Intervall wirksam.
                      </p>
                    </div>
                  </>
                )}
              </TabsContent>

              {/* Notifications Tab */}
              <TabsContent value="notifications">
                <NotificationSettingsCard />
              </TabsContent>

              {/* Sync Tab */}
              <TabsContent value="sync">
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
              </TabsContent>
            </Tabs>
          </div>
        </main>
      </div>

      {/* Mobile Bottom Navigation */}

      <MobileBottomNavigation currentPage="settings" />

    </ProtectedRoute>
  );
}
