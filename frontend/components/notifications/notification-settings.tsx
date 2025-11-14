'use client'

import { useState, useEffect } from 'react'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import { Bell, Save } from 'lucide-react'
import { toast } from 'sonner'
import { useNotifications } from '@/lib/contexts/notification-context'
import { apiClient } from '@/lib/api-client'
import type { NotificationSettings } from '@/lib/types/notification'

export function NotificationSettingsCard() {
  const { settings, updateSettings } = useNotifications()
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'live' | 'training'>('live')
  const [materialTypes, setMaterialTypes] = useState<string[]>([])

  useEffect(() => {
    // Fetch unique material types from database
    const fetchMaterialTypes = async () => {
      try {
        const materials = await apiClient.getAllMaterials()
        const types = Array.from(new Set(materials.map(m => m.type))).sort()
        setMaterialTypes(types)

        // Ensure all types are in the threshold settings
        const currentThresholds = { ...settings.material_depletion_threshold }
        let updated = false

        for (const type of types) {
          if (!(type in currentThresholds)) {
            currentThresholds[type] = 2 // Default threshold
            updated = true
          }
        }

        if (updated) {
          await updateSettings({ ...settings, material_depletion_threshold: currentThresholds })
        }
      } catch (error) {
        console.error('Failed to fetch material types:', error)
      }
    }

    fetchMaterialTypes()
  }, []) // Only run once on mount

  const updateSetting = async <K extends keyof NotificationSettings>(
    key: K,
    value: NotificationSettings[K]
  ) => {
    setSavingKey(key as string)
    try {
      await updateSettings({ ...settings, [key]: value })
      // Success toast is optional - removed to reduce noise
    } catch (error) {
      toast.error('Fehler beim Speichern der Einstellung')
    } finally {
      setSavingKey(null)
    }
  }

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
          <div className="flex items-center gap-2">
            <Switch
              id="time-alerts"
              checked={settings.enabled_time_alerts}
              onCheckedChange={(checked) => updateSetting('enabled_time_alerts', checked)}
              disabled={savingKey === 'enabled_time_alerts'}
            />
            {savingKey === 'enabled_time_alerts' && <Save className="h-4 w-4 text-blue-600 animate-pulse" />}
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <Label htmlFor="resource-alerts">Ressourcen-Warnungen</Label>
            <p className="text-xs text-muted-foreground">
              Warnung bei knappen Ressourcen oder Personalermüdung
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="resource-alerts"
              checked={settings.enabled_resource_alerts}
              onCheckedChange={(checked) => updateSetting('enabled_resource_alerts', checked)}
              disabled={savingKey === 'enabled_resource_alerts'}
            />
            {savingKey === 'enabled_resource_alerts' && <Save className="h-4 w-4 text-blue-600 animate-pulse" />}
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <Label htmlFor="data-quality-alerts">Datenqualitäts-Warnungen</Label>
            <p className="text-xs text-muted-foreground">
              Warnung bei fehlenden Pflichtdaten
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="data-quality-alerts"
              checked={settings.enabled_data_quality_alerts}
              onCheckedChange={(checked) => updateSetting('enabled_data_quality_alerts', checked)}
              disabled={savingKey === 'enabled_data_quality_alerts'}
            />
            {savingKey === 'enabled_data_quality_alerts' && <Save className="h-4 w-4 text-blue-600 animate-pulse" />}
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <Label htmlFor="event-alerts">Event-Limit-Warnungen</Label>
            <p className="text-xs text-muted-foreground">
              Warnung bei Annäherung an Datenbankgrenzen
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="event-alerts"
              checked={settings.enabled_event_alerts}
              onCheckedChange={(checked) => updateSetting('enabled_event_alerts', checked)}
              disabled={savingKey === 'enabled_event_alerts'}
            />
            {savingKey === 'enabled_event_alerts' && <Save className="h-4 w-4 text-blue-600 animate-pulse" />}
          </div>
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
              <div className="flex items-center gap-2">
                <Input
                  id="live-eingegangen"
                  type="number"
                  defaultValue={settings.live_eingegangen_min}
                  onBlur={(e) => {
                    const val = parseInt(e.target.value)
                    if (!isNaN(val) && val !== settings.live_eingegangen_min) {
                      updateSetting('live_eingegangen_min', val)
                    }
                  }}
                  disabled={savingKey === 'live_eingegangen_min'}
                />
                {savingKey === 'live_eingegangen_min' && <Save className="h-4 w-4 text-blue-600 animate-pulse" />}
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="live-reko">Reko (Minuten)</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="live-reko"
                  type="number"
                  defaultValue={settings.live_reko_min}
                  onBlur={(e) => {
                    const val = parseInt(e.target.value)
                    if (!isNaN(val) && val !== settings.live_reko_min) {
                      updateSetting('live_reko_min', val)
                    }
                  }}
                  disabled={savingKey === 'live_reko_min'}
                />
                {savingKey === 'live_reko_min' && <Save className="h-4 w-4 text-blue-600 animate-pulse" />}
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="live-disponiert">Disponiert/Unterwegs (Minuten)</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="live-disponiert"
                  type="number"
                  defaultValue={settings.live_disponiert_min}
                  onBlur={(e) => {
                    const val = parseInt(e.target.value)
                    if (!isNaN(val) && val !== settings.live_disponiert_min) {
                      updateSetting('live_disponiert_min', val)
                    }
                  }}
                  disabled={savingKey === 'live_disponiert_min'}
                />
                {savingKey === 'live_disponiert_min' && <Save className="h-4 w-4 text-blue-600 animate-pulse" />}
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="live-einsatz">Einsatz (Stunden)</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="live-einsatz"
                  type="number"
                  defaultValue={settings.live_einsatz_hours}
                  onBlur={(e) => {
                    const val = parseInt(e.target.value)
                    if (!isNaN(val) && val !== settings.live_einsatz_hours) {
                      updateSetting('live_einsatz_hours', val)
                    }
                  }}
                  disabled={savingKey === 'live_einsatz_hours'}
                />
                {savingKey === 'live_einsatz_hours' && <Save className="h-4 w-4 text-blue-600 animate-pulse" />}
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="live-rueckfahrt">Einsatz beendet/Rückfahrt (Minuten)</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="live-rueckfahrt"
                  type="number"
                  defaultValue={settings.live_rueckfahrt_min}
                  onBlur={(e) => {
                    const val = parseInt(e.target.value)
                    if (!isNaN(val) && val !== settings.live_rueckfahrt_min) {
                      updateSetting('live_rueckfahrt_min', val)
                    }
                  }}
                  disabled={savingKey === 'live_rueckfahrt_min'}
                />
                {savingKey === 'live_rueckfahrt_min' && <Save className="h-4 w-4 text-blue-600 animate-pulse" />}
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="live-archive">Nicht archiviert nach Abschluss (Stunden)</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="live-archive"
                  type="number"
                  defaultValue={settings.live_archive_hours}
                  onBlur={(e) => {
                    const val = parseInt(e.target.value)
                    if (!isNaN(val) && val !== settings.live_archive_hours) {
                      updateSetting('live_archive_hours', val)
                    }
                  }}
                  disabled={savingKey === 'live_archive_hours'}
                />
                {savingKey === 'live_archive_hours' && <Save className="h-4 w-4 text-blue-600 animate-pulse" />}
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="training" className="space-y-4">
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="training-eingegangen">Eingegangen (Minuten)</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="training-eingegangen"
                  type="number"
                  defaultValue={settings.training_eingegangen_min}
                  onBlur={(e) => {
                    const val = parseInt(e.target.value)
                    if (!isNaN(val) && val !== settings.training_eingegangen_min) {
                      updateSetting('training_eingegangen_min', val)
                    }
                  }}
                  disabled={savingKey === 'training_eingegangen_min'}
                />
                {savingKey === 'training_eingegangen_min' && <Save className="h-4 w-4 text-blue-600 animate-pulse" />}
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="training-reko">Reko (Minuten)</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="training-reko"
                  type="number"
                  defaultValue={settings.training_reko_min}
                  onBlur={(e) => {
                    const val = parseInt(e.target.value)
                    if (!isNaN(val) && val !== settings.training_reko_min) {
                      updateSetting('training_reko_min', val)
                    }
                  }}
                  disabled={savingKey === 'training_reko_min'}
                />
                {savingKey === 'training_reko_min' && <Save className="h-4 w-4 text-blue-600 animate-pulse" />}
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="training-disponiert">Disponiert/Unterwegs (Minuten)</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="training-disponiert"
                  type="number"
                  defaultValue={settings.training_disponiert_min}
                  onBlur={(e) => {
                    const val = parseInt(e.target.value)
                    if (!isNaN(val) && val !== settings.training_disponiert_min) {
                      updateSetting('training_disponiert_min', val)
                    }
                  }}
                  disabled={savingKey === 'training_disponiert_min'}
                />
                {savingKey === 'training_disponiert_min' && <Save className="h-4 w-4 text-blue-600 animate-pulse" />}
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="training-einsatz">Einsatz (Stunden)</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="training-einsatz"
                  type="number"
                  defaultValue={settings.training_einsatz_hours}
                  onBlur={(e) => {
                    const val = parseInt(e.target.value)
                    if (!isNaN(val) && val !== settings.training_einsatz_hours) {
                      updateSetting('training_einsatz_hours', val)
                    }
                  }}
                  disabled={savingKey === 'training_einsatz_hours'}
                />
                {savingKey === 'training_einsatz_hours' && <Save className="h-4 w-4 text-blue-600 animate-pulse" />}
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="training-rueckfahrt">Einsatz beendet/Rückfahrt (Minuten)</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="training-rueckfahrt"
                  type="number"
                  defaultValue={settings.training_rueckfahrt_min}
                  onBlur={(e) => {
                    const val = parseInt(e.target.value)
                    if (!isNaN(val) && val !== settings.training_rueckfahrt_min) {
                      updateSetting('training_rueckfahrt_min', val)
                    }
                  }}
                  disabled={savingKey === 'training_rueckfahrt_min'}
                />
                {savingKey === 'training_rueckfahrt_min' && <Save className="h-4 w-4 text-blue-600 animate-pulse" />}
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="training-archive">Nicht archiviert nach Abschluss (Stunden)</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="training-archive"
                  type="number"
                  defaultValue={settings.training_archive_hours}
                  onBlur={(e) => {
                    const val = parseInt(e.target.value)
                    if (!isNaN(val) && val !== settings.training_archive_hours) {
                      updateSetting('training_archive_hours', val)
                    }
                  }}
                  disabled={savingKey === 'training_archive_hours'}
                />
                {savingKey === 'training_archive_hours' && <Save className="h-4 w-4 text-blue-600 animate-pulse" />}
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* Resource and event settings */}
      <div className="mt-6 space-y-4">
        <h3 className="font-semibold">Ressourcen-Schwellenwerte</h3>

        <div className="grid gap-2">
          <Label htmlFor="fatigue-hours">Personalermüdung (Stunden)</Label>
          <div className="flex items-center gap-2">
            <Input
              id="fatigue-hours"
              type="number"
              defaultValue={settings.fatigue_hours}
              onBlur={(e) => {
                const val = parseInt(e.target.value)
                if (!isNaN(val) && val !== settings.fatigue_hours) {
                  updateSetting('fatigue_hours', val)
                }
              }}
              disabled={savingKey === 'fatigue_hours'}
            />
            {savingKey === 'fatigue_hours' && <Save className="h-4 w-4 text-blue-600 animate-pulse" />}
          </div>
          <p className="text-xs text-muted-foreground">
            Warnung, wenn Personal länger als diese Anzahl Stunden eingesetzt ist
          </p>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="database-limit">Datenbank-Limit (GB)</Label>
          <div className="flex items-center gap-2">
            <Input
              id="database-limit"
              type="number"
              defaultValue={settings.database_size_limit_gb}
              onBlur={(e) => {
                const val = parseInt(e.target.value)
                if (!isNaN(val) && val !== settings.database_size_limit_gb) {
                  updateSetting('database_size_limit_gb', val)
                }
              }}
              disabled={savingKey === 'database_size_limit_gb'}
            />
            {savingKey === 'database_size_limit_gb' && <Save className="h-4 w-4 text-blue-600 animate-pulse" />}
          </div>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="photo-limit">Foto-Limit (GB)</Label>
          <div className="flex items-center gap-2">
            <Input
              id="photo-limit"
              type="number"
              defaultValue={settings.photo_size_limit_gb}
              onBlur={(e) => {
                const val = parseInt(e.target.value)
                if (!isNaN(val) && val !== settings.photo_size_limit_gb) {
                  updateSetting('photo_size_limit_gb', val)
                }
              }}
              disabled={savingKey === 'photo_size_limit_gb'}
            />
            {savingKey === 'photo_size_limit_gb' && <Save className="h-4 w-4 text-blue-600 animate-pulse" />}
          </div>
        </div>

        <div className="grid gap-2 pt-4 border-t">
          <Label>Materialbestand-Schwellenwerte</Label>
          <p className="text-xs text-muted-foreground mb-2">
            Warnung wenn verfügbare Einheiten unter den Schwellenwert fallen. Deaktivieren Sie die Checkbox, um Warnungen für einen Typ zu unterdrücken.
          </p>
          {materialTypes.map((materialType) => {
            const threshold = settings.material_depletion_threshold[materialType] ?? 2
            const isDisabled = threshold === -1

            return (
              <div key={materialType} className="grid grid-cols-[auto_1fr_auto] gap-3 items-center py-2">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id={`enable-${materialType}`}
                    checked={!isDisabled}
                    onCheckedChange={(checked) => {
                      const newThresholds = { ...settings.material_depletion_threshold }
                      newThresholds[materialType] = checked ? 2 : -1
                      updateSetting('material_depletion_threshold', newThresholds)
                    }}
                    disabled={savingKey === 'material_depletion_threshold'}
                  />
                  <Label
                    htmlFor={`enable-${materialType}`}
                    className="text-sm font-normal cursor-pointer"
                  >
                    {materialType}
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    id={`material-${materialType}`}
                    type="number"
                    min="0"
                    value={isDisabled ? '' : threshold}
                    onChange={(e) => {
                      const val = parseInt(e.target.value)
                      if (!isNaN(val) && val >= 0) {
                        const newThresholds = { ...settings.material_depletion_threshold }
                        newThresholds[materialType] = val
                        updateSetting('material_depletion_threshold', newThresholds)
                      }
                    }}
                    disabled={isDisabled || savingKey === 'material_depletion_threshold'}
                    placeholder={isDisabled ? 'Deaktiviert' : 'Schwellenwert'}
                    className="h-8"
                  />
                  {savingKey === 'material_depletion_threshold' && (
                    <Save className="h-4 w-4 text-blue-600 animate-pulse" />
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </Card>
  )
}
