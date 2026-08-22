'use client'

/**
 * «Dieses Gerät» – alles, was im Browser liegt und nur auf diesem Bildschirm gilt.
 *
 * Bis hierher waren diese vier Zeilen über die Seite verstreut: Erscheinungsbild und
 * Sprache in «Allgemein», zwischen Werten für die ganze Station, und der Lageblatt-
 * Download in «Ausfallsicherheit». Weil man einer Zeile nicht ansieht, wie weit sie
 * reicht, trug jede eine kleine Marke, und zuoberst stand eine Legende, die sie erklärte.
 *
 * Ein eigener Abschnitt sagt dasselbe, ohne dass es irgendwo dabeistehen muss: was hier
 * drin ist, gilt hier – was draussen ist, gilt für die ganze Station. Marke und Legende
 * sind damit weg.
 *
 * Der Prüfstein für neue Zeilen: **liegt der Wert in der `settings`-Tabelle?** Dann
 * gehört er nicht hierher, egal wie persönlich er sich anfühlt.
 */

import { useEffect, useState } from 'react'
import { useTheme } from 'next-themes'
import { useTranslations } from 'next-intl'
import { Monitor, Moon, MonitorDown, Sun } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SettingCard, SettingRow } from '@/components/settings/setting-row'
import {
  AVAILABLE_LOCALES,
  LOCALE_NAMES,
  getActiveLocale,
  setActiveLocale,
  type SupportedLocale,
} from '@/lib/i18n-messages'
import {
  LAGEBLATT_AUTODOWNLOAD_EVENT,
  LAGEBLATT_AUTODOWNLOAD_INTERVAL_KEY,
  LAGEBLATT_AUTODOWNLOAD_KEY,
  readLageblattInterval,
} from '@/lib/lageblatt'
import { toast } from 'sonner'

export function DeviceSettings() {
  const t = useTranslations('settings')
  const { theme, setTheme } = useTheme()

  // Theme und Sprache leben beide ausserhalb von React (next-themes bzw. das
  // NEXT_LOCALE-Cookie), der Server kennt beide nicht – darum erst nach dem Mounten
  // rendern, sonst widerspricht der Client dem Server-HTML.
  const [mounted, setMounted] = useState(false)
  const [autoDownload, setAutoDownload] = useState(false)
  const [downloadInterval, setDownloadInterval] = useState('15')

  useEffect(() => {
    setMounted(true)
    setAutoDownload(localStorage.getItem(LAGEBLATT_AUTODOWNLOAD_KEY) === 'true')
    setDownloadInterval(String(readLageblattInterval()))
  }, [])

  const handleAutoDownloadToggle = (on: boolean) => {
    setAutoDownload(on)
    localStorage.setItem(LAGEBLATT_AUTODOWNLOAD_KEY, on ? 'true' : 'false')
    window.dispatchEvent(new Event(LAGEBLATT_AUTODOWNLOAD_EVENT))
    if (on) {
      // No immediate download — the first one runs at the next interval tick so
      // enabling this never triggers a surprise download.
      toast.success(t('fallback.autoDownloadActive'), {
        description: t('fallback.autoDownloadActiveDescription', { minutes: readLageblattInterval() }),
      })
    }
  }

  const handleDownloadIntervalBlur = (raw: string) => {
    const clamped = String(Math.max(5, Math.min(120, parseInt(raw) || 15)))
    setDownloadInterval(clamped)
    localStorage.setItem(LAGEBLATT_AUTODOWNLOAD_INTERVAL_KEY, clamped)
    window.dispatchEvent(new Event(LAGEBLATT_AUTODOWNLOAD_EVENT))
  }

  return (
    <SettingCard title={t('device.title')} subtitle={t('device.subtitle')}>
      <SettingRow
        label={t('page.general.appearance')}
        hint={t('page.general.appearanceHint')}
      >
        {mounted && (
          <div className="flex gap-1.5">
            {([
              { value: 'light', icon: Sun, label: t('page.general.themeLight') },
              { value: 'dark', icon: Moon, label: t('page.general.themeDark') },
              { value: 'system', icon: Monitor, label: t('page.general.themeSystem') },
            ] as const).map(({ value, icon: Icon, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => setTheme(value)}
                className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-all ${
                  theme === value ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
                }`}
                title={label}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>
        )}
      </SettingRow>

      {/* The language row only exists once a second locale has real translations;
          while fr/it are empty stubs, German-only stations never see it. */}
      {mounted && AVAILABLE_LOCALES.length > 1 && (
        <SettingRow label={t('page.general.language')} hint={t('page.general.languageHint')}>
          <Select
            value={getActiveLocale()}
            onValueChange={(value) => {
              setActiveLocale(value as SupportedLocale)
              // Full reload: server components and out-of-React translators
              // (toasts, api-client errors) read the cookie at load time.
              window.location.reload()
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AVAILABLE_LOCALES.map((locale) => (
                <SelectItem key={locale} value={locale}>{LOCALE_NAMES[locale]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>
      )}

      <SettingRow
        label={t('fallback.autoDownloadLabel')}
        htmlFor="device-auto-download"
        hint={t('fallback.autoDownloadHint')}
        icon={<MonitorDown className="size-3.5 text-muted-foreground" />}
      >
        <Switch
          id="device-auto-download"
          checked={autoDownload}
          onCheckedChange={handleAutoDownloadToggle}
        />
      </SettingRow>

      {autoDownload && (
        <SettingRow
          label={t('fallback.autoDownloadIntervalLabel')}
          htmlFor="device-download-interval"
          hint={t('fallback.autoDownloadIntervalHint')}
        >
          <Input
            id="device-download-interval"
            type="number"
            className="w-24"
            min={5}
            max={120}
            value={downloadInterval}
            onChange={(e) => setDownloadInterval(e.target.value)}
            onBlur={(e) => handleDownloadIntervalBlur(e.target.value)}
          />
        </SettingRow>
      )}
    </SettingCard>
  )
}
