'use client'

/**
 * Integrationen – die eine Frage «läuft das bei uns?», beantwortet aus der
 * Fähigkeiten-Registratur des Backends (`GET /api/integrations`).
 *
 * Bewusst ohne Bedienelemente: Zugangsschlüssel gelten für die ganze Anlage und stehen
 * dort, wo auch Datenbank und Backup konfiguriert sind – in der Server-Konfiguration,
 * nicht in einem Formularfeld auf dieser Seite. Die Spalte «Wo ändern» sagt darum in
 * derselben Zeile, wer die Antwort ändern kann.
 *
 * Der Hinweis unter der Tabelle nennt die eingebauten Alarmwege, die immer verfügbar
 * sind (`builtin_alarm_paths`). Ohne ihn liest sich eine Spalte voller «nicht
 * eingerichtet» wie «hier kann keine Lage eröffnet werden» – und das stimmt nie.
 */

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { SettingCard } from '@/components/settings/setting-row'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { apiClient } from '@/lib/api-client'
import type { ApiIntegrations, ApiProviderCapability } from '@/lib/api/types'

/** Die vier Bereiche der Registratur, in der Reihenfolge, in der sie eine Lage durchläuft. */
const DOMAINS = ['alarms', 'alerting', 'personnel', 'vehicles'] as const
type Domain = (typeof DOMAINS)[number]

/**
 * Welche Umgebungsvariable einen Bereich einrichtet. Die Registratur leitet ihre Antwort
 * aus genau diesen Werten ab (`backend/app/api/integrations.py`); hier stehen sie, damit
 * die Zeile nicht nur «Server-Konfiguration» sagt, sondern welchen Eintrag es braucht.
 */
const DOMAIN_ENV: Record<Domain, string> = {
  alarms: 'DIVERA_ACCESS_KEY',
  alerting: 'DIVERA_ACCESS_KEY',
  personnel: 'DIVERA_ACCESS_KEY',
  vehicles: 'TRACCAR_URL',
}

export function IntegrationsSection() {
  const t = useTranslations('settings.integrations')
  const [integrations, setIntegrations] = useState<ApiIntegrations | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    apiClient
      .getIntegrations()
      .then((result) => {
        if (!cancelled) setIntegrations(result)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const renderStatus = (capability: ApiProviderCapability) => {
    if (capability.blocked) {
      return (
        <Badge variant="outline" className="border-warning/40 bg-warning/10 text-warning-foreground">
          {t('status.blocked')}
        </Badge>
      )
    }
    return capability.configured ? (
      <Badge variant="outline" className="border-success/40 bg-success/10 text-success-foreground">
        {t('status.configured')}
      </Badge>
    ) : (
      <Badge variant="secondary">{t('status.notConfigured')}</Badge>
    )
  }

  return (
    <div className="space-y-4">
      <SettingCard
        title={t('title')}
        subtitle={t('description')}
        action={
          <Badge variant="secondary" className="shrink-0">
            {t('readOnlyBadge')}
          </Badge>
        }
      >
        <div className="space-y-4">
          {failed ? (
            <p className="text-sm text-destructive">{t('loadFailed')}</p>
          ) : !integrations ? (
            <div className="space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('columns.domain')}</TableHead>
                    <TableHead>{t('columns.provider')}</TableHead>
                    <TableHead>{t('columns.status')}</TableHead>
                    <TableHead>{t('columns.where')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {DOMAINS.map((domain) => {
                    const capability = integrations[domain]
                    return (
                      <TableRow key={domain}>
                        <TableCell className="font-medium">{t(`domains.${domain}`)}</TableCell>
                        <TableCell>
                          {capability.display_name ?? (
                            <span className="text-muted-foreground">–</span>
                          )}
                        </TableCell>
                        <TableCell>{renderStatus(capability)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {t('serverConfig')}
                          <br />
                          <span className="font-mono">{DOMAIN_ENV[domain]}</span>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>

              {/* Die Sperre eines Nicht-Produktions-Rollout ist etwas anderes als «nicht
                  eingerichtet»: eine Staging-Kopie ist vollständig konfiguriert und sendet
                  trotzdem nichts. Der Grund kommt vom Backend fertig formuliert. */}
              {integrations.alerting.blocked_reason && (
                <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs leading-relaxed text-warning-foreground">
                  {integrations.alerting.blocked_reason}
                </p>
              )}

              <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                <b className="font-semibold text-foreground">{t('builtinTitle')}</b>{' '}
                {integrations.builtin_alarm_paths
                  .map((path) => t(`builtinPaths.${path}`))
                  .join(' · ')}
                <br />
                {t('builtinNote')}
              </div>
            </>
          )}
        </div>
      </SettingCard>
    </div>
  )
}
