'use client'

/**
 * The Feld-Code, where the KP can read it out (plan 26, decisions 22 and 30).
 *
 * Without this the door shipped in the same plan is unusable: `/feld` asks every
 * phone for four digits that would exist only in the database. The code belongs
 * next to the link actions because that is where the poster is produced — it has
 * to be printed *with* the QR, or somebody scans it and is stranded at a prompt
 * they cannot answer.
 *
 * Two actions, and keeping them apart is the whole point:
 *
 * * **Neu generieren** changes what NEW devices unlock with. Nobody in the field
 *   is disturbed — every bound phone keeps working until the Ereignis ends. That
 *   is what makes it cheap enough to actually do when a code gets around.
 * * **Alle Geräte abmelden** revokes every bound token. This is the emergency
 *   brake for a lost phone, and it makes crews standing at a Schadenplatz type
 *   the code again, so it states the device count and asks first.
 *
 * The dialog says outright that a new code does *not* log anyone out, because
 * that confusion is exactly how the brake gets pulled at 02:00 by mistake.
 */

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { KeyRound, Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { apiClient } from '@/lib/api-client'
import type { ApiFeldAccessState } from '@/lib/api/types'

interface FeldAccessCardProps {
  eventId: string
}

export function FeldAccessCard({ eventId }: FeldAccessCardProps) {
  const t = useTranslations('feld.access')
  const [state, setState] = useState<ApiFeldAccessState | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmRegenerate, setConfirmRegenerate] = useState(false)
  const [confirmRevoke, setConfirmRevoke] = useState(false)

  const load = useCallback(async () => {
    try {
      setState(await apiClient.getFeldAccess(eventId))
    } catch (error) {
      console.error('Failed to load feld access state:', error)
    }
  }, [eventId])

  useEffect(() => {
    load()
  }, [load])

  const regenerate = async () => {
    setBusy(true)
    try {
      setState(await apiClient.regenerateFeldCode(eventId))
      toast.success(t('regenerated'))
    } catch (error) {
      console.error('Failed to regenerate feld code:', error)
      toast.error(t('failed'))
    } finally {
      setBusy(false)
      setConfirmRegenerate(false)
    }
  }

  const revoke = async () => {
    setBusy(true)
    try {
      setState(await apiClient.revokeFeldDevices(eventId))
      toast.success(t('revoked'))
    } catch (error) {
      console.error('Failed to revoke feld devices:', error)
      toast.error(t('failed'))
    } finally {
      setBusy(false)
      setConfirmRevoke(false)
    }
  }

  if (!state) return null

  return (
    <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5">
      <div className="flex items-center gap-3">
        <KeyRound className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{t('label')}</div>
          {/* Tabular figures and wide tracking: this gets read out across a
              command post and typed on a phone in the rain. */}
          <div className="font-mono text-2xl font-semibold tracking-[0.3em] tabular-nums">{state.code}</div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {t('devices', { count: state.device_count })}
          </span>
          <Button variant="outline" size="xs" onClick={() => setConfirmRegenerate(true)} disabled={busy}>
            {busy ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
            {t('regenerate')}
          </Button>
          {state.device_count > 0 && (
            <Button variant="outline" size="xs" onClick={() => setConfirmRevoke(true)} disabled={busy}>
              {t('revoke')}
            </Button>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmRegenerate}
        onOpenChange={setConfirmRegenerate}
        title={t('regenerateTitle')}
        description={t('regenerateDescription')}
        confirmText={t('regenerate')}
        onConfirm={regenerate}
      />

      <ConfirmDialog
        open={confirmRevoke}
        onOpenChange={setConfirmRevoke}
        title={t('revokeTitle')}
        description={t('revokeDescription', { count: state.device_count })}
        confirmText={t('revoke')}
        onConfirm={revoke}
        variant="destructive"
      />
    </div>
  )
}
