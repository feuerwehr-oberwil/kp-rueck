'use client'

/**
 * Stationslogo — the mark that heads the printed Einsatzrapport.
 *
 * Deliberately not one of the SETTING_CONFIGS rows above it: the value is an image, so
 * it has its own three endpoints (GET bytes / PUT multipart / DELETE) and its own state
 * to show. The <img> is the source of truth here rather than a settings string — a 404
 * from the logo route is the "no logo set" answer, which is why `onError` and not a
 * separate existence check drives the empty state.
 *
 * It still *renders* as one of them: a `<SettingRow>`, so the preview lands in the same
 * control column as the selects above it instead of in a hand-built row that happened to
 * be a few pixels off. With a logo set the row is wider than `SETTING_CONTROL_COLUMN`'s
 * 256px — that column never goes below its content (`min-w-min`), so the preview plus its
 * two buttons take what they need.
 */

import { useCallback, useRef, useState } from 'react'
import { ImageIcon, Trash2, Upload } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { SettingRow } from '@/components/settings/setting-row'
import { apiClient } from '@/lib/api-client'
import { cn } from '@/lib/utils'

/** Mirrors `services/branding.MAX_UPLOAD_BYTES` — refuse locally rather than upload 20 MB to be told no. */
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024

const ACCEPTED = 'image/png,image/jpeg,image/webp'

interface BrandingSettingsProps {
  /** Viewers see the logo but cannot change it, like every other setting on this page. */
  readOnly?: boolean
}

export function BrandingSettings({ readOnly = false }: BrandingSettingsProps) {
  const t = useTranslations('settings.page.general.logo')
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Bumped after every write so the <img> refetches instead of showing the cached old logo.
  const [version, setVersion] = useState(() => Date.now())
  const [hasLogo, setHasLogo] = useState(true) // optimistic; onError corrects it
  const [busy, setBusy] = useState(false)

  const handleFile = useCallback(async (file: File) => {
    if (file.size > MAX_UPLOAD_BYTES) {
      toast.error(t('tooLarge'))
      return
    }
    setBusy(true)
    try {
      await apiClient.uploadReportLogo(file)
      setVersion(Date.now())
      setHasLogo(true)
      toast.success(t('uploaded'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('uploadFailed'))
    } finally {
      setBusy(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }, [t])

  const handleRemove = useCallback(async () => {
    setBusy(true)
    try {
      await apiClient.deleteReportLogo()
      setHasLogo(false)
      setVersion(Date.now())
      toast.success(t('removed'))
    } catch {
      // api-client already toasted the backend's message.
    } finally {
      setBusy(false)
    }
  }, [t])

  return (
    <SettingRow label={t('label')} hint={t('description')}>
      <div className="flex items-center gap-3">
        {/* A set logo sits on white – it is printed on paper, and most station marks are drawn
            for it. The empty state is an input surface (quiet edge, muted glyph): a white slab
            on a dark page read as the brightest thing in the settings. */}
        <div
          className={cn(
            'flex h-14 w-28 items-center justify-center rounded-md border p-1.5',
            hasLogo ? 'border-border bg-white' : 'border-input bg-transparent dark:bg-input/30',
          )}
        >
          {hasLogo ? (
            /* eslint-disable-next-line @next/next/no-img-element -- backend-served bytes, not a static asset */
            <img
              src={apiClient.getReportLogoUrl(version)}
              alt={t('label')}
              className="max-h-full max-w-full object-contain"
              onError={() => setHasLogo(false)}
            />
          ) : (
            <ImageIcon className="h-5 w-5 text-muted-foreground" aria-hidden />
          )}
        </div>
        {!readOnly && (
          <div className="flex flex-col gap-1.5">
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED}
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void handleFile(file)
              }}
            />
            <Button
              size="xs"
              variant="outline"
              disabled={busy}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-3.5 w-3.5" />
              {hasLogo ? t('replace') : t('upload')}
            </Button>
            {hasLogo && (
              <Button size="xs" variant="ghost" disabled={busy} onClick={() => void handleRemove()}>
                <Trash2 className="h-3.5 w-3.5" />
                {t('remove')}
              </Button>
            )}
          </div>
        )}
      </div>
    </SettingRow>
  )
}
