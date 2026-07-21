'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'

import { toast } from 'sonner'
import { useNotifications } from '@/lib/contexts/notification-context'
import { apiClient } from '@/lib/api-client'
import type { NotificationSettings } from '@/lib/types/notification'

export function NotificationSettingsCard() {
  const t = useTranslations('notifications.settings')
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
      toast.error(t('saveFailed'))
    } finally {
      setSavingKey(null)
    }
  }

  return (
    <div className="space-y-6">
      {/* Warnungen */}
      <Card className="p-6">
      <div className="space-y-1 mb-4">
        <p className="font-medium">{t('warningsTitle')}</p>
        <p className="text-xs text-muted-foreground">{t('warningsSubtitle')}</p>
      </div>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <Label htmlFor="time-alerts" className="font-medium">{t('timeAlertsLabel')}</Label>
            <p className="text-xs text-muted-foreground">
              {t('timeAlertsHint')}
            </p>
          </div>
          <Switch
            id="time-alerts"
            checked={settings.enabled_time_alerts}
            onCheckedChange={(checked) => updateSetting('enabled_time_alerts', checked)}
            disabled={savingKey === 'enabled_time_alerts'}
          />
        </div>

        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <Label htmlFor="resource-alerts" className="font-medium">{t('resourceAlertsLabel')}</Label>
            <p className="text-xs text-muted-foreground">
              {t('resourceAlertsHint')}
            </p>
          </div>
          <Switch
            id="resource-alerts"
            checked={settings.enabled_resource_alerts}
            onCheckedChange={(checked) => updateSetting('enabled_resource_alerts', checked)}
            disabled={savingKey === 'enabled_resource_alerts'}
          />
        </div>

        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <Label htmlFor="data-quality-alerts" className="font-medium">{t('dataQualityAlertsLabel')}</Label>
            <p className="text-xs text-muted-foreground">
              {t('dataQualityAlertsHint')}
            </p>
          </div>
          <Switch
            id="data-quality-alerts"
            checked={settings.enabled_data_quality_alerts}
            onCheckedChange={(checked) => updateSetting('enabled_data_quality_alerts', checked)}
            disabled={savingKey === 'enabled_data_quality_alerts'}
          />
        </div>

        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <Label htmlFor="event-alerts" className="font-medium">{t('eventAlertsLabel')}</Label>
            <p className="text-xs text-muted-foreground">
              {t('eventAlertsHint')}
            </p>
          </div>
          <Switch
            id="event-alerts"
            checked={settings.enabled_event_alerts}
            onCheckedChange={(checked) => updateSetting('enabled_event_alerts', checked)}
            disabled={savingKey === 'enabled_event_alerts'}
          />
        </div>

        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <Label htmlFor="geofence-alerts" className="font-medium">{t('geofenceAlertsLabel')}</Label>
            <p className="text-xs text-muted-foreground">
              {t('geofenceAlertsHint')}
            </p>
          </div>
          <Switch
            id="geofence-alerts"
            checked={settings.enabled_geofence_alerts}
            onCheckedChange={(checked) => updateSetting('enabled_geofence_alerts', checked)}
            disabled={savingKey === 'enabled_geofence_alerts'}
          />
        </div>

        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <Label htmlFor="toast-duration" className="font-medium">{t('toastDurationLabel')}</Label>
            <p className="text-xs text-muted-foreground">{t('toastDurationHint')}</p>
          </div>
          <div className="flex-shrink-0 w-24">
            <Input
              id="toast-duration"
              type="number"
              min={2}
              max={30}
              defaultValue={settings.toast_duration_seconds}
              onBlur={(e) => {
                const val = parseInt(e.target.value)
                if (!isNaN(val) && val !== settings.toast_duration_seconds) {
                  updateSetting('toast_duration_seconds', Math.max(2, Math.min(30, val)))
                }
              }}
              disabled={savingKey === 'toast_duration_seconds'}
            />
          </div>
        </div>
      </div>
      </Card>

      {/* Zeitlimits */}
      <Card className="p-6">
      <div className="space-y-4">
        <div>
          <p className="font-medium">{t('timeLimitsTitle')}</p>
          <p className="text-xs text-muted-foreground">
            {t('timeLimitsSubtitle')}
          </p>
        </div>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'live' | 'training')}>
          <TabsList className="grid w-full grid-cols-2 mb-4">
            <TabsTrigger value="live">{t('liveTab')}</TabsTrigger>
            <TabsTrigger value="training">{t('trainingTab')}</TabsTrigger>
          </TabsList>

          <TabsContent value="live" className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="live-eingegangen" className="font-medium">{t('eingegangenMin')}</Label>
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
                <Label htmlFor="live-reko" className="font-medium">{t('rekoMin')}</Label>
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
                <Label htmlFor="live-disponiert" className="font-medium">{t('disponiertMin')}</Label>
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
                <Label htmlFor="live-einsatz" className="font-medium">{t('einsatzHours')}</Label>
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
                <Label htmlFor="live-rueckfahrt" className="font-medium">{t('rueckfahrtMin')}</Label>
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
                <Label htmlFor="live-archive" className="font-medium">{t('archiveHours')}</Label>
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
                <Label htmlFor="training-eingegangen" className="font-medium">{t('eingegangenMin')}</Label>
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
                <Label htmlFor="training-reko" className="font-medium">{t('rekoMin')}</Label>
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
                <Label htmlFor="training-disponiert" className="font-medium">{t('disponiertMin')}</Label>
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
                <Label htmlFor="training-einsatz" className="font-medium">{t('einsatzHours')}</Label>
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
                <Label htmlFor="training-rueckfahrt" className="font-medium">{t('rueckfahrtMin')}</Label>
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
                <Label htmlFor="training-archive" className="font-medium">{t('archiveHours')}</Label>
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
      </Card>

      {/* Schwellenwerte */}
      <Card className="p-6">
      <div className="space-y-4">
        <div>
          <p className="font-medium">{t('thresholdsTitle')}</p>
          <p className="text-xs text-muted-foreground">
            {t('thresholdsSubtitle')}
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="grid gap-2">
            <Label htmlFor="fatigue-hours" className="font-medium">{t('fatigueLabel')}</Label>
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
            <Label htmlFor="database-limit" className="font-medium">{t('databaseLabel')}</Label>
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
            <Label htmlFor="photo-limit" className="font-medium">{t('photoLabel')}</Label>
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
          <p className="text-sm font-medium">{t('materialThresholdsTitle')}</p>
          <p className="text-xs text-muted-foreground">
            {t('materialThresholdsSubtitle')}
          </p>
          <Link
            href="/settings?section=materials"
            className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            {t('materialThresholdsManageLink')}
            <ArrowRight className="h-3 w-3" />
          </Link>
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
    </div>
  )
}
