'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { CheckCircle2, X, Loader2, Eye, EyeOff } from 'lucide-react'
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
      toast.success('Synchronisations-Konfiguration gespeichert')
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Synchronisations-Konfiguration</CardTitle>
        <CardDescription>
          Einstellungen für automatische Datensynchronisation
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : (
          <>
            {/* Railway Database URL */}
            <div className="space-y-2">
              <Label htmlFor="railway-database-url">Railway PostgreSQL Verbindung</Label>
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
              <p className="text-sm text-muted-foreground">
                {railwayDatabaseUrl
                  ? 'PostgreSQL Connection String der Railway Datenbank (leer lassen für lokalen Modus)'
                  : '⚠️ Keine Verbindung konfiguriert - Synchronisation deaktiviert'}
              </p>
            </div>

            {/* Sync Interval */}
            <div className="space-y-2">
              <Label htmlFor="sync-interval">Synchronisations-Intervall (Minuten)</Label>
              <Input
                id="sync-interval"
                type="number"
                min={1}
                max={60}
                value={intervalMinutes}
                onChange={(e) => setIntervalMinutes(parseInt(e.target.value) || 2)}
                className="max-w-xs"
              />
              <p className="text-sm text-muted-foreground">
                Automatische Synchronisation alle {intervalMinutes} Minute(n)
              </p>
            </div>

            {/* Auto-sync on create */}
            <div className="flex items-center justify-between space-x-2">
              <div className="space-y-1">
                <Label htmlFor="auto-sync">Automatisch bei Erstellung synchronisieren</Label>
                <p className="text-sm text-muted-foreground">
                  Sofortige Synchronisation nach Erstellen von Einsätzen/Ereignissen
                </p>
              </div>
              <Switch
                id="auto-sync"
                checked={autoSyncOnCreate}
                onCheckedChange={setAutoSyncOnCreate}
              />
            </div>

            {/* Advanced Settings */}
            <div className="space-y-4 pt-4 border-t">
              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex items-center gap-2 text-sm font-medium"
              >
                <span>{showAdvanced ? '▼' : '▶'}</span>
                Erweiterte Einstellungen
              </button>

              {showAdvanced && (
                <div className="space-y-4 pl-6">
                  {/* Conflict Buffer */}
                  <div className="space-y-2">
                    <Label htmlFor="conflict-buffer">Konflikt-Puffer (Sekunden)</Label>
                    <Input
                      id="conflict-buffer"
                      type="number"
                      min={0}
                      max={30}
                      value={conflictBuffer}
                      onChange={(e) => setConflictBuffer(parseInt(e.target.value) || 5)}
                      className="max-w-xs"
                    />
                    <p className="text-sm text-muted-foreground">
                      Zeitpuffer für Konfliktauflösung (lokale Änderungen gewinnen bei gleichen Zeitstempeln)
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Sync Scope - Read-only info */}
            <div className="space-y-2 pt-4 border-t">
              <Label>Synchronisations-Umfang</Label>
              <div className="grid grid-cols-2 gap-2">
                <div className="flex items-center gap-2 text-sm">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  <span>Einsätze</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  <span>Personal</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  <span>Fahrzeuge</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  <span>Materialien</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  <span>Einstellungen</span>
                </div>
              </div>
              <p className="text-sm text-muted-foreground pt-2">Nicht synchronisiert:</p>
              <div className="grid grid-cols-2 gap-2">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <X className="h-4 w-4" />
                  <span>Fotos</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <X className="h-4 w-4" />
                  <span>Audit Logs</span>
                </div>
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
      </CardContent>
    </Card>
  )
}
