'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'

import { toast } from 'sonner'
import { useNotifications } from '@/lib/contexts/notification-context'
import { apiClient } from '@/lib/api-client'
import {
  SettingCard,
  SettingGroup,
  SettingRow,
} from '@/components/settings/setting-row'
import type { NotificationSettings } from '@/lib/types/notification'

/**
 * The five warning switches. They read like a personal preference and are not one:
 * every value on this card is stored once, in the backend, for the whole station –
 * see `updateSettings` in `lib/contexts/notification-context.tsx`. Switching one off
 * here switches it off on the wall display in the Magazin as well, which is why each
 * one that is OFF says so underneath.
 */
const WARNING_SWITCHES = [
  { id: 'time-alerts', key: 'enabled_time_alerts', label: 'timeAlertsLabel', hint: 'timeAlertsHint' },
  { id: 'resource-alerts', key: 'enabled_resource_alerts', label: 'resourceAlertsLabel', hint: 'resourceAlertsHint' },
  { id: 'data-quality-alerts', key: 'enabled_data_quality_alerts', label: 'dataQualityAlertsLabel', hint: 'dataQualityAlertsHint' },
  { id: 'event-alerts', key: 'enabled_event_alerts', label: 'eventAlertsLabel', hint: 'eventAlertsHint' },
  { id: 'geofence-alerts', key: 'enabled_geofence_alerts', label: 'geofenceAlertsLabel', hint: 'geofenceAlertsHint' },
] as const satisfies readonly {
  id: string
  key: keyof NotificationSettings
  label: string
  hint: string
}[]

/**
 * Die sechs Zeitlimits. Sie stehen doppelt in der Datenbank – einmal für den Ernstfall,
 * einmal für die Übung – und die beiden Reiter sind bis auf das Namenspräfix identisch.
 * Vorher standen sie darum auch zweimal im Code, zwölf gleich gebaute Blöcke hintereinander;
 * jeder Zusatz musste an zwei Stellen nachgezogen werden. Jetzt ist der Reiter ein Präfix.
 */
const TIME_LIMIT_FIELDS = [
  { suffix: 'eingegangen_min', label: 'eingegangenMin' },
  { suffix: 'reko_min', label: 'rekoMin' },
  { suffix: 'disponiert_min', label: 'disponiertMin' },
  { suffix: 'einsatz_hours', label: 'einsatzHours' },
  { suffix: 'rueckfahrt_min', label: 'rueckfahrtMin' },
  { suffix: 'archive_hours', label: 'archiveHours' },
] as const

type TimeLimitScope = 'live' | 'training'
/** `live_reko_min`, `training_archive_hours`, … – vom Compiler aus der Tabelle gebildet. */
type TimeLimitKey = `${TimeLimitScope}_${(typeof TIME_LIMIT_FIELDS)[number]['suffix']}`

/**
 * Die drei Schwellen, die kein Zeitlimit sind. `emptyIsZero`: ein geleertes Feld heisst
 * «Alarm aus». `parseInt('')` ergibt NaN, und der NaN-Schutz machte das Leeren damit zum
 * Nichts-Tun – ein einmal gesetztes Limit liess sich gar nicht mehr abschalten.
 */
const THRESHOLD_FIELDS = [
  { key: 'fatigue_hours', id: 'fatigue-hours', label: 'fatigueLabel', emptyIsZero: false },
  { key: 'database_size_limit_gb', id: 'database-limit', label: 'databaseLabel', emptyIsZero: true },
  { key: 'photo_size_limit_gb', id: 'photo-limit', label: 'photoLabel', emptyIsZero: true },
] as const satisfies readonly {
  key: keyof NotificationSettings
  id: string
  label: string
  emptyIsZero: boolean
}[]

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
    } catch {
      toast.error(t('saveFailed'))
    } finally {
      setSavingKey(null)
    }
  }

  return (
    <div className="space-y-6">
      {/* Warnungen. One mark on the card head – every row below shares its reach. */}
      <SettingCard title={t('warningsTitle')} subtitle={t('warningsSubtitle')}>
        {WARNING_SWITCHES.map(({ id, key, label, hint }) => {
          const checked = settings[key] === true
          return (
            <SettingRow
              key={key}
              label={t(label)}
              htmlFor={id}
              hint={t(hint)}
              // Ausgeschaltet ist hier keine persönliche Vorliebe, sondern eine Ansage für
              // die ganze Station – darum sagt jede AUS-Zeile das auch.
              footer={
                !checked ? (
                  <p className="mt-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs leading-relaxed text-warning-foreground">
                    {t('disabledForEveryone', { what: t(label) })}
                  </p>
                ) : null
              }
            >
              <Switch
                id={id}
                checked={checked}
                onCheckedChange={(next) => updateSetting(key, next)}
                disabled={savingKey === key}
              />
            </SettingRow>
          )
        })}

        <SettingRow
          label={t('toastDurationLabel')}
          htmlFor="toast-duration"
          hint={t('toastDurationHint')}
        >
          <Input
            id="toast-duration"
            type="number"
            className="w-24"
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
        </SettingRow>
      </SettingCard>

      {/* Zeitlimits */}
      <SettingCard title={t('timeLimitsTitle')} subtitle={t('timeLimitsSubtitle')}>
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TimeLimitScope)}>
          <TabsList className="grid w-full grid-cols-2 mb-2">
            <TabsTrigger value="live">{t('liveTab')}</TabsTrigger>
            <TabsTrigger value="training">{t('trainingTab')}</TabsTrigger>
          </TabsList>

          {(['live', 'training'] as const).map((scope) => (
            <TabsContent key={scope} value={scope}>
              {TIME_LIMIT_FIELDS.map(({ suffix, label }) => {
                const key = `${scope}_${suffix}` as TimeLimitKey
                return (
                  <SettingRow key={key} label={t(label)} htmlFor={key}>
                    <Input
                      id={key}
                      type="number"
                      className="w-24"
                      defaultValue={settings[key]}
                      onBlur={(e) => {
                        const val = parseInt(e.target.value)
                        if (!isNaN(val) && val !== settings[key]) {
                          updateSetting(key, val)
                        }
                      }}
                      disabled={savingKey === key}
                    />
                  </SettingRow>
                )
              })}
            </TabsContent>
          ))}
        </Tabs>
      </SettingCard>

      {/* Schwellenwerte */}
      <SettingCard title={t('thresholdsTitle')} subtitle={t('thresholdsSubtitle')}>
        {THRESHOLD_FIELDS.map(({ key, id, label, emptyIsZero }) => (
          <SettingRow key={key} label={t(label)} htmlFor={id}>
            <Input
              id={id}
              type="number"
              className="w-24"
              min={emptyIsZero ? 0 : undefined}
              defaultValue={settings[key] as number}
              onBlur={(e) => {
                const raw = e.target.value.trim()
                const val = emptyIsZero && raw === '' ? 0 : parseInt(raw)
                if (!isNaN(val) && val !== settings[key]) {
                  updateSetting(key, val)
                }
              }}
              disabled={savingKey === key}
            />
          </SettingRow>
        ))}

        {/* Material thresholds */}
        <SettingGroup
          title={t('materialThresholdsTitle')}
          hint={
            <>
              {t('materialThresholdsSubtitle')}
              <Link
                href="/settings?section=materials"
                className="mt-1 flex w-fit items-center gap-1 text-xs text-foreground underline underline-offset-2 hover:no-underline"
              >
                {t('materialThresholdsManageLink')}
                <ArrowRight className="h-3 w-3" />
              </Link>
            </>
          }
        >
          {/* Kein Material erfasst heisst: hier gibt es nichts einzustellen. Vorher stand an
              dieser Stelle nichts – ein leerer Abschnitt unter einer Überschrift, der wie ein
              Ladefehler aussieht. Der Verweis oben führt dorthin, wo man es behebt. */}
          {materialTypes.length === 0 && (
            <p
              role="note"
              className="rounded-md border bg-muted/30 px-3 py-2 text-xs leading-relaxed text-muted-foreground"
            >
              {t('materialThresholdsEmpty')}
            </p>
          )}
          {materialTypes.map((materialType) => {
            const threshold = settings.material_depletion_threshold[materialType] ?? 2
            const isDisabled = threshold === -1

            return (
              <SettingRow
                key={materialType}
                label={
                  <span className="flex items-center gap-2">
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
                    {materialType}
                  </span>
                }
                htmlFor={`enable-${materialType}`}
              >
                <Input
                  id={`material-${materialType}`}
                  aria-label={materialType}
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
                  className="w-20"
                />
              </SettingRow>
            )
          })}
        </SettingGroup>
      </SettingCard>
    </div>
  )
}
