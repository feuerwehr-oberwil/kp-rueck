'use client'

import { useState, useEffect } from 'react'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import { Bell } from 'lucide-react'
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
        // Materials use 'location' field for categorization (not 'type')
        const types = Array.from(new Set(materials.map(m => m.location || 'General'))).sort()
        setMaterialTypes(types)

        // Ensure all types are in the threshold settings
        const currentThresholds = { ...settings.material_depletion_threshold }
        let updated = false

        for (const type of types) {
          if (!(type in currentThresholds)) {
            currentThresholds[type] = -1 // Default disabled
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
    <Card className="p-6 space-y-6">
      {/* Intro text */}
      <p className="text-sm text-muted-foreground">
        Konfigurieren Sie Warnungen, die auf dem Einsatz-Board angezeigt werden.
        Änderungen werden automatisch gespeichert.
      </p>

      {/* Enable/Disable toggles */}
      <div className="space-y-4 p-4 bg-muted/50 rounded-lg">
        <div className="flex items-center justify-between">
          <div>
            <Label htmlFor="time-alerts">Zeitbasierte Warnungen</Label>
            <p className="text-xs text-muted-foreground">
              Warnung bei Überschreitung von Status-Zeitlimits
            </p>
          </div>
          <Switch
            id="time-alerts"
            checked={settings.enabled_time_alerts}
            onCheckedChange={(checked) => updateSetting('enabled_time_alerts', checked)}
            disabled={savingKey === 'enabled_time_alerts'}
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
            checked={settings.enabled_resource_alerts}
            onCheckedChange={(checked) => updateSetting('enabled_resource_alerts', checked)}
            disabled={savingKey === 'enabled_resource_alerts'}
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
            checked={settings.enabled_data_quality_alerts}
            onCheckedChange={(checked) => updateSetting('enabled_data_quality_alerts', checked)}
            disabled={savingKey === 'enabled_data_quality_alerts'}
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
            checked={settings.enabled_event_alerts}
            onCheckedChange={(checked) => updateSetting('enabled_event_alerts', checked)}
            disabled={savingKey === 'enabled_event_alerts'}
          />
        </div>
      </div>

      {/* Time threshold settings - Live vs Training */}
      <div className="space-y-3">
        <div>
          <p className="text-sm font-medium">Status-Zeitlimits</p>
          <p className="text-xs text-muted-foreground">
            Warnung erscheint, wenn ein Einsatz länger als angegeben in einem Status verbleibt.
          </p>
        </div>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'live' | 'training')}>
          <TabsList className="grid w-full grid-cols-2 mb-4">
            <TabsTrigger value="live">Live-Modus</TabsTrigger>
            <TabsTrigger value="training">Trainingsmodus</TabsTrigger>
          </TabsList>

          <TabsContent value="live" className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="live-eingegangen">Eingegangen (Min)</Label>
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
              </div>

              <div className="grid gap-2">
                <Label htmlFor="live-reko">Reko (Min)</Label>
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
              </div>

              <div className="grid gap-2">
                <Label htmlFor="live-disponiert">Disponiert (Min)</Label>
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
              </div>

              <div className="grid gap-2">
                <Label htmlFor="live-einsatz">Einsatz (Std)</Label>
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
              </div>

              <div className="grid gap-2">
                <Label htmlFor="live-rueckfahrt">Rückfahrt (Min)</Label>
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
              </div>

              <div className="grid gap-2">
                <Label htmlFor="live-archive">Archivierung (Std)</Label>
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
              </div>
            </div>
          </TabsContent>

          <TabsContent value="training" className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="training-eingegangen">Eingegangen (Min)</Label>
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
              </div>

              <div className="grid gap-2">
                <Label htmlFor="training-reko">Reko (Min)</Label>
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
              </div>

              <div className="grid gap-2">
                <Label htmlFor="training-disponiert">Disponiert (Min)</Label>
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
              </div>

              <div className="grid gap-2">
                <Label htmlFor="training-einsatz">Einsatz (Std)</Label>
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
              </div>

              <div className="grid gap-2">
                <Label htmlFor="training-rueckfahrt">Rückfahrt (Min)</Label>
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
              </div>

              <div className="grid gap-2">
                <Label htmlFor="training-archive">Archivierung (Std)</Label>
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
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* Resource and event settings */}
      <div className="space-y-4">
        <div>
          <p className="text-sm font-medium">Ressourcen-Schwellenwerte</p>
          <p className="text-xs text-muted-foreground">
            Warnung bei Überschreitung von Kapazitätsgrenzen.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="grid gap-2">
            <Label htmlFor="fatigue-hours">Personalermüdung (Std)</Label>
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
          </div>

          <div className="grid gap-2">
            <Label htmlFor="database-limit">Datenbank (GB)</Label>
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
          </div>

          <div className="grid gap-2">
            <Label htmlFor="photo-limit">Foto-Limit (GB)</Label>
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
          </div>
        </div>
      </div>

      {/* Material thresholds */}
      <div className="space-y-3 pt-4 border-t">
        <div>
          <p className="text-sm font-medium">Materialbestand-Schwellenwerte</p>
          <p className="text-xs text-muted-foreground">
            Warnung wenn verfügbare Einheiten einer Kategorie unter den Schwellenwert fallen.
            Deaktivieren Sie die Checkbox um Warnungen für eine Kategorie auszublenden.
          </p>
        </div>
        <div className="space-y-2">
          {materialTypes.map((materialType) => {
            const threshold = settings.material_depletion_threshold[materialType] ?? 2
            const isDisabled = threshold === -1

            return (
              <div key={materialType} className="flex items-center gap-3 py-1">
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
                  className="text-sm font-normal cursor-pointer flex-1"
                >
                  {materialType}
                </Label>
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
                  placeholder={isDisabled ? '-' : ''}
                  className="h-8 w-20"
                />
              </div>
            )
          })}
        </div>
      </div>
    </Card>
  )
}
