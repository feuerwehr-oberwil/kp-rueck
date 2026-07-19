'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { CheckCircle2, XCircle, AlertTriangle, Users, Zap, Loader2, Binoculars, FileText, ChevronDown, History, MapPin, CheckCheck } from 'lucide-react'
import { apiClient, type ApiRekoReportResponse } from '@/lib/api-client'
import { getApiUrl } from '@/lib/env'
import { cn } from '@/lib/utils'
import { wsClient } from '@/lib/websocket-client'

interface RekoReportSectionProps {
  incidentId: string
  /** Editor-only: archive the incident (status → complete). When provided and the
      latest report is "nicht relevant", a "Einsatz abschliessen" button is shown. */
  onRequestComplete?: () => void
}

const POLL_INTERVAL_MS = 5000 // Poll every 5 seconds for new reports

export default function RekoReportSection({ incidentId, onRequestComplete }: RekoReportSectionProps) {
  const t = useTranslations('reko.reportSection')
  const [reports, setReports] = useState<ApiRekoReportResponse[]>([])
  const [arrivedAt, setArrivedAt] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [historyOpen, setHistoryOpen] = useState(false)

  const loadReports = useCallback(async () => {
    try {
      const data = await apiClient.getIncidentRekoReports(incidentId)
      // Filter out drafts, only show submitted reports (newest first)
      setReports(data.filter(r => !r.is_draft))
      // Check if there's a draft with arrived_at (reko personnel is on site)
      const draftWithArrival = data.find(r => r.is_draft && r.arrived_at)
      setArrivedAt(draftWithArrival?.arrived_at || null)
    } catch (error) {
      console.error('Failed to load Reko reports:', error)
    } finally {
      setIsLoading(false)
    }
  }, [incidentId])

  // WebSocket for instant updates + an always-on safety-net poll.
  //
  // This section only mounts while a detail modal is open (per-incident, tiny
  // payload), so a low-frequency poll is cheap. We keep it running even while the
  // WebSocket is connected: the very first report often submits during the gap
  // between this component mounting and the single `reko_update` event arriving,
  // and with no fallback poll a missed event meant the report never showed until
  // the modal was reopened ("first emergency doesn't show right away").
  useEffect(() => {
    loadReports()

    // Listen for reko updates matching this incident (instant refresh)
    const unsubscribeReko = wsClient.on('reko_update', (data: { data: { incident_id?: string } }) => {
      if (data.data?.incident_id === incidentId) {
        loadReports()
      }
    })

    const pollInterval = setInterval(loadReports, POLL_INTERVAL_MS)

    return () => {
      unsubscribeReko()
      clearInterval(pollInterval)
    }
  }, [loadReports, incidentId])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (reports.length === 0) {
    // Check if REKO personnel has arrived but not yet submitted
    if (arrivedAt) {
      const arrivedDate = new Date(arrivedAt)
      return (
        <div className="rounded-lg border border-dashed p-3 flex items-center justify-center gap-2 text-muted-foreground">
          <MapPin className="h-4 w-4" />
          <p className="text-sm">
            {t('onSiteSince', { time: arrivedDate.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' }) })}
          </p>
        </div>
      )
    }
    return (
      <div className="rounded-lg border border-dashed p-3 flex items-center justify-center gap-2 text-muted-foreground">
        <FileText className="h-4 w-4" />
        <p className="text-sm">{t('noReport')}</p>
      </div>
    )
  }

  const latestReport = reports[0]
  const previousReports = reports.slice(1)

  return (
    <div className="space-y-2">
      {/* Latest Report - Full display */}
      <RekoReportCard
        report={latestReport}
        incidentId={incidentId}
        onRequestComplete={onRequestComplete}
      />

      {/* Previous Reports - Collapsible */}
      {previousReports.length > 0 && (
        <Collapsible open={historyOpen} onOpenChange={setHistoryOpen}>
          <CollapsibleTrigger className="flex items-center gap-2 w-full p-2 text-xs text-muted-foreground hover:text-foreground transition-colors rounded-lg hover:bg-muted/50" tabIndex={-1}>
            <History className="h-3 w-3" />
            <span>{t('previousReports', { count: previousReports.length })}</span>
            <ChevronDown className={cn("h-3 w-3 ml-auto transition-transform", historyOpen && "rotate-180")} />
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-1 pt-1">
            {previousReports.map((report) => (
              <RekoReportCardCompact
                key={report.id}
                report={report}
                incidentId={incidentId}
              />
            ))}
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  )
}

interface RekoReportCardProps {
  report: ApiRekoReportResponse
  incidentId: string
  onRequestComplete?: () => void
}

function RekoReportCard({ report, incidentId, onRequestComplete }: RekoReportCardProps) {
  const t = useTranslations('reko.reportSection')
  function getPhotoUrl(filename: string): string {
    const apiUrl = getApiUrl()
    return `${apiUrl}/api/photos/${incidentId}/${filename}`
  }

  return (
    <div className="rounded-lg border">
      <div className="p-4">
        <div className="flex items-center gap-3 mb-4">
          {report.is_relevant ? (
            <CheckCircle2 className="h-5 w-5 text-success flex-shrink-0" />
          ) : (
            <XCircle className="h-5 w-5 text-muted-foreground flex-shrink-0" />
          )}
          <div className="flex-1">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">
                {report.is_relevant ? t('relevant') : t('notNeeded')}
              </span>
              <div className="flex items-center gap-2">
                {report.submitted_by_personnel_name && (
                  <Badge variant="secondary" className="gap-1">
                    <Binoculars className="h-3 w-3" />
                    {report.submitted_by_personnel_name}
                  </Badge>
                )}
                {/* Reko reported the incident not relevant — let the operator close it
                    straight from the Reko-Meldung card. */}
                {!report.is_relevant && onRequestComplete && (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="h-7 px-2 text-xs"
                    onClick={onRequestComplete}
                  >
                    <CheckCheck className="mr-1 h-3.5 w-3.5" />
                    {t('completeIncident')}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <Separator />

          {/* Dangers */}
          {report.dangers_json && (
            report.dangers_json.fire ||
            report.dangers_json.fire_danger ||
            report.dangers_json.explosion ||
            report.dangers_json.collapse ||
            report.dangers_json.chemical ||
            report.dangers_json.electrical ||
            report.dangers_json.other_notes
          ) && (
            <div>
              <h5 className="font-medium text-sm mb-2 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-muted-foreground" />
                {t('dangers')}
              </h5>
              <div className="flex flex-wrap gap-2">
                {report.dangers_json.fire && <Badge variant="destructive">{t('dangerBadges.fire')}</Badge>}
                {report.dangers_json.fire_danger && <Badge variant="destructive">{t('dangerBadges.fire_danger')}</Badge>}
                {report.dangers_json.explosion && <Badge variant="destructive">{t('dangerBadges.explosion')}</Badge>}
                {report.dangers_json.collapse && <Badge variant="destructive">{t('dangerBadges.collapse')}</Badge>}
                {report.dangers_json.chemical && <Badge variant="destructive">{t('dangerBadges.chemical')}</Badge>}
                {report.dangers_json.electrical && <Badge variant="destructive">{t('dangerBadges.electrical')}</Badge>}
              </div>
              {report.dangers_json.other_notes && (
                <p className="text-sm text-muted-foreground mt-2">
                  {report.dangers_json.other_notes}
                </p>
              )}
            </div>
          )}

          {/* Effort */}
          {report.effort_json && (
            report.effort_json.personnel_count ||
            report.effort_json.estimated_duration_hours ||
            report.effort_json.vehicles_needed?.length > 0 ||
            report.effort_json.equipment_needed?.length > 0
          ) && (
            <div>
              <h5 className="font-medium text-sm mb-2 flex items-center gap-2">
                <Users className="h-4 w-4 text-muted-foreground" />
                {t('effort')}
              </h5>
              <div className="text-sm space-y-1">
                {report.effort_json.personnel_count && (
                  <p>{t('personnel', { count: report.effort_json.personnel_count })}</p>
                )}
                {report.effort_json.estimated_duration_hours && (
                  <p>{t('duration', { hours: report.effort_json.estimated_duration_hours })}</p>
                )}
                {report.effort_json.vehicles_needed && report.effort_json.vehicles_needed.length > 0 && (
                  <p>{t('vehicles', { list: report.effort_json.vehicles_needed.join(', ') })}</p>
                )}
                {report.effort_json.equipment_needed && report.effort_json.equipment_needed.length > 0 && (
                  <p>{t('equipment', { list: report.effort_json.equipment_needed.join(', ') })}</p>
                )}
              </div>
            </div>
          )}

          {/* Power Supply */}
          {report.power_supply && report.power_supply !== 'unknown' && (
            <div>
              <h5 className="font-medium text-sm mb-2 flex items-center gap-2">
                <Zap className="h-4 w-4 text-muted-foreground" />
                {t('powerSupply')}
              </h5>
              <p className="text-sm">
                {report.power_supply === 'available' && t('powerAvailable')}
                {report.power_supply === 'unavailable' && t('powerUnavailable')}
                {report.power_supply === 'emergency_needed' && t('powerEmergencyNeeded')}
              </p>
            </div>
          )}

          {/* Photos */}
          {report.photos_json && report.photos_json.length > 0 && (
            <div>
              <h5 className="font-medium text-sm mb-2">{t('photosCount', { count: report.photos_json.length })}</h5>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {report.photos_json.map((filename, index) => (
                  <a
                    key={index}
                    href={getPhotoUrl(filename)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block aspect-square rounded overflow-hidden hover:opacity-80 transition-opacity"
                    tabIndex={-1}
                  >
                    <img
                      src={getPhotoUrl(filename)}
                      alt={report.submitted_by_personnel_name
                        ? t('photoAltBy', { number: index + 1, name: report.submitted_by_personnel_name })
                        : t('photoAlt', { number: index + 1 })}
                      className="w-full h-full object-cover"
                    />
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Summary - show text directly without label */}
          {report.summary_text && (
            <div>
              <p className="text-sm">{report.summary_text}</p>
            </div>
          )}

          {/* Additional Notes */}
          {report.additional_notes && (
            <div>
              <h5 className="font-medium text-sm mb-2">{t('additionalNotes')}</h5>
              <p className="text-sm text-muted-foreground">{report.additional_notes}</p>
            </div>
          )}

          {/* Metadata */}
          <div className="text-xs text-muted-foreground border-t pt-2 mt-4">
            {report.submitted_by_personnel_name && (
              <p>{t('rekoBy', { name: report.submitted_by_personnel_name })}</p>
            )}
            <p>{t('submittedAt', { date: new Date(report.submitted_at).toLocaleString('de-CH') })}</p>
            {report.updated_at !== report.submitted_at && (
              <p>{t('updatedAt', { date: new Date(report.updated_at).toLocaleString('de-CH') })}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// Compact version for previous reports
function RekoReportCardCompact({ report, incidentId }: RekoReportCardProps) {
  const t = useTranslations('reko.reportSection')
  function getPhotoUrl(filename: string): string {
    const apiUrl = getApiUrl()
    return `${apiUrl}/api/photos/${incidentId}/${filename}`
  }

  const hasDangers = report.dangers_json && (
    report.dangers_json.fire ||
    report.dangers_json.fire_danger ||
    report.dangers_json.explosion ||
    report.dangers_json.collapse ||
    report.dangers_json.chemical ||
    report.dangers_json.electrical
  )

  return (
    <div className="rounded-lg border border-dashed bg-muted/30 p-3 text-sm">
      <div className="flex items-start gap-2">
        {report.is_relevant ? (
          <CheckCircle2 className="h-4 w-4 text-success flex-shrink-0 mt-0.5" />
        ) : (
          <XCircle className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
        )}
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium text-xs">
              {report.is_relevant ? t('relevantShort') : t('notRelevantShort')}
            </span>
            <span className="text-xs text-muted-foreground">
              {new Date(report.submitted_at).toLocaleDateString('de-CH')}
            </span>
          </div>

          {/* Compact info row */}
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {report.submitted_by_personnel_name && (
              <span className="flex items-center gap-1">
                <Binoculars className="h-3 w-3" />
                {report.submitted_by_personnel_name}
              </span>
            )}
            {hasDangers && (
              <span className="flex items-center gap-1 text-destructive">
                <AlertTriangle className="h-3 w-3" />
                {t('dangers')}
              </span>
            )}
            {report.photos_json && report.photos_json.length > 0 && (
              <span>{t('photoCount', { count: report.photos_json.length })}</span>
            )}
          </div>

          {/* Summary if exists */}
          {report.summary_text && (
            <p className="text-xs text-muted-foreground line-clamp-2">
              {report.summary_text}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
