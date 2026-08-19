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
import { Check, Copy, KeyRound, Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { apiClient } from '@/lib/api-client'
import { copyToClipboard } from '@/lib/utils'
import type { ApiFeldAccessState } from '@/lib/api/types'

interface FeldAccessCardProps {
  eventId: string
  /** Drop the card's own border/background so it can sit as a row inside a
   *  grouped container (the Links & QR sheet's Feld group). */
  bare?: boolean
}

export function FeldAccessCard({ eventId, bare = false }: FeldAccessCardProps) {
  const t = useTranslations('feld.access')
  const [state, setState] = useState<ApiFeldAccessState | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
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

  // A skeleton of the SAME height rather than nothing: returning null until the
  // fetch lands made the card pop in and shove the link rows down a line, which
  // on a footer sheet means the row under the cursor moves as you reach for it.
  if (!state) {
    return (
      <div className={bare ? 'px-3 py-2.5' : 'rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5'} aria-hidden>
        <div className="h-4 w-24 rounded bg-muted" />
        <div className="mt-1 h-8 w-32 rounded bg-muted/70" />
      </div>
    )
  }

  return (
    <div className={bare ? 'px-3 py-2.5' : 'rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5'}>
      {/* The code leads and gets the room. It is the one thing on this card
          somebody reads off a screen and types on a phone; the two maintenance
          buttons are rare and sit out of its way rather than beside it. */}
      <div className="flex items-baseline gap-2">
        <KeyRound className="size-3.5 shrink-0 translate-y-0.5 text-muted-foreground" />
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{t('label')}</span>
        <span className="ml-auto text-xs text-muted-foreground">
          {t('devices', { count: state.device_count })}
        </span>
      </div>
      <div className="mt-1 flex items-end justify-between gap-3">
        {/* Tabular figures and wide tracking: read out across a command post,
            typed on a phone in the rain. Clicking the code copies it — for the
            recurring case of pasting it into a chat next to the link. */}
        <button
          type="button"
          onClick={async () => {
            try {
              await copyToClipboard(state.code)
              setCopied(true)
              toast.success(t('codeCopied'))
              setTimeout(() => setCopied(false), 2000)
            } catch {
              toast.error(t('failed'))
            }
          }}
          title={t('copyCode')}
          className="group flex items-center gap-2 rounded-md text-left"
        >
          <span className="font-mono text-3xl font-semibold leading-none tracking-[0.28em] tabular-nums">
            {state.code}
          </span>
          {copied ? (
            <Check className="size-3.5 shrink-0 text-success" />
          ) : (
            <Copy className="size-3.5 shrink-0 text-muted-foreground opacity-60 transition-opacity group-hover:opacity-100" />
          )}
        </button>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button variant="ghost" size="xs" onClick={() => setConfirmRegenerate(true)} disabled={busy}>
            {busy ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
            {t('regenerate')}
          </Button>
          {state.device_count > 0 && (
            <Button variant="ghost" size="xs" onClick={() => setConfirmRevoke(true)} disabled={busy}>
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
