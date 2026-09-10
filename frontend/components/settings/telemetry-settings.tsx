'use client'

/**
 * Fehlerberichte: the report composer, and — for an admin — the consent switch plus the
 * receipts.
 *
 * Two things happen on this page, and only one of them ever transmits:
 *
 *   • **Problem melden** is available to anyone logged in, and the app is not the transport.
 *     The operator writes, picks a route, and the card fills in a GitHub issue or a mail and
 *     saves the Diagnose-Datei to attach. There used to be a **Senden** button that POSTed to
 *     the maintainer's ingest; it went when the ingest did (PRIVACY.md § «Where it goes»),
 *     because a report queued for a destination that does not exist would sit in the outbox
 *     forever while this card claimed «gesendet».
 *   • **Automatische Fehlerberichte** is admin-only and off until someone says otherwise.
 *     Nobody is looking at the payload when that one fires, so it needs a decision made by the
 *     organisation rather than by whoever happens to be logged in.
 *
 * A toggle on its own is not a privacy feature — anyone can draw a toggle. What makes this
 * defensible is the list at the bottom: the exact payloads this instance has queued or sent,
 * verbatim, straight out of the outbox table.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { ArrowRight, Github, Info, Mail, RefreshCw, ShieldCheck } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { SettingBlock, SettingCard } from '@/components/settings/setting-row'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { getApiUrl } from '@/lib/env'
import {
  fetchDiagnostics,
  saveDiagnostics,
  type DiagnosticsBundle,
} from '@/lib/feedback-diagnostics'
import {
  buildReport,
  feedbackConfig,
  githubIssueUrl,
  mailtoUrl,
  type FeedbackRoute,
} from '@/lib/feedback-report'

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

/** Ceiling on the description. No longer a server limit — nothing is posted any more — but a
 *  URL one: the text is prefilled into a GitHub form or a `mailto:` body, and a query string
 *  past a few kB is truncated by browsers and mail clients, some of them silently. The issue
 *  link additionally caps its own prefill (lib/feedback-report · MAX_PREFILL); the rest of a
 *  long description survives in the textarea and in the mail body. */
const MAX_MESSAGE = 4000

/** Mail subject prefix, so a report is recognisable in an inbox before it is opened. */
const APP_NAME = 'KP Rück'

interface ReportEnv {
  build: string
  locale: string
  userAgent: string
  viewport: string
  online: boolean
}

/** Snapshot of everything the report carries besides the operator's own words.
 *
 *  Read once on mount rather than when the route is opened, so the block shown above the
 *  routes cannot drift from the text that actually leaves — a preview is only worth something
 *  if it is the same string. In an effect rather than during render because this component is
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

/** One of the two exits, as a radio in everything but markup: `aria-pressed` rather than a
 *  `<input type="radio">` because the whole tile is the target and a label wrapping this much
 *  text reads badly to a screen reader. Both options are styled alike — neither is the quiet
 *  «alternative», because neither is a fallback for the other any more. */
function RouteOption({
  icon,
  title,
  badge,
  note,
  picked,
  onPick,
}: {
  icon: ReactNode
  title: string
  badge: string
  note: string
  picked: boolean
  onPick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={picked}
      onClick={onPick}
      className={cn(
        'flex w-full items-start gap-3 rounded-md border p-3 text-left transition-colors',
        picked ? 'border-primary bg-primary/5' : 'hover:bg-muted/50',
      )}
    >
      <span className="mt-0.5 text-muted-foreground">{icon}</span>
      <span className="min-w-0 space-y-1">
        <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
          {title}
          <Badge variant={picked ? 'default' : 'secondary'} className="font-normal">
            {badge}
          </Badge>
        </span>
        <span className="block text-xs leading-snug text-muted-foreground">{note}</span>
      </span>
    </button>
  )
}

export function TelemetrySettings({ isAdmin }: { isAdmin: boolean }) {
  const t = useTranslations('settings.page.telemetry')

  const [status, setStatus] = useState<TelemetryStatus | null>(null)
  const [statusFailed, setStatusFailed] = useState(false)
  const [busy, setBusy] = useState(false)

  const [message, setMessage] = useState('')
  const [route, setRoute] = useState<FeedbackRoute>('github')
  const [bundle, setBundle] = useState<DiagnosticsBundle | null>(null)
  const [env, setEnv] = useState<ReportEnv | null>(null)

  useEffect(() => { setEnv(readEnv()) }, [])

  // Fetched on mount, not on «Weiter»: the count belongs in front of the decision, and a card
  // that only discovers at the last moment that it has nothing to attach has already told the
  // operator otherwise. A failure here is silent and simply leaves `bundle` null — the routes
  // still work, and a report without traces beats no report.
  useEffect(() => {
    let live = true
    fetchDiagnostics().then((b) => { if (live) setBundle(b) }).catch(() => { /* no file, no note */ })
    return () => { live = false }
  }, [])

  const errorCount = bundle?.errors.length ?? 0
  const countLabel = errorCount === 1 ? t('diagCountOne') : t('diagCount', { n: errorCount })

  // The block the operator reads before deciding, assembled from the snapshot above. The
  // Diagnose-Datei is named in it because it travels with the report, so the block is the
  // whole truth about what the maintainer receives.
  const techBlock = env
    ? [
        `${t('techVersion')} ${env.build}`,
        `${t('techLocale')} ${env.locale}`,
        `${t('techDevice')} ${env.userAgent}`,
        `${t('techViewport')} ${env.viewport}`,
        `${t('techNetwork')} ${env.online ? t('techOnline') : t('techOffline')}`,
        ...(errorCount > 0 ? [`${t('diagLine')} ${countLabel}`] : []),
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

  /** Save the file, then open the route. In that order, and both in the same user gesture: a
   *  download started after a `location.href` to a `mailto:` has a good chance of never
   *  happening at all. */
  const go = () => {
    const draft = { message, tech: techBlock, version: env?.build ?? 'unknown' }
    if (bundle && errorCount > 0) {
      try {
        toast.success(t('diagSaved', { name: saveDiagnostics(bundle) }))
      } catch {
        // The report is still worth sending without it — say so and carry on rather than
        // stopping the operator at the last step over the attachment.
        toast.error(t('diagFailed'))
      }
    }
    if (route === 'github' && feedbackConfig.github) {
      window.open(githubIssueUrl(feedbackConfig.github, draft), '_blank', 'noopener')
    } else {
      location.href = mailtoUrl(
        feedbackConfig.mailto,
        `${APP_NAME}: ${t('subject')}`,
        buildReport(draft, t('noDescription')),
      )
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
      {/* ── Manual report: available to everyone, and the app is not the transport ── */}
      <SettingCard title={t('reportTitle')} subtitle={t('reportIntro')}>
        <div className="space-y-3">
          {/* A textarea does not fit a 200px control column, so this is a `SettingBlock` —
              label over full-width field — and the counter takes the block's action slot
              instead of hanging under the field. */}
          <SettingBlock
            label={t('reportLabel')}
            htmlFor="telemetry-message"
            className="pt-0"
            action={
              /* Only in the last tenth before the cap, digits only — no copy key, correct in
                 every locale. Without it the ceiling is invisible until the text is cut. */
              message.length > MAX_MESSAGE * 0.9 ? (
                <span className="text-xs tabular-nums text-muted-foreground">
                  {message.length}/{MAX_MESSAGE}
                </span>
              ) : null
            }
          >
            <Textarea
              id="telemetry-message"
              rows={4}
              value={message}
              maxLength={MAX_MESSAGE}
              placeholder={t('reportPlaceholder')}
              onChange={(e) => setMessage(e.target.value)}
            />
          </SettingBlock>

          {/* Collapsed, unlike before: the block used to sit open because it was the only
              thing standing between the operator and an automatic transmission. Nothing
              transmits now — they are about to read the whole report in their own mail client
              or in a GitHub form — so the block is one click away and the routes get the
              space. */}
          <details className="rounded-md border bg-muted/40 p-3">
            <summary className="cursor-pointer text-sm font-medium">{t('techTitle')}</summary>
            <pre className="mt-2 max-h-72 overflow-auto text-xs whitespace-pre-wrap break-all">{techBlock}</pre>
            <p className="mt-2 text-xs text-muted-foreground">{t('reportWhat')}</p>
          </details>

          {/* Two routes, neither of them the app: GitHub first because it is the one that can
              demand structure — required fields, a version, a status the reporter can follow —
              and mail second because it is the one that always works. */}
          <div className="grid gap-2 sm:grid-cols-2">
            {feedbackConfig.github && (
              <RouteOption
                icon={<Github className="size-4" />}
                title={t('routeGithub')}
                badge={t('routeGithubBadge')}
                note={t('routeGithubNote')}
                picked={route === 'github'}
                onPick={() => setRoute('github')}
              />
            )}
            <RouteOption
              icon={<Mail className="size-4" />}
              title={t('routeMail')}
              badge={t('routeMailBadge')}
              note={t('routeMailNote')}
              picked={route === 'mail'}
              onPick={() => setRoute('mail')}
            />
          </div>

          <p className="text-sm text-muted-foreground">
            {errorCount > 0 ? t('diagNote', { n: countLabel }) : t('diagNoteEmpty')}
          </p>
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            {t('privacy')}
          </p>

          <Button onClick={go} disabled={message.trim().length === 0 || !env}>
            {t('next')}
            <ArrowRight className="size-4" />
          </Button>
        </div>
      </SettingCard>

      {/* ── Background channel + receipts: admin only ────────────────────────────── */}
      {isAdmin && (
        <SettingCard
          title={t('backgroundTitle')}
          subtitle={t('backgroundCaption')}
          action={
            status && (
              <Badge variant={locked ? 'outline' : on ? 'default' : 'secondary'} className="shrink-0">
                {locked ? t('lockedState') : on ? t('onState') : t('offState')}
              </Badge>
            )
          }
        >
          <div className="space-y-3">
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

                {/* The receipts. Verbatim, newest first — the outbox table, not a summary.
                    Separated by whitespace and its heading, not a hairline. */}
                <div className="pt-3">
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
          </div>
        </SettingCard>
      )}
    </div>
  )
}
