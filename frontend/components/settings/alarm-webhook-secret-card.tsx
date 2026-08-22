'use client'

/**
 * The shared secret a dispatch provider signs its alarm webhooks with.
 *
 * It existed as two admin-only endpoints that nothing called, which left the only
 * way to read or change it a `psql` session on the production database. It is a
 * value an operator pastes into somebody else's web form, so it needs to be
 * readable and copyable — and rotatable, because a secret you cannot rotate is
 * one you can never un-leak.
 *
 * Hidden by default and, unlike a `type="password"` input, genuinely absent: the
 * value is not fetched until «Anzeigen» is pressed, so it is not in the DOM, not
 * in a screenshot of this page, and not on a screen shared in the command post.
 * The reveal is also a rate-limited, audit-logged call on the backend, which is
 * only true if the UI does not fetch it eagerly. It goes away again just as
 * plainly: «Verbergen» drops it from state, and the card is mounted only while
 * the Alarmierung section is open, so leaving the section – or the page – takes
 * the value with it. Nothing caches it, nothing re-fetches it on its own.
 *
 * `source: 'env'` is shown rather than hidden: the value is still what the
 * operator has to paste, it just cannot be rotated from here, and saying so is
 * cheaper than a support round about a rotation that silently did nothing.
 */

import { useCallback, useEffect, useState } from 'react'
import { Check, Copy, Eye, EyeOff, KeyRound, Loader2, RefreshCw } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { SettingCard } from '@/components/settings/setting-row'
import { apiClient, ApiError, type ApiAlarmWebhookSecret } from '@/lib/api-client'
import { copyToClipboard } from '@/lib/utils'

export function AlarmWebhookSecretCard() {
  const t = useTranslations('settings.page.alerting.webhookSecret')
  const [secret, setSecret] = useState<ApiAlarmWebhookSecret | null>(null)
  const [revealing, setRevealing] = useState(false)
  const [rotateOpen, setRotateOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])

  const reveal = useCallback(async () => {
    setRevealing(true)
    setError(null)
    try {
      // A GET that never reached the backend resolves to `undefined` instead of
      // throwing: the api-client lets reads degrade softly so a polling caller
      // keeps its last known state, and `skipToast` keeps it quiet while it does.
      // Here there is no last known state and no poll — one press, one answer —
      // so "nothing came back" is the failure and has to read as one. Without
      // this the button did nothing at all: no value, no message, no clue.
      const revealed = await apiClient.getAlarmWebhookSecret()
      if (!revealed) {
        setError(t('revealUnreachable'))
        return
      }
      setSecret(revealed)
    } catch (err) {
      // HTTP failures do throw – 403 from a non-admin session, 429 from the rate
      // limit – and their detail is the backend's own wording. Keep it.
      setError(err instanceof Error ? err.message : t('revealFailed'))
    } finally {
      setRevealing(false)
    }
  }, [t])

  const hide = () => {
    setSecret(null)
    setError(null)
  }

  const rotate = async () => {
    setError(null)
    try {
      setSecret(await apiClient.rotateAlarmWebhookSecret())
      toast.success(t('rotated'))
    } catch (err) {
      // The 409 body names the file to edit and the container to restart. That is
      // the whole answer — replacing it with «Rotation fehlgeschlagen» would send
      // the operator looking for a fault that is a deliberate refusal.
      //
      // No `undefined` guard needed here, unlike the reveal above: this is a POST,
      // and the api-client throws `NetworkError` for mutations rather than
      // resolving to nothing, so an unreachable backend lands in this branch and
      // shows the generic wording. A write that was never sent never reads as done.
      setError(err instanceof ApiError ? err.message : t('rotateFailed'))
    }
  }

  const copy = async () => {
    if (!secret?.secret) return
    try {
      await copyToClipboard(secret.secret)
      setCopied(true)
    } catch {
      toast.error(t('copyFailed'))
    }
  }

  const pinnedToEnv = secret?.source === 'env'

  return (
    <SettingCard
      title={
        <span className="flex items-center gap-1.5">
          <KeyRound className="size-3.5 text-muted-foreground" aria-hidden="true" />
          {t('title')}
        </span>
      }
      subtitle={t('description')}
      action={
        secret && (
          <Badge variant="outline">{pinnedToEnv ? t('sourceEnv') : t('sourceDatabase')}</Badge>
        )
      }
    >
      <div className="space-y-4">
        {secret ? (
          <div className="space-y-3">
            {secret.configured ? (
              <div className="flex items-center gap-2">
                <code className="flex-1 min-w-0 truncate rounded-md border bg-muted/50 px-3 py-2 font-mono text-xs">
                  {secret.secret}
                </code>
                <Button variant="outline" size="sm" onClick={copy}>
                  {copied ? <Check className="size-3.5 text-success" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
                  {copied ? t('copied') : t('copy')}
                </Button>
              </div>
            ) : (
              <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning-foreground">
                {t('notConfigured')}
              </p>
            )}

            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={hide}>
                <EyeOff className="size-3.5" aria-hidden="true" />
                {t('hide')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={pinnedToEnv}
                onClick={() => setRotateOpen(true)}
              >
                <RefreshCw className="size-3.5" aria-hidden="true" />
                {t('rotate')}
              </Button>
            </div>

            {pinnedToEnv && <p className="text-xs text-muted-foreground">{t('rotateDisabledHint')}</p>}
          </div>
        ) : (
          <Button variant="outline" size="sm" onClick={reveal} disabled={revealing}>
            {revealing ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Eye className="size-3.5" aria-hidden="true" />}
            {t('reveal')}
          </Button>
        )}

        {error && (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        <ConfirmDialog
          open={rotateOpen}
          onOpenChange={setRotateOpen}
          variant="destructive"
          title={t('rotateConfirmTitle')}
          description={t('rotateConfirmDescription')}
          confirmText={t('rotate')}
          onConfirm={rotate}
        />
      </div>
    </SettingCard>
  )
}
