'use client'

/**
 * Personenstamm-Snapshot – was der letzte Abruf der veröffentlichten Personaldatei getan hat
 * (`GET /api/integrations/roster-snapshot`, Backend `services/roster_snapshot_sync.py`).
 *
 * Bewusst ohne Bedienelemente, wie die Integrationen-Karte darüber: die Quelle steht in der
 * Server-Konfiguration (`ROSTER_SNAPSHOT_SOURCE`), und ein Abruf, den die Deaktivierungs-
 * Grenze angehalten hat, wird von einer Administratorin auf dem Server freigegeben – der
 * Befehl steht in der Warnung selbst. Ohne eingerichtete Quelle rendert die Komponente nichts.
 */

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { apiClient } from '@/lib/api-client'
import type { ApiRosterSnapshot } from '@/lib/api/types'
import { useIntlLocale } from '@/lib/date-locale'

/** So viele nicht zugeordnete Namen nennt die Karte, bevor sie «…» schreibt. */
const NAMES_SHOWN = 5

export function RosterSnapshotStatus() {
  const t = useTranslations('settings.integrations.rosterSnapshot')
  const locale = useIntlLocale()
  const [data, setData] = useState<ApiRosterSnapshot | null>(null)

  useEffect(() => {
    let cancelled = false
    apiClient
      .getRosterSnapshot()
      .then((result) => {
        if (!cancelled) setData(result)
      })
      .catch(() => {
        // An older backend has no such route: say nothing rather than an error about a
        // feature this station does not use.
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (!data?.configured) return null
  const status = data.status
  const outcome = status?.outcome ?? null
  const refused = outcome?.refused ?? null
  const unmatched = (outcome?.unmatched ?? []).filter((u) => u.reason !== 'inactive_in_snapshot')
  const unknownRanks = outcome?.unknown_ranks ?? []
  // Kinds the station index lists that this version does not read yet (vehicles, groups, …).
  const notRead = (status?.index?.files ?? []).filter((f) => !f.known).map((f) => f.kind)
  const when = (iso: string) =>
    new Date(iso).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' })

  const tone = status?.held
    ? 'border-warning/40 bg-warning/10 text-warning-foreground'
    : status?.lastError
      ? 'border-destructive/40 bg-destructive/10 text-destructive'
      : 'bg-muted/30 text-muted-foreground'

  return (
    <div className={`rounded-md border px-3 py-2 text-xs leading-relaxed ${tone}`} data-testid="roster-snapshot-status">
      <b className="font-semibold text-foreground">{t('title')}</b>{' '}
      {!status ? (
        t('neverRan')
      ) : status.held ? (
        t('held', {
          n: status.pendingDeactivations ?? 0,
          total: status.activeBefore ?? 0,
          limit: status.deactivationLimit ?? 0,
        })
      ) : refused ? (
        <>
          {t('failed')} <span className="font-mono">{status.lastError ?? refused}</span>
        </>
      ) : status.unchanged ? (
        t('unchanged')
      ) : (
        t('summary', {
          created: outcome?.created ?? 0,
          updated: outcome?.updated ?? 0,
          deactivated: outcome?.deactivated ?? 0,
        })
      )}
      {status?.held && unmatched.length > 0 && (
        <>
          <br />
          {t('heldWho', {
            names:
              unmatched
                .slice(0, NAMES_SHOWN)
                .map((u) => u.display_name)
                .join(', ') + (unmatched.length > NAMES_SHOWN ? ' …' : ''),
          })}
        </>
      )}
      {status?.held && (
        <>
          <br />
          {t('release')} <span className="font-mono break-words">{t('releaseCommand')}</span>
        </>
      )}
      {!status?.held && unmatched.length > 0 && (
        <>
          <br />
          {t('unmatched', {
            n: unmatched.length,
            names:
              unmatched
                .slice(0, NAMES_SHOWN)
                .map((u) => u.display_name)
                .join(', ') + (unmatched.length > NAMES_SHOWN ? ' …' : ''),
          })}
        </>
      )}
      {(status?.postponed?.length ?? 0) > 0 && (
        <>
          <br />
          {t('postponed', { names: (status?.postponed ?? []).map((p) => p.display_name).join(', ') })}
        </>
      )}
      {unknownRanks.length > 0 && (
        <>
          <br />
          {t('unknownRanks', { ranks: unknownRanks.join(', ') })}
        </>
      )}
      {status?.lastGood?.generatedAt && (
        <>
          <br />
          {t('fileDate', { time: when(status.lastGood.generatedAt) })}
          {status.lastSuccess && <> · {t('lastSuccess', { time: when(status.lastSuccess) })}</>}
        </>
      )}
      {status?.index && (
        <>
          <br />
          {t(status.via === 'index' ? 'viaIndex' : 'indexNoRoster', { time: when(status.index.generatedAt) })}
          {notRead.length > 0 && <> {t('indexNotRead', { kinds: notRead.join(', ') })}</>}
        </>
      )}
      {status?.stale && (
        <>
          <br />
          {t('stale')}
        </>
      )}
    </div>
  )
}
