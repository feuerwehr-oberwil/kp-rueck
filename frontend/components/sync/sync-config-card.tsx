'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { CheckCircle2, X, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { apiClient } from '@/lib/api-client'
import type { SyncConfig } from '@/types/sync'

export function SyncConfigCard() {
  const [config, setConfig] = useState<SyncConfig | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [intervalMinutes, setIntervalMinutes] = useState<number>(2)
  const [autoSyncOnCreate, setAutoSyncOnCreate] = useState<boolean>(true)

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
      config.auto_sync_on_create !== autoSyncOnCreate)

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
