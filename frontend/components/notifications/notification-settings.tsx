'use client'

import { useState, useEffect } from 'react'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Switch } from '@/components/ui/switch'
import { Save, Bell } from 'lucide-react'
import { toast } from 'sonner'
import { useNotifications } from '@/lib/contexts/notification-context'
import type { NotificationSettings } from '@/lib/types/notification'

export function NotificationSettingsCard() {
  const { settings, updateSettings } = useNotifications()
  const [localSettings, setLocalSettings] = useState<NotificationSettings>(settings)
  const [saving, setSaving] = useState(false)
  const [activeTab, setActiveTab] = useState<'live' | 'training'>('live')

  useEffect(() => {
    setLocalSettings(settings)
  }, [settings])

  const handleSave = async () => {
    setSaving(true)
    try {
      await updateSettings(localSettings)
      toast.success('Benachrichtigungseinstellungen gespeichert')
    } catch (error) {
      toast.error('Fehler beim Speichern der Einstellungen')
    } finally {
      setSaving(false)
    }
  }

  const updateLocalSetting = <K extends keyof NotificationSettings>(
    key: K,
    value: NotificationSettings[K]
  ) => {
    setLocalSettings((prev) => ({ ...prev, [key]: value }))
  }

  const hasChanges = JSON.stringify(localSettings) !== JSON.stringify(settings)

  return (
    <Card className="p-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-900/20">
          <Bell className="h-5 w-5 text-blue-600 dark:text-blue-400" />
        </div>
        <div>
          <h2 className="text-xl font-semibold">Benachrichtigungseinstellungen</h2>
          <p className="text-sm text-muted-foreground">
            Schwellenwerte für zeitbasierte und ressourcenbezogene Warnungen
          </p>
        </div>
      </div>

      {/* Enable/Disable toggles */}
      <div className="space-y-4 mb-6 p-4 bg-muted/50 rounded-lg">
        <div className="flex items-center justify-between">
          <div>
            <Label htmlFor="time-alerts">Zeitbasierte Warnungen</Label>
            <p className="text-xs text-muted-foreground">
              Warnung bei Überschreitung von Status-Zeitlimits
            </p>
          </div>
          <Switch
            id="time-alerts"
            checked={localSettings.enabled_time_alerts}
            onCheckedChange={(checked) => updateLocalSetting('enabled_time_alerts', checked)}
          />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <Label htmlFor="resource-alerts">Ressourcen-Warnungen</Label>
            <p className="text-xs text-muted-foreground">
              Warnung bei knappen Ressourcen oder Personalermüdung
            </p>
          </div>
          <Switch
            id="resource-alerts"
            checked={localSettings.enabled_resource_alerts}
            onCheckedChange={(checked) => updateLocalSetting('enabled_resource_alerts', checked)}
          />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <Label htmlFor="data-quality-alerts">Datenqualitäts-Warnungen</Label>
            <p className="text-xs text-muted-foreground">
              Warnung bei fehlenden Pflichtdaten
            </p>
          </div>
          <Switch
            id="data-quality-alerts"
            checked={localSettings.enabled_data_quality_alerts}
            onCheckedChange={(checked) =>
              updateLocalSetting('enabled_data_quality_alerts', checked)
            }
          />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <Label htmlFor="event-alerts">Event-Limit-Warnungen</Label>
            <p className="text-xs text-muted-foreground">
              Warnung bei Annäherung an Datenbankgrenzen
            </p>
          </div>
          <Switch
            id="event-alerts"
            checked={localSettings.enabled_event_alerts}
            onCheckedChange={(checked) => updateLocalSetting('enabled_event_alerts', checked)}
          />
        </div>
      </div>

      {/* Time threshold settings - Live vs Training */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'live' | 'training')}>
        <TabsList className="grid w-full grid-cols-2 mb-4">
          <TabsTrigger value="live">Live-Modus</TabsTrigger>
          <TabsTrigger value="training">Trainingsmodus</TabsTrigger>
        </TabsList>

        <TabsContent value="live" className="space-y-4">
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="live-eingegangen">Eingegangen (Minuten)</Label>
              <Input
                id="live-eingegangen"
                type="number"
                value={localSettings.live_eingegangen_min}
                onChange={(e) =>
                  updateLocalSetting('live_eingegangen_min', parseInt(e.target.value))
                }
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="live-reko">Reko (Minuten)</Label>
              <Input
                id="live-reko"
                type="number"
                value={localSettings.live_reko_min}
                onChange={(e) => updateLocalSetting('live_reko_min', parseInt(e.target.value))}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="live-disponiert">Disponiert/Unterwegs (Minuten)</Label>
              <Input
                id="live-disponiert"
                type="number"
                value={localSettings.live_disponiert_min}
                onChange={(e) =>
                  updateLocalSetting('live_disponiert_min', parseInt(e.target.value))
                }
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="live-einsatz">Einsatz (Stunden)</Label>
              <Input
                id="live-einsatz"
                type="number"
                value={localSettings.live_einsatz_hours}
                onChange={(e) =>
                  updateLocalSetting('live_einsatz_hours', parseInt(e.target.value))
                }
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="live-rueckfahrt">Einsatz beendet/Rückfahrt (Minuten)</Label>
              <Input
                id="live-rueckfahrt"
                type="number"
                value={localSettings.live_rueckfahrt_min}
                onChange={(e) =>
                  updateLocalSetting('live_rueckfahrt_min', parseInt(e.target.value))
                }
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="live-archive">Nicht archiviert nach Abschluss (Stunden)</Label>
              <Input
                id="live-archive"
                type="number"
                value={localSettings.live_archive_hours}
                onChange={(e) =>
                  updateLocalSetting('live_archive_hours', parseInt(e.target.value))
                }
              />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="training" className="space-y-4">
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="training-eingegangen">Eingegangen (Minuten)</Label>
              <Input
                id="training-eingegangen"
                type="number"
                value={localSettings.training_eingegangen_min}
                onChange={(e) =>
                  updateLocalSetting('training_eingegangen_min', parseInt(e.target.value))
                }
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="training-reko">Reko (Minuten)</Label>
              <Input
                id="training-reko"
                type="number"
                value={localSettings.training_reko_min}
                onChange={(e) =>
                  updateLocalSetting('training_reko_min', parseInt(e.target.value))
                }
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="training-disponiert">Disponiert/Unterwegs (Minuten)</Label>
              <Input
                id="training-disponiert"
                type="number"
                value={localSettings.training_disponiert_min}
                onChange={(e) =>
                  updateLocalSetting('training_disponiert_min', parseInt(e.target.value))
                }
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="training-einsatz">Einsatz (Stunden)</Label>
              <Input
                id="training-einsatz"
                type="number"
                value={localSettings.training_einsatz_hours}
                onChange={(e) =>
                  updateLocalSetting('training_einsatz_hours', parseInt(e.target.value))
                }
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="training-rueckfahrt">Einsatz beendet/Rückfahrt (Minuten)</Label>
              <Input
                id="training-rueckfahrt"
                type="number"
                value={localSettings.training_rueckfahrt_min}
                onChange={(e) =>
                  updateLocalSetting('training_rueckfahrt_min', parseInt(e.target.value))
                }
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="training-archive">Nicht archiviert nach Abschluss (Stunden)</Label>
              <Input
                id="training-archive"
                type="number"
                value={localSettings.training_archive_hours}
                onChange={(e) =>
                  updateLocalSetting('training_archive_hours', parseInt(e.target.value))
                }
              />
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* Resource and event settings */}
      <div className="mt-6 space-y-4">
        <h3 className="font-semibold">Ressourcen-Schwellenwerte</h3>

        <div className="grid gap-2">
          <Label htmlFor="fatigue-hours">Personalermüdung (Stunden)</Label>
          <Input
            id="fatigue-hours"
            type="number"
            value={localSettings.fatigue_hours}
            onChange={(e) => updateLocalSetting('fatigue_hours', parseInt(e.target.value))}
          />
          <p className="text-xs text-muted-foreground">
            Warnung, wenn Personal länger als diese Anzahl Stunden eingesetzt ist
          </p>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="database-limit">Datenbank-Limit (GB)</Label>
          <Input
            id="database-limit"
            type="number"
            value={localSettings.database_size_limit_gb}
            onChange={(e) =>
              updateLocalSetting('database_size_limit_gb', parseInt(e.target.value))
            }
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="photo-limit">Foto-Limit (GB)</Label>
          <Input
            id="photo-limit"
            type="number"
            value={localSettings.photo_size_limit_gb}
            onChange={(e) => updateLocalSetting('photo_size_limit_gb', parseInt(e.target.value))}
          />
        </div>
      </div>

      {/* Save button */}
      <div className="mt-6 flex justify-end">
        <Button onClick={handleSave} disabled={!hasChanges || saving}>
          <Save className="h-4 w-4 mr-2" />
          {saving ? 'Speichern...' : 'Änderungen speichern'}
        </Button>
      </div>
    </Card>
  )
}
