'use client'

/**
 * Fehlerberichte: the manual report form, and — for an admin — the consent switch plus the
 * receipts.
 *
 * Two channels with deliberately different gates, because they are not the same act:
 *
 *   • **Problem melden** is available to anyone logged in. The operator reads the payload and
 *     presses send; that press IS the consent, the same way pressing send in a mail client is.
 *   • **Automatische Fehlerberichte** is admin-only and off until someone says otherwise.
 *     Nobody is looking at the payload when that one fires, so it needs a decision made by the
 *     organisation rather than by whoever happens to be logged in.
 *
 * A toggle on its own is not a privacy feature — anyone can draw a toggle. What makes this
 * defensible is the list at the bottom: the exact payloads this instance has queued or sent,
 * verbatim, straight out of the outbox table.
 */

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Check, Copy, RefreshCw, Send, ShieldCheck } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { getApiUrl } from '@/lib/env'

interface OutboxRow {
  id: string
  channel: 'error' | 'report'
  createdAt: string | null
  sentAt: string | null
  attempts: number
  lastError: string | null
  payload: unknown
}

interface TelemetryStatus {
  consent: 'off' | 'errors'
  /** false = nobody has ever answered. Not the same state as a deliberate "off". */
  decided: boolean
  installId: string | null
  outboundAllowed: boolean
  ingestConfigured: boolean
  pending: number
  recent: OutboxRow[]
}

/** The server's cap on `message` (backend/app/api/diag.py · ProblemReport).
 *
 *  Mirrored in the textarea: past the cap the POST 422s, and a 422 lands in the generic failure
 *  branch, which tells the operator they are «vermutlich offline» — a wrong diagnosis handed to
 *  the one reporter engaged enough to write four thousand characters. */
const MAX_MESSAGE = 4000

interface ReportEnv {
  build: string
  locale: string
  userAgent: string
  viewport: string
  online: boolean
}

/** Snapshot of everything the report carries besides the operator's own words.
 *
 *  Read once on mount rather than at send time, so the block shown above the button cannot
 *  drift from the payload that actually leaves — a preview is only worth something if it is
 *  the same object. In an effect rather than during render because this component is
 *  server-rendered first, where `navigator` and `window` do not exist. */
function readEnv(): ReportEnv {
  return {
    build: process.env.NEXT_PUBLIC_APP_VERSION ?? 'unknown',
    locale: navigator.language,
    userAgent: navigator.userAgent,
    viewport: `${window.innerWidth}×${window.innerHeight}`,
    online: navigator.onLine,
  }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${getApiUrl()}${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })
  if (!res.ok) throw new Error(String(res.status))
  return res.json() as Promise<T>
}

export function TelemetrySettings({ isAdmin }: { isAdmin: boolean }) {
  const t = useTranslations('settings.page.telemetry')

  const [status, setStatus] = useState<TelemetryStatus | null>(null)
  const [statusFailed, setStatusFailed] = useState(false)
  const [busy, setBusy] = useState(false)

  const [message, setMessage] = useState('')
  const [sendState, setSendState] = useState<'idle' | 'sending' | 'sent' | 'disabled' | 'failed'>('idle')
  const [echoed, setEchoed] = useState<string | null>(null)
  const [env, setEnv] = useState<ReportEnv | null>(null)

  useEffect(() => { setEnv(readEnv()) }, [])

  // The block the operator reads before deciding, assembled from the snapshot above.
  const techBlock = env
    ? [
        `${t('techVersion')} ${env.build}`,
        `${t('techLocale')} ${env.locale}`,
        `${t('techDevice')} ${env.userAgent}`,
        `${t('techViewport')} ${env.viewport}`,
        `${t('techNetwork')} ${env.online ? t('techOnline') : t('techOffline')}`,
      ].join('\n')
    : ''

  const loadStatus = useCallback(async () => {
    if (!isAdmin) return
    try {
      setStatus(await api<TelemetryStatus>('/api/diag/telemetry'))
      setStatusFailed(false)
    } catch {
      setStatusFailed(true)
    }
  }, [isAdmin])

  useEffect(() => {
    void loadStatus()
  }, [loadStatus])

  /** The clipboard route: needs no server at all, which is the whole point of offering it when
   *  the direct one has just failed or the deployer has switched outbound off. */
  const copyReport = async () => {
    try {
      await navigator.clipboard.writeText(`${message.trim() || '—'}\n\n--\n${techBlock}\n`)
      toast.success(t('copied'))
    } catch {
      toast.error(t('copyFailed'))
    }
  }

  const send = async () => {
    if (!env) return
    setSendState('sending')
    try {
      const res = await fetch(`${getApiUrl()}/api/diag/report`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        // Exactly the snapshot rendered above — the preview and the payload are one object.
        body: JSON.stringify({
          message,
          build: env.build,
          locale: env.locale,
          viewport: env.viewport,
          online: env.online,
        }),
      })
      // 503 is the deployer having switched outbound off — a configuration, not a fault.
      if (res.status === 503) {
        setSendState('disabled')
        return
      }
      if (!res.ok) {
        setSendState('failed')
        return
      }
      const body = (await res.json()) as { sent: unknown }
      setEchoed(JSON.stringify(body.sent, null, 2))
      setSendState('sent')
      setMessage('')
      void loadStatus()
    } catch {
      setSendState('failed')
    }
  }

  const setConsent = async (consent: 'off' | 'errors') => {
    setBusy(true)
    try {
      await api('/api/diag/telemetry/consent', {
        method: 'PUT',
        body: JSON.stringify({ consent }),
      })
      await loadStatus()
    } catch {
      setStatusFailed(true)
    } finally {
      setBusy(false)
    }
  }

  const rotateId = async () => {
    setBusy(true)
    try {
      await api('/api/diag/telemetry/install-id', { method: 'POST', body: '{}' })
      await loadStatus()
    } catch {
      setStatusFailed(true)
    } finally {
      setBusy(false)
    }
  }

  const on = status?.consent === 'errors'
  // The env kill switch outranks this screen. Saying so plainly beats showing a switch that
  // silently does nothing.
  const locked = status ? !status.outboundAllowed : false

  return (
    <div className="space-y-4">
      {/* ── Manual report: available to everyone, no switch involved ─────────────── */}
      <Card className="p-4 space-y-3">
        <div>
          <h3 className="font-semibold">{t('reportTitle')}</h3>
          <p className="text-sm text-muted-foreground">{t('reportIntro')}</p>
        </div>

        {sendState === 'sent' ? (
          <div className="space-y-2">
            <p className="flex items-center gap-2 text-sm font-medium">
              <Check className="h-4 w-4 text-success" />
              {t('sentTitle')}
            </p>
            <p className="text-sm text-muted-foreground">{t('sentBody')}</p>
            {/* Collapsed, unlike the block before the send: this screen answers «ist es
                angekommen», and opening with a wall of JSON buries that answer under something
                the operator has already had their chance to read. */}
            <details className="rounded-md border bg-muted/40 p-3">
              <summary className="cursor-pointer text-sm font-medium">{t('sentWhat')}</summary>
              <pre className="mt-2 max-h-72 overflow-auto whitespace-pre text-xs">{echoed}</pre>
              <p className="mt-2 text-xs text-muted-foreground">{t('sentEcho')}</p>
            </details>
            <Button variant="outline" size="sm" onClick={() => setSendState('idle')}>
              {t('reportAgain')}
            </Button>
          </div>
        ) : (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="telemetry-message" className="text-sm font-semibold text-muted-foreground">{t('reportLabel')}</Label>
              <Textarea
                id="telemetry-message"
                rows={4}
                value={message}
                maxLength={MAX_MESSAGE}
                placeholder={t('reportPlaceholder')}
                onChange={(e) => setMessage(e.target.value)}
              />
              {/* Only in the last tenth before the cap, digits only — no copy key, correct in
                  every locale. Without it the ceiling is invisible until the server rejects. */}
              {message.length > MAX_MESSAGE * 0.9 && (
                <p className="text-right text-xs tabular-nums text-muted-foreground">
                  {message.length}/{MAX_MESSAGE}
                </p>
              )}
            </div>
            {/* The payload, verbatim and open, not a sentence describing it. «Das wird
                mitgeschickt» is a claim until it can be read at the moment the decision is
                made — and reading it is the consent this channel runs on. */}
            <details className="rounded-md border bg-muted/40 p-3" open>
              <summary className="cursor-pointer text-sm font-medium">{t('techTitle')}</summary>
              <pre className="mt-2 max-h-72 overflow-auto text-xs whitespace-pre-wrap break-all">{techBlock}</pre>
              <p className="mt-2 text-xs text-muted-foreground">{t('reportWhat')}</p>
            </details>
            {(sendState === 'failed' || sendState === 'disabled') && (
              <p className="flex items-start gap-2 text-sm text-warning-foreground" role="status">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                {sendState === 'disabled' ? t('sendDisabled') : t('sendFailed')}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                onClick={() => void send()}
                disabled={sendState === 'sending' || message.trim().length === 0 || !env}
              >
                <Send className="size-4" />
                {sendState === 'sending' ? t('sending') : t('send')}
              </Button>
              {/* Quieter, and never disabled: when the direct route has just failed or the
                  deployer has switched outbound off, this is the only way out — and a form
                  that can fail with no alternative is a dead end, not a form. */}
              <Button variant="ghost" size="sm" className="gap-2" onClick={() => void copyReport()}>
                <Copy className="size-3.5" />
                {t('copy')}
              </Button>
            </div>
          </>
        )}
      </Card>

      {/* ── Background channel + receipts: admin only ────────────────────────────── */}
      {isAdmin && (
        <Card className="p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold">{t('backgroundTitle')}</h3>
              <p className="text-sm text-muted-foreground">{t('backgroundCaption')}</p>
            </div>
            {status && (
              <Badge variant={locked ? 'outline' : on ? 'default' : 'secondary'} className="shrink-0">
                {locked ? t('lockedState') : on ? t('onState') : t('offState')}
              </Badge>
            )}
          </div>

          {statusFailed && <p className="text-sm text-destructive">{t('loadError')}</p>}
          {!status && !statusFailed && <p className="text-sm text-muted-foreground">{t('loading')}</p>}

          {status && (
            <>
              <p className="text-sm text-muted-foreground">{locked ? t('lockedNote') : t('explain')}</p>

              {!locked && (
                /* Never asked: put the question itself on screen with neither answer
                   preselected and neither styled as the obvious one. A pre-ticked box is not
                   consent, and a grey "no" beside a bright "yes" is a pre-ticked box with
                   extra steps. */
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant={status.decided && !on ? 'default' : 'outline'}
                    size="sm"
                    disabled={busy || (status.decided && !on)}
                    onClick={() => void setConsent('off')}
                  >
                    {status.decided ? t('turnOff') : t('askNo')}
                  </Button>
                  <Button
                    variant={status.decided && on ? 'default' : 'outline'}
                    size="sm"
                    disabled={busy || on}
                    onClick={() => void setConsent('errors')}
                  >
                    {status.decided ? t('turnOn') : t('askYes')}
                  </Button>
                </div>
              )}

              {status.installId ? (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <span className="text-sm text-muted-foreground">{t('installId')}</span>
                  <code className="rounded bg-muted px-2 py-1 text-xs">{status.installId}</code>
                  <Button variant="ghost" size="sm" disabled={busy} onClick={() => void rotateId()}>
                    <RefreshCw className="size-3.5" />
                    {t('rotate')}
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{t('noInstallId')}</p>
              )}

              {/* The receipts. Verbatim, newest first — the outbox table, not a summary. */}
              <div className="border-t pt-3">
                <h4 className="mb-2 flex items-center gap-1.5 text-sm font-medium">
                  <ShieldCheck className="h-4 w-4" />
                  {t('sentLogTitle')}
                </h4>
                {status.recent.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t('nothingSent')}</p>
                ) : (
                  <div className="space-y-1">
                    {status.recent.map((row) => (
                      <details key={row.id} className="border-b last:border-0">
                        <summary className="flex cursor-pointer flex-wrap items-baseline gap-2 py-2 text-sm">
                          <span className="font-medium">
                            {row.channel === 'report' ? t('chReport') : t('chError')}
                          </span>
                          <span className="text-muted-foreground tabular-nums">
                            {row.createdAt?.slice(0, 16).replace('T', ' ')}
                          </span>
                          <span className={`ml-auto text-xs ${row.sentAt ? 'text-success' : 'text-muted-foreground'}`}>
                            {row.sentAt ? t('stSent') : row.lastError ? `${t('stPending')} (${row.lastError})` : t('stPending')}
                          </span>
                        </summary>
                        <pre className="mb-2 max-h-72 overflow-auto rounded bg-muted/40 p-3 text-xs whitespace-pre">
                          {JSON.stringify(row.payload, null, 2)}
                        </pre>
                      </details>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </Card>
      )}
    </div>
  )
}
