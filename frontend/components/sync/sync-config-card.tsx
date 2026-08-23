'use client'

/**
 * Die Synchronisations-Einstellungen — in derselben Zeilen-Grammatik wie jede andere
 * Karte der Einstellungsseite (`setting-row.tsx`): Beschriftung und Hinweis links,
 * Bedienelement rechts in der festen Spalte, Knöpfe am Fuss.
 *
 * Die Verbindungs-URL ist ein `SettingBlock` und keine Zeile: eine Postgres-URL in
 * 200 Pixeln ist keine URL, sondern ein Ausschnitt davon.
 */

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import {
  SettingActions,
  SettingBlock,
  SettingCard,
  SettingRow,
} from '@/components/settings/setting-row'
import { SettingUnavailableNote } from '@/components/settings/setting-unavailable'
import { Loader2, Eye, EyeOff } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { apiClient } from '@/lib/api-client'
import type { SyncConfig } from '@/types/sync'

export function SyncConfigCard() {
  const t = useTranslations('sync.config')
  const [config, setConfig] = useState<SyncConfig | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [intervalMinutes, setIntervalMinutes] = useState<number>(2)
  const [autoSyncOnCreate, setAutoSyncOnCreate] = useState<boolean>(true)
  const [railwayDatabaseUrl, setRailwayDatabaseUrl] = useState<string>('')
  const [conflictBuffer, setConflictBuffer] = useState<number>(5)
  const [showPassword, setShowPassword] = useState(false)

  // Load config on mount. `loadConfig` is a plain function re-created on every
  // render, so listing it as a dep would refetch on every render.
  useEffect(() => {
    loadConfig()
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      toast.error(t('loadFailed'))
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
      toast.error(t('saveFailed'))
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
    <SettingCard title={t('title')} subtitle={t('subtitle')}>
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : config?.is_production ? (
        /* Kein Formular, sondern die eine Auskunft, warum es hier keines gibt — im
           selben Kasten, in dem jede andere Karte «geht hier nicht» sagt. */
        <SettingUnavailableNote>
          <span className="font-medium text-foreground">{t('productionOnlyTitle')}</span>{' '}
          {t('productionOnlyText')}
        </SettingUnavailableNote>
      ) : (
        <>
          <SettingBlock
            label={t('railwayUrlLabel')}
            htmlFor="railway-database-url"
            className="pt-0"
          >
            <div className="relative">
              <Input
                id="railway-database-url"
                type={showPassword ? 'text' : 'password'}
                // A connection string, not a login. `type="password"` is only
                // shoulder-surfing cover, but the browser reads it as one half
                // of a credential pair and fills the other half into whatever
                // text input is nearest — which was the section search box.
                // `new-password` is the same answer /setup already gives.
                autoComplete="new-password"
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
                aria-label={showPassword ? t('hidePassword') : t('showPassword')}
                tabIndex={-1}
              >
                {showPassword ? (
                  <EyeOff className="size-4 text-muted-foreground" />
                ) : (
                  <Eye className="size-4 text-muted-foreground" />
                )}
              </Button>
            </div>
            {isInternalUrl && (
              <p className="mt-1.5 text-xs text-warning-foreground">
                {t.rich('internalUrlWarning', { strong: (chunks) => <strong>{chunks}</strong> })}
              </p>
            )}
          </SettingBlock>

          <SettingRow label={t('intervalLabel')} htmlFor="sync-interval" hint={t('intervalHint')}>
            <div className="flex items-center gap-2">
              <Input
                id="sync-interval"
                type="number"
                min={1}
                max={60}
                value={intervalMinutes}
                onChange={(e) => setIntervalMinutes(parseInt(e.target.value) || 2)}
                className="w-20"
              />
              <span className="text-xs text-muted-foreground">{t('minutesUnit')}</span>
            </div>
          </SettingRow>

          <SettingRow label={t('autoSyncLabel')} htmlFor="auto-sync" hint={t('autoSyncHint')}>
            <Switch
              id="auto-sync"
              checked={autoSyncOnCreate}
              onCheckedChange={setAutoSyncOnCreate}
            />
          </SettingRow>

          <SettingRow
            label={t('conflictBufferLabel')}
            htmlFor="conflict-buffer"
            hint={t('conflictBufferHint')}
          >
            <div className="flex items-center gap-2">
              <Input
                id="conflict-buffer"
                type="number"
                min={0}
                max={30}
                value={conflictBuffer}
                onChange={(e) => setConflictBuffer(parseInt(e.target.value) || 5)}
                className="w-20"
              />
              <span className="text-xs text-muted-foreground">{t('secondsUnit')}</span>
            </div>
          </SettingRow>

          <SettingActions>
            <Button onClick={handleSave} disabled={!hasChanges || isSaving}>
              {isSaving ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t('saving')}
                </>
              ) : (
                t('saveChanges')
              )}
            </Button>
          </SettingActions>
        </>
      )}
    </SettingCard>
  )
}
