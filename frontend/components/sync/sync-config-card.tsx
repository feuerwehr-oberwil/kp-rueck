'use client'

import { useState, useEffect } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Loader2, Eye, EyeOff, Info } from 'lucide-react'
import { toast } from 'sonner'
import { apiClient } from '@/lib/api-client'
import type { SyncConfig } from '@/types/sync'

export function SyncConfigCard() {
  const [config, setConfig] = useState<SyncConfig | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [intervalMinutes, setIntervalMinutes] = useState<number>(2)
  const [autoSyncOnCreate, setAutoSyncOnCreate] = useState<boolean>(true)
  const [railwayDatabaseUrl, setRailwayDatabaseUrl] = useState<string>('')
  const [conflictBuffer, setConflictBuffer] = useState<number>(5)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  // Load config on mount
  useEffect(() => {
    loadConfig()
  }, [])

  const loadConfig = async () => {
    try {
      setIsLoading(true)
      const data = await apiClient.getSyncConfig()
      setConfig(data)
      setIntervalMinutes(data.sync_interval_minutes)
      setAutoSyncOnCreate(data.auto_sync_on_create)
      setRailwayDatabaseUrl(data.railway_database_url)
      setConflictBuffer(data.sync_conflict_buffer_seconds || 5)
    } catch (error) {
      toast.error('Fehler beim Laden der Synchronisations-Konfiguration')
      console.error(error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleSave = async () => {
    try {
      setIsSaving(true)
      const newConfig: SyncConfig = {
        sync_interval_minutes: intervalMinutes,
        auto_sync_on_create: autoSyncOnCreate,
        railway_database_url: railwayDatabaseUrl,
        sync_conflict_buffer_seconds: conflictBuffer,
      }
      await apiClient.updateSyncConfig(newConfig)
      setConfig(newConfig)
    } catch (error) {
      toast.error('Fehler beim Speichern der Konfiguration')
      console.error(error)
    } finally {
      setIsSaving(false)
    }
  }

  const hasChanges =
    config &&
    (config.sync_interval_minutes !== intervalMinutes ||
      config.auto_sync_on_create !== autoSyncOnCreate ||
      config.railway_database_url !== railwayDatabaseUrl ||
      (config.sync_conflict_buffer_seconds || 5) !== conflictBuffer)

  // Check if the URL looks like an internal Railway URL (won't work from external networks)
  const isInternalUrl = railwayDatabaseUrl && (
    railwayDatabaseUrl.includes('containers-') ||
    railwayDatabaseUrl.includes('.railway.internal') ||
    railwayDatabaseUrl.includes('postgres.railway.internal')
  )

  return (
    <Card className="p-6">
      <div className="space-y-1 mb-4">
        <p className="font-medium">Synchronisations-Konfiguration</p>
        <p className="text-xs text-muted-foreground">Einstellungen für automatische Datensynchronisation</p>
      </div>
      <div className="space-y-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : config?.is_production ? (
          /* Production - Only show info message */
          <div className="flex items-start gap-3 p-4 rounded-lg bg-muted/50 border border-border">
            <Info className="h-5 w-5 text-info shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="text-sm font-medium">Synchronisationsfunktion nur lokal verfügbar</p>
              <p className="text-sm text-muted-foreground">
                Die Synchronisationsfunktion ist nur für lokale Instanzen verfügbar.
                Auf Railway (Produktion) ist die Synchronisation deaktiviert, da Railway
                als zentrale Datenquelle dient.
              </p>
            </div>
          </div>
        ) : (
          <>
            {/* Railway Database URL - full width since it's a long input */}
            <div className="space-y-2">
              <Label htmlFor="railway-database-url" className="font-medium">Railway PostgreSQL Verbindung</Label>
              <div className="relative">
                <Input
                  id="railway-database-url"
                  type={showPassword ? "text" : "password"}
                  placeholder="postgresql://user:pass@host:port/database"
                  value={railwayDatabaseUrl}
                  onChange={(e) => setRailwayDatabaseUrl(e.target.value)}
                  className="pr-10"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                  onClick={() => setShowPassword(!showPassword)}
                  tabIndex={-1}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <Eye className="h-4 w-4 text-muted-foreground" />
                  )}
                </Button>
              </div>
              {isInternalUrl && (
                <p className="text-sm text-amber-600 dark:text-amber-400">
                  ⚠️ Interne Railway-URL erkannt. Verwenden Sie die <strong>öffentliche</strong> URL (Variables → DATABASE_PUBLIC_URL).
                </p>
              )}
            </div>

            {/* Sync Interval */}
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <Label htmlFor="sync-interval" className="font-medium">Intervall</Label>
                <p className="text-xs text-muted-foreground">Automatische Synchronisation</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <Input
                  id="sync-interval"
                  type="number"
                  min={1}
                  max={60}
                  value={intervalMinutes}
                  onChange={(e) => setIntervalMinutes(parseInt(e.target.value) || 2)}
                  className="w-20"
                />
                <span className="text-xs text-muted-foreground">Min</span>
              </div>
            </div>

            {/* Auto-sync on create */}
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <Label htmlFor="auto-sync" className="font-medium">Auto-Sync bei Erstellung</Label>
                <p className="text-xs text-muted-foreground">Sofortige Sync nach neuen Einsätzen/Ereignissen</p>
              </div>
              <Switch
                id="auto-sync"
                checked={autoSyncOnCreate}
                onCheckedChange={setAutoSyncOnCreate}
              />
            </div>

            {/* Conflict Buffer */}
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <Label htmlFor="conflict-buffer" className="font-medium">Konflikt-Puffer</Label>
                <p className="text-xs text-muted-foreground">Lokale Änderungen gewinnen bei gleichen Zeitstempeln</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <Input
                  id="conflict-buffer"
                  type="number"
                  min={0}
                  max={30}
                  value={conflictBuffer}
                  onChange={(e) => setConflictBuffer(parseInt(e.target.value) || 5)}
                  className="w-20"
                />
                <span className="text-xs text-muted-foreground">Sek</span>
              </div>
            </div>

            {/* Save Button */}
            <div className="flex justify-end pt-4">
              <Button
                onClick={handleSave}
                disabled={!hasChanges || isSaving}
                className="flex items-center gap-2"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Speichert...
                  </>
                ) : (
                  'Änderungen speichern'
                )}
              </Button>
            </div>
          </>
        )}
      </div>
    </Card>
  )
}
