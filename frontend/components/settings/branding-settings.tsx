'use client'

/**
 * Stationslogo — the mark that heads the printed Einsatzbericht.
 *
 * Deliberately not one of the SETTING_CONFIGS rows above it: the value is an image, so
 * it has its own three endpoints (GET bytes / PUT multipart / DELETE) and its own state
 * to show. The <img> is the source of truth here rather than a settings string — a 404
 * from the logo route is the "no logo set" answer, which is why `onError` and not a
 * separate existence check drives the empty state.
 */

import { useCallback, useRef, useState } from 'react'
import { ImageIcon, Trash2, Upload } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { apiClient } from '@/lib/api-client'

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
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <Label className="text-sm font-semibold text-muted-foreground">{t('label')}</Label>
        <p className="text-xs text-muted-foreground">{t('description')}</p>
      </div>
      <div className="flex items-center gap-3 flex-shrink-0">
        <div className="flex h-14 w-28 items-center justify-center rounded-md border border-border bg-white p-1.5">
          {hasLogo ? (
            /* eslint-disable-next-line @next/next/no-img-element -- backend-served bytes, not a static asset */
            <img
              src={apiClient.getReportLogoUrl(version)}
              alt={t('label')}
              className="max-h-full max-w-full object-contain"
              onError={() => setHasLogo(false)}
            />
          ) : (
            <ImageIcon className="h-5 w-5 text-muted-foreground/50" aria-hidden />
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
    </div>
  )
}
